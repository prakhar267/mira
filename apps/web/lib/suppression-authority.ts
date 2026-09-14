import { z } from "zod";
import type { SqlStorage } from "./store-engine";
import { recoveryEventSchema } from "./recovery-journal";
import { archiveRegistrationSchema, archiveRegistrationReceiptSchema, recoveryHandoffRequestSchema, recoveryHandoffSchema, recoveryAdmissionSchema, type ArchiveRegistrationReceipt, type RecoveryHandoff, type RecoveryAdmission } from "./protected-recovery-protocol";
import {
  advanceCheckpoint, appendReceiptSchema, appendRequestSchema, canonicalEvent, checkpointSchema,
  genesisCheckpoint, receiptSchema, writerSchema,
  type AppendReceipt, type Checkpoint, type JournalEntry, type Receipt, type Writer,
} from "./suppression-protocol";

export class SuppressionAuthorityError extends Error {
  constructor(readonly code: string) { super(code); this.name = "SuppressionAuthorityError"; }
}
function fail(code: string): never { throw new SuppressionAuthorityError(code); }
function input<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) fail("SUPPRESSION_INVALID");
  return result.data;
}
function stored<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) fail("SUPPRESSION_AUTHORITY_CORRUPT");
  return result.data;
}
const id = writerSchema.shape.authorityId;
const writerRowSchema = z.object({
  source: id, writer_id: id, epoch: writerSchema.shape.epoch,
  genesis_digest: checkpointSchema.shape.digest,
  head_sequence: checkpointSchema.shape.sequence, head_digest: checkpointSchema.shape.digest,
  fenced: z.union([z.literal(0), z.literal(1)]), target: id.nullable(), challenge: id.nullable(),
}).strict().refine(row => row.fenced === 1 ? row.target !== null && row.challenge !== null : row.target === null && row.challenge === null);
type WriterRow = z.infer<typeof writerRowSchema>;
const entryRowSchema = z.object({
  sequence: checkpointSchema.shape.sequence.positive(),
  value: z.string().max(2_000), digest: checkpointSchema.shape.digest,
}).strict();
type EntryRow = z.infer<typeof entryRowSchema>;

export type SuppressionFence = Receipt & { fenced: true; target: string; challenge: string };
export interface SuppressionPage {
  entries: JournalEntry[];
  checkpoint: Checkpoint;
  head: Receipt;
  fenced: boolean;
  hasMore: boolean;
}

/** Dormant, storage-only authority core. The injected transaction must provide
 * synchronous atomic durable commits. Hashing happens before that transaction;
 * each commit rechecks the current writer, fence and immutable prefix.
 *
 * This class is NOT a network endpoint or an authentication layer. Its caller
 * must authorize enrollment, appends, reads and especially permanent fencing.
 * A digest is integrity evidence, not a signature or proof of latest state.
 * Protected v2 recovery supplies authenticated transport, archive registration
 * and successor admission separately. Durable independent placement remains an
 * operator activation requirement; this core alone is not offsite protection. */
