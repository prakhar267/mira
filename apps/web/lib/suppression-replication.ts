import { z } from "zod";
import type { SqlStorage } from "./store-engine";
import { RecoveryJournal } from "./recovery-journal";
import { advanceCheckpoint, appendReceiptSchema, checkpointSchema, genesisCheckpoint, writerSchema, type SuppressionTransport, type Writer } from "./suppression-protocol";

const protectionSchema=z.object({version:z.literal(1),writer:writerSchema,acknowledged:checkpointSchema}).strict();
type Protection=z.infer<typeof protectionSchema>;
type Transaction=<T>(work:()=>T)=>T;
const MAX_BATCHES=8;

/** Durable local-commit / independent-ack barrier, not a recovery admission or
 * serving lease. A failed response can have committed locally; a successful
 * protected response may not outrun its independently acknowledged journal.
 * Provisioning requires the separate explicitly enabled operator-only v2 path;
 * ordinary application requests can never activate or reset protection. */
export class SourceSuppressionReplicator {
  private journal:RecoveryJournal;
  private pending:Promise<void>=Promise.resolve();
  constructor(private sql:SqlStorage, private transaction:Transaction, private source:string, private transport:()=>SuppressionTransport|undefined) {
    this.journal=new RecoveryJournal(sql);
    sql.exec("CREATE TABLE IF NOT EXISTS suppression_protection (id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL)");
  }
  private load():Protection|undefined {
    const row=this.sql.exec("SELECT value FROM suppression_protection WHERE id=1").toArray()[0];
    if(!row)return undefined;
    const parsed=protectionSchema.safeParse(JSON.parse(String(row.value)));
    if(!parsed.success||parsed.data.writer.source!==this.source)throw new Error("SUPPRESSION_PROTECTION_INVALID");
    return parsed.data;
  }
  private save(protection:Protection) {
    this.sql.exec("INSERT INTO suppression_protection(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",JSON.stringify(protection));
  }
  private expectedProtection():Protection|undefined {
    const state=this.load();
    // Configuration lives outside the restorable source SQL. A snapshot from
    // before activation must not silently turn a configured generation off.
    // Provisioning is deliberately separate and cannot be triggered by reads.
    if(!state&&this.transport())throw new Error("SUPPRESSION_PROTECTION_REQUIRED");
    return state;
  }
  isProtected(){return this.expectedProtection()!==undefined;}
  protection(){const state=this.expectedProtection();if(!state)throw new Error("SUPPRESSION_PROTECTION_REQUIRED");return state;}
  status(){
    const state=this.expectedProtection(),head=this.journal.watermark();
    return {protected:Boolean(state),journalSequence:head,acknowledgedSequence:state?.acknowledged.sequence??null,pending:state?Math.max(0,head-state.acknowledged.sequence):null};
  }
  /** Internal provisioning primitive for an independently enrolled generation.
   * Always replay from genesis, never trust a supplied high-water mark. It has
   * no disable/reset counterpart. The v2 capture/restore orchestrator supplies
   * registered coverage and successor admission; configuration is not enrollment. */
  async beginProtection(raw:Writer) {
    const writer=writerSchema.parse(raw);
    if(writer.source!==this.source)throw new Error("SUPPRESSION_SOURCE_MISMATCH");
    const acknowledged=await genesisCheckpoint(writer);
    this.transaction(()=>{
      const current=this.load();
      if(current){
        if(JSON.stringify(current.writer)!==JSON.stringify(writer))throw new Error("SUPPRESSION_PROTECTION_LOCKED");
        return;
      }
      this.save({version:1,writer,acknowledged});
    });
  }
  assertRawMutationAllowed(key:string) {
    // These bypass typed state/policy/memory commands and cannot prove which
    // previously archived content they suppress. Tokens/metrics aren't archived.
    if(this.isProtected()&&/^(?:account|state|account-policy|backup|email):/.test(key))throw new Error("SUPPRESSION_TYPED_ACTION_REQUIRED");
  }
  assertLegacyRecoveryAllowed() {
    if(this.isProtected())throw new Error("SUPPRESSION_RECOVERY_ADMISSION_REQUIRED");
  }
  async flush():Promise<void> {
    // Dormant operation requires BOTH absent external configuration and absent
    // durable protection. Either witness alone is enough to deny a downgrade.
    if(!this.isProtected())return Promise.resolve();
    const through=this.journal.watermark();
    const run=this.pending.then(()=>this.flushThrough(through));
    this.pending=run.catch(()=>{});
    return run;
  }
  private async flushThrough(through:number) {
    for(let batch=0;batch<MAX_BATCHES;batch++) {
      const state=this.load();
      if(!state)throw new Error("SUPPRESSION_PROTECTION_INVALID");
      const head=this.journal.watermark();
      if(head<state.acknowledged.sequence||head<through)throw new Error("SUPPRESSION_SOURCE_ROLLBACK");
      const transport=this.transport();
      if(!transport||transport.authorityId!==state.writer.authorityId)throw new Error("SUPPRESSION_AUTHORITY_UNAVAILABLE");
      const end=Math.max(through,state.acknowledged.sequence);
      const entries=this.journal.page(state.acknowledged.sequence,end);
      if(!entries.length&&end>state.acknowledged.sequence)throw new Error("SUPPRESSION_JOURNAL_GAP");
      const expected=await advanceCheckpoint(state.writer,state.acknowledged,entries);
      // Even an empty batch rechecks epoch revocation. This does not replace a
      // serving lease: retirement can race an already in-flight app response.
      let raw:unknown;
      try {raw=await transport.append({writer:state.writer,after:state.acknowledged,entries});}
      catch {throw new Error("SUPPRESSION_ACK_PENDING");}
      const receipt=appendReceiptSchema.safeParse(raw);
      if(!receipt.success)throw new Error("SUPPRESSION_RECEIPT_INVALID");
      const {head:independentHead,...accepted}=receipt.data;
      if(JSON.stringify(accepted)!==JSON.stringify({...state.writer,...expected})||independentHead.sequence<expected.sequence||(independentHead.sequence===expected.sequence&&independentHead.digest!==expected.digest))throw new Error("SUPPRESSION_RECEIPT_INVALID");
      this.transaction(()=>{
        const latest=this.load();
        if(!latest||JSON.stringify(latest)!==JSON.stringify(state))throw new Error("SUPPRESSION_CHECKPOINT_CHANGED");
        // A whole-source rollback can rewind BOTH local journal and checkpoint.
        // The independently current head must still be represented locally;
        // merely accepting an old hash-chain prefix is insufficient evidence.
        if(independentHead.sequence>this.journal.watermark())throw new Error("SUPPRESSION_SOURCE_ROLLBACK");
        if(expected.sequence!==state.acknowledged.sequence)this.save({...state,acknowledged:expected});
      });
      through=Math.max(through,independentHead.sequence);
      if(expected.sequence>=through)return;
    }
    // Bounded replay makes durable progress, but never reports success partway.
    throw new Error("SUPPRESSION_BACKLOG_PENDING");
  }
}
