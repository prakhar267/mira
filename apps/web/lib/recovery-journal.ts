import type { SqlStorage } from "./store-engine";

export type RecoveryEvent =
  | { kind: "account"; userId: string }
  | { kind: "memory"; userId: string; id: string }
  | { kind: "conversation"; userId: string; id: string }
  | { kind: "privacy"; userId: string; revision: number; ai: boolean; history: boolean; memory: boolean };

/** Minimal immutable recovery journal. No conversation, address, password,
 * corrected memory, or bearer token belongs here. Events share the mutation's
 * SQLite transaction; an operator exports them independently of data backups. */
export class RecoveryJournal {
  constructor(private sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS recovery_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL)");
  }
  append(event: RecoveryEvent) { this.sql.exec("INSERT INTO recovery_events(seq,value) VALUES((SELECT coalesce(max(seq),0)+1 FROM recovery_events),?)", JSON.stringify(event)); }
  watermark() { return Number(this.sql.exec("SELECT coalesce(max(seq),0) AS seq FROM recovery_events").toArray()[0]?.seq ?? 0); }
}