export class SuppressionAuthorityEngine {
  private readonly authorityId: string;
  constructor(private readonly sql: SqlStorage, private readonly transaction: <T>(work: () => T) => T, authorityId: string) {
    this.authorityId = input(id, authorityId);
    transaction(() => {
      sql.exec("CREATE TABLE IF NOT EXISTS suppression_authority_identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL CHECK(version=1), authority_id TEXT NOT NULL)");
      sql.exec("CREATE TABLE IF NOT EXISTS suppression_authority_writers (source TEXT PRIMARY KEY, writer_id TEXT NOT NULL, epoch INTEGER NOT NULL, genesis_digest TEXT NOT NULL, head_sequence INTEGER NOT NULL, head_digest TEXT NOT NULL, fenced INTEGER NOT NULL CHECK(fenced IN (0,1)), target TEXT, challenge TEXT)");
      sql.exec("CREATE TABLE IF NOT EXISTS suppression_authority_entries (source TEXT NOT NULL, sequence INTEGER NOT NULL, value TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(source,sequence))");
      sql.exec("CREATE TABLE IF NOT EXISTS suppression_archives (archive_id TEXT PRIMARY KEY, value TEXT NOT NULL)");
      sql.exec("CREATE TABLE IF NOT EXISTS suppression_handoffs (source TEXT PRIMARY KEY, successor TEXT UNIQUE NOT NULL, value TEXT NOT NULL, admission TEXT)");
      const identity = sql.exec("SELECT version,authority_id FROM suppression_authority_identity WHERE singleton=1").toArray()[0];
      if (!identity) {
        if (sql.exec("SELECT source FROM suppression_authority_writers LIMIT 1").toArray().length || sql.exec("SELECT source FROM suppression_authority_entries LIMIT 1").toArray().length || sql.exec("SELECT archive_id FROM suppression_archives LIMIT 1").toArray().length || sql.exec("SELECT source FROM suppression_handoffs LIMIT 1").toArray().length) fail("SUPPRESSION_AUTHORITY_CORRUPT");
        sql.exec("INSERT INTO suppression_authority_identity(singleton,version,authority_id) VALUES(1,1,?)", this.authorityId);
      } else {
        if (identity.version !== 1) fail("SUPPRESSION_AUTHORITY_CORRUPT");
        if (identity.authority_id !== this.authorityId) fail("SUPPRESSION_AUTHORITY_MISMATCH");
      }
    });
  }

  private parseWriter(raw: unknown): Writer {
    const writer = input(writerSchema, raw);
    if (writer.authorityId !== this.authorityId) fail("SUPPRESSION_AUTHORITY_MISMATCH");
    return writer;
  }
  private row(source: string): WriterRow | undefined {
    const row = this.sql.exec("SELECT source,writer_id,epoch,genesis_digest,head_sequence,head_digest,fenced,target,challenge FROM suppression_authority_writers WHERE source=?", source).toArray()[0];
    return row ? stored(writerRowSchema, row) : undefined;
  }
  private requireWriter(writer: Writer, active: boolean): WriterRow {
    const row = this.row(writer.source);
    if (!row) fail("SUPPRESSION_WRITER_UNKNOWN");
    if (row.writer_id !== writer.writerId || row.epoch !== writer.epoch) fail("SUPPRESSION_WRITER_MISMATCH");
    if (active && row.fenced) fail("SUPPRESSION_WRITER_FENCED");
    this.assertCheckpoint(row, { sequence: row.head_sequence, digest: row.head_digest });
    return row;
  }
  private receipt(writer: Writer, row: WriterRow): Receipt {
    return stored(receiptSchema, { ...writer, sequence: row.head_sequence, digest: row.head_digest });
  }
  private entry(source: string, sequence: number): EntryRow | undefined {
    const row = this.sql.exec("SELECT sequence,value,digest FROM suppression_authority_entries WHERE source=? AND sequence=?", source, sequence).toArray()[0];
    return row ? stored(entryRowSchema, row) : undefined;
  }
  private event(row: EntryRow): JournalEntry {
    let value: unknown;
    try { value = JSON.parse(row.value); } catch { fail("SUPPRESSION_AUTHORITY_CORRUPT"); }
    return { sequence: row.sequence, event: stored(recoveryEventSchema, value) };
  }
  private assertCheckpoint(row: WriterRow, after: Checkpoint): void {
    if (after.sequence > row.head_sequence) fail("SUPPRESSION_SEQUENCE_GAP");
    const digest = after.sequence === 0 ? row.genesis_digest : this.entry(row.source, after.sequence)?.digest;
    if (!digest) fail("SUPPRESSION_AUTHORITY_CORRUPT");
    if (after.sequence === row.head_sequence && digest !== row.head_digest) fail("SUPPRESSION_AUTHORITY_CORRUPT");
    if (digest !== after.digest) fail("SUPPRESSION_CHECKPOINT_CONFLICT");
  }

