import { z } from "zod";
import type { SqlStorage } from "./store-engine";

export type RecoveryEvent =
  | { kind: "account"; userId: string }
  | { kind: "memory"; userId: string; id: string }
  | { kind: "conversation"; userId: string; id: string }
  | { kind: "privacy"; userId: string; revision: number; ai: boolean; history: boolean; memory: boolean };

const id = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/);
export const recoveryEventSchema = z.discriminatedUnion("kind", [
  z.object({kind:z.literal("account"),userId:id}).strict(),
  z.object({kind:z.literal("memory"),userId:id,id}).strict(),
  z.object({kind:z.literal("conversation"),userId:id,id}).strict(),
  z.object({kind:z.literal("privacy"),userId:id,revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),ai:z.boolean(),history:z.boolean(),memory:z.boolean()}).strict(),
]);

/** Minimal immutable recovery journal. No conversation, address, password,
 * corrected memory, or bearer token belongs here. Events share the mutation's
 * SQLite transaction; an operator exports them independently of data backups. */
export class RecoveryJournal {
  constructor(private sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS recovery_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL)");
  }
  append(event: RecoveryEvent) { this.sql.exec("INSERT INTO recovery_events(seq,value) VALUES((SELECT coalesce(max(seq),0)+1 FROM recovery_events),?)", JSON.stringify(recoveryEventSchema.parse(event))); }
  watermark() { return Number(this.sql.exec("SELECT coalesce(max(seq),0) AS seq FROM recovery_events").toArray()[0]?.seq ?? 0); }
  page(after:number, through:number, limit=128) {
    if (![after,through,limit].every(Number.isSafeInteger) || after<0 || through<after || limit<1 || limit>128) throw new Error("SUPPRESSION_JOURNAL_RANGE");
    return this.sql.exec("SELECT seq,value FROM recovery_events WHERE seq>? AND seq<=? ORDER BY seq LIMIT ?",after,through,limit).toArray().map(row=>({sequence:Number(row.seq),event:recoveryEventSchema.parse(JSON.parse(String(row.value)))}));
  }
}
