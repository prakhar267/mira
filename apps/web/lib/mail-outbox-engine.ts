import type { SqlStorage } from "./store-engine";

export type MailPurpose = "recovery" | "verification";
export interface MailJob {
  id: string;
  email: string;
  purpose: MailPurpose;
  token: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
}

/** Private short-lived queue. Completion/expiry physically removes the address
 * and raw link token. Only aggregate content-free metrics survive delivery. */
export class MailOutboxEngine {
  constructor(private sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS mail_jobs (id TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL, available INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, lease INTEGER NOT NULL DEFAULT 0)");
    sql.exec("CREATE INDEX IF NOT EXISTS mail_jobs_available ON mail_jobs(available,lease)");
    sql.exec("CREATE TABLE IF NOT EXISTS mail_receipts (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)");
  }
  enqueue(job: MailJob, now = Date.now()) {
    if (job.expiresAt <= now || job.expiresAt > now + 900_000 || job.email.length > 254 || !/^[a-zA-Z0-9_-]{20,100}$/.test(job.id) || !/^[a-zA-Z0-9_-]{32,100}$/.test(job.token)) throw new Error("Invalid mail job");
    this.cleanup(now);
    const exists = this.sql.exec("SELECT id FROM mail_jobs WHERE id=? UNION ALL SELECT id FROM mail_receipts WHERE id=? AND expires>?", job.id, job.id, now).toArray().length > 0;
    if (exists) return { queued: true, duplicate: true };
    if (Number(this.sql.exec("SELECT count(*) AS count FROM mail_jobs").toArray()[0]?.count) >= 500) throw new Error("Mail queue capacity reached");
    this.sql.exec("INSERT INTO mail_jobs(id,value,expires,available) VALUES(?,?,?,?)", job.id, JSON.stringify({ ...job, attempts: 0 }), job.expiresAt, now);
    return { queued: true, duplicate: false };
  }
  claim(now = Date.now(), limit = 5): MailJob[] {
    this.cleanup(now);
    const rows = this.sql.exec("SELECT * FROM mail_jobs WHERE available<=? AND lease<=? AND attempts<3 ORDER BY available,id LIMIT ?", now, now, Math.min(5, Math.max(1, limit))).toArray();
    return rows.map(row => {
      const attempts = Number(row.attempts) + 1;
      this.sql.exec("UPDATE mail_jobs SET lease=?, attempts=? WHERE id=?", now + 30_000, attempts, String(row.id));
      return { ...JSON.parse(String(row.value)), attempts } as MailJob;
    });
  }
  complete(id: string, status: "accepted" | "discarded" | "retry", now = Date.now()) {
    const row = this.sql.exec("SELECT attempts,expires FROM mail_jobs WHERE id=?", id).toArray()[0];
    if (!row) return;
    if (status !== "retry" || Number(row.attempts) >= 3 || Number(row.expires) <= now) {
      // Resend reuses acceptance for a stable idempotency key. Retain only the
      // content-free job ID until its ORIGINAL expiry; otherwise a fresh token
      // could reuse that key after completion without a new email being sent.
      this.sql.exec("INSERT INTO mail_receipts(id,expires) VALUES(?,?) ON CONFLICT(id) DO NOTHING", id, Number(row.expires));
      this.sql.exec("DELETE FROM mail_jobs WHERE id=?", id);
      return;
    }
    this.sql.exec("UPDATE mail_jobs SET lease=0, available=? WHERE id=?", now + 30_000 * 2 ** Number(row.attempts), id);
  }
  pending(id: string) { return this.sql.exec("SELECT id FROM mail_jobs WHERE id=? AND expires>?", id, Date.now()).toArray().length > 0; }
  purgeByEmail(email: string) { this.sql.exec("DELETE FROM mail_jobs WHERE json_extract(value,'$.email')=?", email); }
  cleanup(now = Date.now()) {
    this.sql.exec("INSERT OR IGNORE INTO mail_receipts(id,expires) SELECT id,expires FROM mail_jobs WHERE attempts>=3 AND lease<=? AND expires>?", now, now);
    this.sql.exec("DELETE FROM mail_jobs WHERE expires<=? OR (attempts>=3 AND lease<=?)", now, now);
    this.sql.exec("DELETE FROM mail_receipts WHERE expires<=?", now);
  }
  status(now = Date.now()) {
    const row = this.sql.exec("SELECT count(*) AS pending,min(available) AS oldest,max(attempts) AS maxAttempts FROM mail_jobs WHERE expires>?", now).toArray()[0];
    return { pending: Number(row?.pending ?? 0), oldestWaitingMs: row?.oldest ? Math.max(0, now - Number(row.oldest)) : 0, maxAttempts: Number(row?.maxAttempts ?? 0) };
  }
}