  /** Epoch 1 enrollment is permanent: no takeover, reset or epoch bump API. */
  async enroll(source: string, writerId: string): Promise<Receipt> {
    const writer = this.parseWriter({ authorityId: this.authorityId, source, writerId, epoch: 1 });
    const genesis = await genesisCheckpoint(writer);
    return this.transaction(() => {
      const existing = this.row(source);
      if (existing) return this.receipt(writer, this.requireWriter(writer, true));
      // Never silently reuse an orphaned journal as a newly enrolled source.
      if (this.sql.exec("SELECT sequence FROM suppression_authority_entries WHERE source=? LIMIT 1", source).toArray().length) fail("SUPPRESSION_AUTHORITY_CORRUPT");
      this.sql.exec("INSERT INTO suppression_authority_writers(source,writer_id,epoch,genesis_digest,head_sequence,head_digest,fenced,target,challenge) VALUES(?,?,1,?,0,?,0,NULL,NULL)", source, writerId, genesis.digest, genesis.digest);
      return { ...writer, ...genesis };
    });
  }

  /** The top-level checkpoint is the request-END, which the source reconstructs.
   * Its separate `head` is the authority's current checkpoint from this SAME
   * commit transaction: old/empty retries must reveal later independent events
   * so a source cannot silently serve after both its journal and ack roll back.
   * Neither checkpoint is permission to serve or bypass writer revocation. */
  async append(raw: unknown): Promise<AppendReceipt> {
    const request = input(appendRequestSchema, raw), writer = this.parseWriter(request.writer);
    let end = request.after;
    const prepared: { entry: JournalEntry; digest: string }[] = [];
    for (const entry of request.entries) {
      if (entry.sequence !== end.sequence + 1) fail("SUPPRESSION_SEQUENCE_GAP");
      end = await advanceCheckpoint(writer, end, [entry]);
      prepared.push({ entry, digest: end.digest });
    }
    return this.transaction(() => {
      const row = this.requireWriter(writer, true);
      this.assertCheckpoint(row, request.after);
      let head = row.head_sequence, digest = row.head_digest;
      const lineage = this.sql.exec("SELECT value,admission FROM suppression_handoffs WHERE successor=?", writer.source).toArray()[0];
      const parent = lineage ? stored(recoveryHandoffSchema, JSON.parse(String(lineage.value))) : undefined;
      for (const next of prepared) {
        if (parent && next.entry.sequence <= parent.previous.sequence) {
          const inherited = this.entry(parent.previous.source, next.entry.sequence);
          if (!inherited || canonicalEvent(this.event(inherited).event) !== canonicalEvent(next.entry.event)) fail("SUPPRESSION_INHERITANCE_CONFLICT");
        } else if (parent && !lineage!.admission) fail("SUPPRESSION_SUCCESSOR_NOT_ADMITTED");
        if (next.entry.sequence <= row.head_sequence) {
          const existing = this.entry(writer.source, next.entry.sequence);
          if (!existing) fail("SUPPRESSION_AUTHORITY_CORRUPT");
          if (existing.digest !== next.digest || canonicalEvent(this.event(existing).event) !== canonicalEvent(next.entry.event)) fail("SUPPRESSION_ENTRY_CONFLICT");
        } else {
          if (next.entry.sequence !== head + 1) fail("SUPPRESSION_SEQUENCE_GAP");
          this.sql.exec("INSERT INTO suppression_authority_entries(source,sequence,value,digest) VALUES(?,?,?,?)", writer.source, next.entry.sequence, JSON.stringify(next.entry.event), next.digest);
          head = next.entry.sequence; digest = next.digest;
        }
      }
      if (head !== row.head_sequence) this.sql.exec("UPDATE suppression_authority_writers SET head_sequence=?,head_digest=? WHERE source=?", head, digest, writer.source);
      return stored(appendReceiptSchema, { ...writer, ...end, head: { sequence: head, digest } });
    });
  }

  /** The source registers only after capture under its export lease and a full
   * independent acknowledgement. Authentication belongs to the service adapter.
   * Registrations are immutable and cannot bless a different historical file. */
  registerArchive(raw: unknown): ArchiveRegistrationReceipt {
    const registration = input(archiveRegistrationSchema, raw), writer = this.parseWriter(registration.writer);
    return this.transaction(() => {
      const row = this.requireWriter(writer, true);
      this.assertCheckpoint(row, registration.checkpoint);
      const found = this.sql.exec("SELECT value FROM suppression_archives WHERE archive_id=?", registration.archiveId).toArray()[0];
      if (found) {
        const saved = stored(archiveRegistrationReceiptSchema, JSON.parse(String(found.value)));
        if (JSON.stringify(saved) !== JSON.stringify({ ...registration, registered: true })) fail("SUPPRESSION_ARCHIVE_CONFLICT");
        return saved;
      }
      if (registration.checkpoint.sequence !== row.head_sequence) fail("SUPPRESSION_ARCHIVE_NOT_CURRENT");
      const receipt = { ...registration, registered: true as const };
      this.sql.exec("INSERT INTO suppression_archives VALUES(?,?)", registration.archiveId, JSON.stringify(receipt));
      return receipt;
    });
  }

  /** One immutable successor per lost generation. No request to the old source
   * is required. Old reads already authorized may finish; new acknowledgements
   * are denied by the existing writer fence. This is not byte-level revocation. */
  async handoff(raw: unknown): Promise<RecoveryHandoff> {
    const request = input(recoveryHandoffRequestSchema, raw), writer = this.parseWriter(request.registration.writer), successor = this.parseWriter(request.successor);
    if (successor.source === writer.source || successor.epoch !== 1) fail("SUPPRESSION_HANDOFF_INVALID");
    const genesis = await genesisCheckpoint(successor);
    return this.transaction(() => {
      const row = this.requireWriter(writer, false);
      const found = this.sql.exec("SELECT value FROM suppression_archives WHERE archive_id=?", request.registration.archiveId).toArray()[0];
      if (!found) fail("SUPPRESSION_ARCHIVE_UNREGISTERED");
      const registration = stored(archiveRegistrationReceiptSchema, JSON.parse(String(found.value)));
      if (JSON.stringify(registration) !== JSON.stringify({ ...request.registration, registered: true })) fail("SUPPRESSION_ARCHIVE_CONFLICT");
      this.assertCheckpoint(row, registration.checkpoint);
      const previous = this.receipt(writer, row);
      const receipt = stored(recoveryHandoffSchema, { ...request, version: 2, registration, previous, fenced: true });
      const old = this.sql.exec("SELECT value FROM suppression_handoffs WHERE source=?", writer.source).toArray()[0];
      if (old) {
        const saved = stored(recoveryHandoffSchema, JSON.parse(String(old.value)));
        if (JSON.stringify(saved) !== JSON.stringify(receipt)) fail("SUPPRESSION_HANDOFF_CONFLICT");
        this.requireWriter(successor, true);
        return saved;
      }
      if (row.fenced || this.row(successor.source) || this.sql.exec("SELECT sequence FROM suppression_authority_entries WHERE source=? LIMIT 1", successor.source).toArray().length) fail("SUPPRESSION_HANDOFF_CONFLICT");
      this.sql.exec("UPDATE suppression_authority_writers SET fenced=1,target=?,challenge=? WHERE source=?", request.target, request.challenge, writer.source);
      this.sql.exec("INSERT INTO suppression_authority_writers(source,writer_id,epoch,genesis_digest,head_sequence,head_digest,fenced,target,challenge) VALUES(?,?,1,?,0,?,0,NULL,NULL)", successor.source, successor.writerId, genesis.digest, genesis.digest);
      this.sql.exec("INSERT INTO suppression_handoffs VALUES(?,?,?,NULL)", writer.source, successor.source, JSON.stringify(receipt));
      return receipt;
    });
  }

  admit(raw: unknown, rawCheckpoint: unknown): RecoveryAdmission {
    const handoff = input(recoveryHandoffSchema, raw), checkpoint = input(checkpointSchema, rawCheckpoint);
    return this.transaction(() => {
      const old = this.requireWriter(this.parseWriter(handoff.registration.writer), false);
      const successor = this.requireWriter(this.parseWriter(handoff.successor), true);
      const saved = this.sql.exec("SELECT value,admission FROM suppression_handoffs WHERE source=?", handoff.previous.source).toArray()[0];
      if (!saved || JSON.stringify(stored(recoveryHandoffSchema, JSON.parse(String(saved.value)))) !== JSON.stringify(handoff) || !old.fenced || old.target !== handoff.target || old.challenge !== handoff.challenge) fail("SUPPRESSION_HANDOFF_CONFLICT");
      this.assertCheckpoint(successor, checkpoint);
      if (checkpoint.sequence < handoff.previous.sequence) fail("SUPPRESSION_INHERITANCE_INCOMPLETE");
      if (saved.admission) return stored(recoveryAdmissionSchema, JSON.parse(String(saved.admission)));
      if (checkpoint.sequence !== successor.head_sequence) fail("SUPPRESSION_CHECKPOINT_CONFLICT");
      const admission = stored(recoveryAdmissionSchema, { version: 2, handoff, checkpoint, admitted: true });
      this.sql.exec("UPDATE suppression_handoffs SET admission=? WHERE source=?", JSON.stringify(admission), handoff.previous.source);
      return admission;
    });
  }

  /** Permanent writer revocation, NOT permission to start serving a restore.
   * The target/challenge/head are pinned atomically, and only the same tuple can
   * retry. In-flight appends must recheck this state in their commit transaction. */
  fence(raw: Writer, target: string, challenge: string): SuppressionFence {
    const writer = this.parseWriter(raw), destination = input(id, target), nonce = input(id, challenge);
    return this.transaction(() => {
      const row = this.requireWriter(writer, false);
      if (row.fenced && (row.target !== destination || row.challenge !== nonce)) fail("SUPPRESSION_FENCE_CONFLICT");
      if (!row.fenced) this.sql.exec("UPDATE suppression_authority_writers SET fenced=1,target=?,challenge=? WHERE source=?", destination, nonce, writer.source);
      return { ...this.receipt(writer, row), fenced: true, target: destination, challenge: nonce };
    });
  }

  /** Reads a bounded immutable prefix, including after a fence. The caller must
   * authenticate this access and reconstruct each digest before trusting it.
   * No enumeration, pruning, deletion or reset method is exposed. */
  read(raw: Writer, checkpoint: Checkpoint, limit = 64): SuppressionPage {
    const writer = this.parseWriter(raw), after = input(checkpointSchema, checkpoint);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) fail("SUPPRESSION_PAGE_RANGE");
    return this.transaction(() => {
      const row = this.requireWriter(writer, false);
      this.assertCheckpoint(row, after);
      const found = this.sql.exec("SELECT sequence,value,digest FROM suppression_authority_entries WHERE source=? AND sequence>? AND sequence<=? ORDER BY sequence LIMIT ?", writer.source, after.sequence, row.head_sequence, limit).toArray().map(value => stored(entryRowSchema, value));
      const expected = Math.min(limit, row.head_sequence - after.sequence);
      if (found.length !== expected || found.some((entry, index) => entry.sequence !== after.sequence + index + 1)) fail("SUPPRESSION_AUTHORITY_CORRUPT");
      const last = found.at(-1), end = last ? { sequence: last.sequence, digest: last.digest } : after;
      return { entries: found.map(entry => this.event(entry)), checkpoint: end, head: this.receipt(writer, row), fenced: Boolean(row.fenced), hasMore: end.sequence < row.head_sequence };
    });
  }
}
