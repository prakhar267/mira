import { z } from "zod";
import { accountMessageSchema, decodeAccountState } from "./account-state-schema";
import type { SqlStorage, StoreEngine } from "./store-engine";
import { RecoveryJournal, recoveryEventSchema as event, type RecoveryEvent } from "./recovery-journal";
import { BACKUP_CHUNK_BYTES, BACKUP_MAX_BYTES, BACKUP_MAX_CHUNKS, type SealedBackup } from "./backup-crypto";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const flag = z.union([z.literal(0), z.literal(1)]);
const rows = {
  records: z.object({ key: z.string().regex(/^(?:account|email|state|account-policy):[A-Za-z0-9_-]{1,120}$/), value: z.string().max(1_500_000).nullable(), expires: integer.nullable(), deleted: flag }).strict(),
  transcripts: z.object({ user_id: id, id, created_at: z.string().max(40), value: z.string().max(100_000) }).strict(),
  account_conversations: z.object({ user_id: id, id, deleted: flag }).strict(),
  memory_suppressions: z.object({ user_id: id, id, forgotten_at: integer }).strict(),
  privacy_suppressions: z.object({ user_id: id, revision: integer, ai_disabled: flag, history_disabled: flag, memory_disabled: flag }).strict(),
  recovery_events: z.object({ seq: integer.positive(), value: z.string().max(2_000) }).strict(),
};
type Table = keyof typeof rows;
const snapshotTables: Table[] = ["records", "account_conversations", "transcripts", "memory_suppressions", "privacy_suppressions"];
const chunkMeta = z.object({ index: integer, digest: z.string().length(44), bytes: integer.max(BACKUP_CHUNK_BYTES), table: z.enum(Object.keys(rows) as [Table, ...Table[]]), rows: integer.max(128) }).strict();
export const archiveManifestSchema = z.object({ version: z.literal(1), kind: z.enum(["snapshot", "ledger"]), archiveId: id, source: id, watermark: integer, createdAt: integer, chunks: z.array(chunkMeta).max(BACKUP_MAX_CHUNKS), totalBytes: integer.max(BACKUP_MAX_BYTES), totalRows: integer.max(1_000_000) }).strict();
export type ArchiveManifest = z.infer<typeof archiveManifestSchema>;
export interface ArchiveChunk { version: 1; kind: "snapshot" | "ledger"; archiveId: string; source: string; index: number; table: Table; rows: Record<string, unknown>[] }
type Job = { archiveId: string; source: string; watermark: number; createdAt: number; kind: "snapshot" | "ledger"; nonce: string; table: number; offset: number; next: number; totalBytes: number; totalRows: number };
type Control = { mode: "active" } | { mode: "export"; nonce: string; archiveId: string; expires: number } | { mode: "restore"; target: string; challenge: string; snapshot: ArchiveManifest; next: number; ledger?: ArchiveManifest; ledgerNext: number; ledgerSequence: number; validatedAccounts: number } | { mode: "retired"; target: string; challenge: string; backupId: string; watermark: number };
const recordFilter = "(key LIKE 'account:%' OR key LIKE 'email:%' OR key LIKE 'state:%' OR key LIKE 'account-policy:%')";
function fail(code: string): never { throw new Error(code); }
function randomCredential(length: number) { return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(length)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

/** Caller wraps each synchronous operation in transactionSync. No network or
 * cryptography runs while a transaction is open. Quarantined targets never
 * auto-open, even on timeout, crash, malformed input, or failed validation. */
export class BackupEngine {
  private journal: RecoveryJournal;
  constructor(private sql: SqlStorage, private store: StoreEngine) {
    this.journal = new RecoveryJournal(sql);
    sql.exec("CREATE TABLE IF NOT EXISTS recovery_control (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS backup_parts (archive TEXT,index_no INTEGER,digest TEXT,bytes INTEGER,row_count INTEGER,table_name TEXT,PRIMARY KEY(archive,index_no))");
    if (!this.get("identity")) this.set("identity", crypto.randomUUID());
  }
  private get<T>(key: string): T | undefined { const value = this.sql.exec("SELECT value FROM recovery_control WHERE key=?", key).toArray()[0]?.value; return value ? JSON.parse(String(value)) as T : undefined; }
  private set(key: string, value: unknown) { this.sql.exec("INSERT INTO recovery_control VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, JSON.stringify(value)); }
  private control(): Control { return this.get<Control>("control") ?? { mode: "active" }; }
  source() { return this.get<string>("identity")!; }
  status() { const state = this.control(); return { mode: state.mode, source: this.source(), watermark: this.journal.watermark(), ...(state.mode === "restore" ? { challenge: state.challenge, target: state.target, archiveId: state.snapshot.archiveId, next: state.next, ledgerNext: state.ledgerNext, ledgerArchiveId: state.ledger?.archiveId } : {}), ...(state.mode === "export" ? { expiresAt: new Date(state.expires).toISOString() } : {}), restored: this.get("restored"), legacyImportAllowed: !this.get("legacy-disabled") }; }
  assertAvailable() { const state = this.control(); if (state.mode === "export" && state.expires <= Date.now()) this.set("control", { mode: "active" }); else if (state.mode !== "active") fail("RECOVERY_MAINTENANCE"); }
  legacyAllowed() { return !this.get("legacy-disabled"); }
  begin(kind: "snapshot" | "ledger") {
    if (kind === "snapshot") this.assertAvailable();
    if (this.control().mode === "restore") fail("RECOVERY_MAINTENANCE");
    const archiveId = crypto.randomUUID(), nonce = crypto.randomUUID();
    const job: Job = { archiveId, source: this.source(), watermark: this.journal.watermark(), createdAt: Date.now(), kind, nonce, table: 0, offset: 0, next: 0, totalBytes: 0, totalRows: 0 };
    // Retain at most the ten most recent archive-job receipts; user data is not
    // stored here. Actual archives are held by the independently configured vault.
    const old = this.sql.exec("SELECT key FROM recovery_control WHERE key LIKE 'job:%' ORDER BY key LIMIT 100").toArray();
    if (old.length >= 10) for (const row of old.slice(0, old.length - 9)) { const previous = this.get<Job>(String(row.key)); if (previous) this.sql.exec("DELETE FROM backup_parts WHERE archive=?", previous.archiveId); this.sql.exec("DELETE FROM recovery_control WHERE key=?", String(row.key)); }
    this.set(`job:${archiveId}`, job);
    if (kind === "snapshot") this.set("control", { mode: "export", nonce, archiveId, expires: Date.now() + 15 * 60_000 });
    return { archiveId, nonce, source: job.source, watermark: job.watermark, kind };
  }
  private job(archiveId: string, nonce: string) {
    const job = this.get<Job>(`job:${id.parse(archiveId)}`);
    if (!job || job.nonce !== nonce) fail("BACKUP_JOB_INVALID");
    if (job.kind === "snapshot") { const state = this.control(); if (state.mode !== "export" || state.nonce !== nonce || state.expires <= Date.now()) fail("BACKUP_LEASE_EXPIRED"); }
    return job;
  }
  page(archiveId: string, nonce: string): ArchiveChunk | null {
    const job = this.job(archiveId, nonce), tables: Table[] = job.kind === "snapshot" ? snapshotTables : ["recovery_events"];
    while (job.table < tables.length) {
      const table = tables[job.table]!;
      const where = table === "records" ? `WHERE ${recordFilter}` : table === "recovery_events" ? "WHERE seq<=?" : "";
      const order = table === "records" ? "key" : table === "recovery_events" ? "seq" : table === "privacy_suppressions" ? "user_id" : "user_id,id";
      const selected = this.sql.exec(`SELECT * FROM ${table} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...(table === "recovery_events" ? [job.watermark] : []), table === "records" ? 2 : 64, job.offset).toArray();
      if (!selected.length) { job.table++; job.offset = 0; this.set(`job:${archiveId}`, job); continue; }
      const chunk: ArchiveChunk = { version: 1, kind: job.kind, archiveId, source: job.source, index: job.next, table, rows: [] };
      for (const row of selected) { this.validateRow(table, row); chunk.rows.push(row); if (new TextEncoder().encode(JSON.stringify(chunk)).length > BACKUP_CHUNK_BYTES) { chunk.rows.pop(); break; } }
      if (!chunk.rows.length) fail("BACKUP_ROW_LIMIT");
      return chunk;
    }
    return null;
  }
  acknowledge(archiveId: string, nonce: string, chunk: ArchiveChunk, digest: string, byteLength: number) {
    const job = this.job(archiveId, nonce);
    if (chunk.index !== job.next || job.next >= BACKUP_MAX_CHUNKS || job.totalBytes + byteLength > BACKUP_MAX_BYTES || job.totalRows + chunk.rows.length > 1_000_000) fail("BACKUP_LIMIT_OR_SEQUENCE");
    this.sql.exec("INSERT INTO backup_parts VALUES(?,?,?,?,?,?)", archiveId, chunk.index, digest, byteLength, chunk.rows.length, chunk.table);
    job.next++; job.offset += chunk.rows.length; job.totalBytes += byteLength; job.totalRows += chunk.rows.length; this.set(`job:${archiveId}`, job);
  }
  manifest(archiveId: string, nonce: string): ArchiveManifest {
    const job = this.job(archiveId, nonce); if (this.page(archiveId, nonce)) fail("BACKUP_INCOMPLETE");
    const chunks = this.sql.exec("SELECT index_no,digest,bytes,row_count,table_name FROM backup_parts WHERE archive=? ORDER BY index_no", archiveId).toArray().map(row => ({ index: Number(row.index_no), digest: String(row.digest), bytes: Number(row.bytes), rows: Number(row.row_count), table: row.table_name }));
    return archiveManifestSchema.parse({ version: 1, kind: job.kind, archiveId, source: job.source, watermark: job.watermark, createdAt: job.createdAt, chunks, totalBytes: job.totalBytes, totalRows: job.totalRows });
  }
  finish(archiveId: string, nonce: string) { const job = this.job(archiveId, nonce); if (this.page(archiveId, nonce)) fail("BACKUP_INCOMPLETE"); if (job.kind === "snapshot") this.set("control", { mode: "active" }); return { complete: true }; }
  cancel(archiveId: string, nonce: string) { const state = this.control(); if (state.mode !== "export" || state.archiveId !== archiveId || state.nonce !== nonce) fail("BACKUP_JOB_INVALID"); this.set("control", { mode: "active" }); return { cancelled: true }; }
  retire(input: { target: string; challenge: string; backupId: string; source: string; confirm: string }) {
    if (!/^mira-recovery-[a-z0-9-]{8,80}$/.test(input.target) || input.confirm !== "RETIRE mira-production-v1" || input.source !== this.source()) fail("CUTOVER_CONFIRMATION_REQUIRED");
    id.parse(input.challenge); id.parse(input.backupId);
    const state = this.control();
    if (state.mode === "retired") { if (state.target !== input.target || state.challenge !== input.challenge || state.backupId !== input.backupId) fail("SOURCE_ALREADY_RETIRED"); }
    else { this.assertAvailable(); this.set("control", { mode: "retired", target: input.target, challenge: input.challenge, backupId: input.backupId, watermark: this.journal.watermark() }); }
    const retired = this.control() as Extract<Control, { mode: "retired" }>;
    return { version: 1, source: this.source(), target: retired.target, challenge: retired.challenge, backupId: retired.backupId, watermark: retired.watermark, issuedAt: Date.now(), sourceRetired: true };
  }
  beginRestore(raw: unknown, target: string) {
    const manifest = this.validateManifest(raw);
    if (manifest.kind !== "snapshot" || !/^mira-recovery-[a-z0-9-]{8,80}$/.test(target) || this.control().mode !== "active") fail("RESTORE_TARGET_INVALID");
    if (Number(this.sql.exec("SELECT count(*) AS count FROM records").toArray()[0]?.count) || Number(this.sql.exec("SELECT count(*) AS count FROM transcripts").toArray()[0]?.count) || this.journal.watermark()) fail("RESTORE_TARGET_NOT_EMPTY");
    const state: Control = { mode: "restore", target, challenge: crypto.randomUUID(), snapshot: manifest, next: 0, ledgerNext: 0, ledgerSequence: 0, validatedAccounts: 0 };
    this.set("legacy-disabled", true); this.set("control", state); return this.status();
  }
  private restore() { const state = this.control(); if (state.mode !== "restore") fail("RESTORE_NOT_QUARANTINED"); return state; }
  setLedger(raw: unknown) { const state = this.restore(), ledger = this.validateManifest(raw); if (state.ledger?.archiveId === ledger.archiveId && JSON.stringify(state.ledger) === JSON.stringify(ledger)) return { accepted: true, resumed: true }; if (ledger.kind !== "ledger" || ledger.source !== state.snapshot.source || ledger.watermark < state.snapshot.watermark || state.ledgerNext) fail("RESTORE_LEDGER_INVALID"); state.ledger = ledger; this.set("control", state); return { accepted: true }; }
  importChunk(value: unknown, digest: string) {
    const state = this.restore();
    const chunk = z.object({ version: z.literal(1), kind: z.enum(["snapshot", "ledger"]), archiveId: id, source: id, index: integer, table: z.enum(Object.keys(rows) as [Table, ...Table[]]), rows: z.array(z.record(z.string(), z.unknown())).max(128) }).strict().parse(value);
    const manifest = chunk.kind === "snapshot" ? state.snapshot : state.ledger;
    if (!manifest || chunk.archiveId !== manifest.archiveId || chunk.source !== manifest.source || digest !== manifest.chunks[chunk.index]?.digest || chunk.table !== manifest.chunks[chunk.index]?.table || chunk.rows.length !== manifest.chunks[chunk.index]?.rows) fail("RESTORE_CHUNK_MISMATCH");
    const next = chunk.kind === "snapshot" ? state.next : state.ledgerNext;
    if (chunk.index < next) return { imported: true, duplicate: true };
    if (chunk.index !== next || (chunk.kind === "ledger" && state.next !== state.snapshot.chunks.length)) fail("RESTORE_CHUNK_ORDER");
    for (const row of chunk.rows) {
      this.validateRow(chunk.table, row);
      if (chunk.table === "recovery_events") {
        if (row.seq !== state.ledgerSequence + 1) fail("RESTORE_LEDGER_GAP");
        state.ledgerSequence++;
        if (Number(row.seq) > state.snapshot.watermark) this.replay(event.parse(JSON.parse(String(row.value))));
      }
      const keys = Object.keys(rows[chunk.table].shape);
      this.sql.exec(`INSERT INTO ${chunk.table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`, ...keys.map(key => row[key] as string | number | null));
    }
    if (chunk.kind === "snapshot") state.next++; else state.ledgerNext++;
    this.set("control", state); return { imported: true, next: chunk.kind === "snapshot" ? state.next : state.ledgerNext };
  }
  private validateManifest(raw: unknown) {
    const manifest = archiveManifestSchema.parse(raw);
    if (manifest.chunks.some((part, index) => part.index !== index || (manifest.kind === "ledger" ? part.table !== "recovery_events" : !snapshotTables.includes(part.table))) || manifest.totalBytes !== manifest.chunks.reduce((sum, part) => sum + part.bytes, 0) || manifest.totalRows !== manifest.chunks.reduce((sum, part) => sum + part.rows, 0) || (manifest.kind === "ledger" && manifest.totalRows !== manifest.watermark)) fail("BACKUP_MANIFEST_INVALID");
    return manifest;
  }
  private validateRow(table: Table, raw: Record<string, unknown>) {
    const row = rows[table].parse(raw);
    if (table === "records") {
      const record = row as z.infer<typeof rows.records>;
      if (record.deleted) { if (record.value !== null) fail("BACKUP_TOMBSTONE_CONTENT"); return; }
      if (record.value === null || record.expires !== null) fail("BACKUP_RECORD_INVALID");
      if (record.key.startsWith("state:")) { const state = decodeAccountState(record.value); if (state.revision < 1 || state.state.user.id !== record.key.slice(6) || state.state.messages.length) fail("BACKUP_PROFILE_INVALID"); }
      else if (record.key.startsWith("account:")) {
        const account = z.object({ id, email: z.email().max(254), emailKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/), name: z.string().max(80), passwordHash: z.string().regex(/^[A-Za-z0-9_-]{43}$/), passwordSalt: z.string().regex(/^[A-Za-z0-9_-]{22}$/), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), passwordChangedAt: z.iso.datetime().optional(), passwordAlgorithm: z.literal("pbkdf2-sha256").optional(), passwordIterations: z.literal(100000).optional(), emailVerifiedAt: z.iso.datetime().optional(), passwordResetRequired: z.boolean().optional(), recoveryVerificationRequired: z.boolean().optional() }).strict().parse(JSON.parse(record.value));
        if (account.id !== record.key.slice(8)) fail("BACKUP_OWNER_MISMATCH");
      } else if (record.key.startsWith("email:")) id.parse(record.value);
      else z.object({ version: z.literal(1), termsVersion: z.string().max(80), adultDeclaredAt: z.iso.datetime(), consentUpdatedAt: z.iso.datetime(), aiProcessingConsent: z.boolean(), memoryEnabled: z.boolean(), conversationStorageEnabled: z.boolean() }).strict().parse(JSON.parse(record.value));
    }
    if (table === "transcripts") { const transcript = row as z.infer<typeof rows.transcripts>, message = accountMessageSchema.parse(JSON.parse(transcript.value)); if (message.id !== transcript.id || message.createdAt !== transcript.created_at) fail("BACKUP_TRANSCRIPT_INVALID"); }
    if (table === "recovery_events") event.parse(JSON.parse(String(raw.value)));
  }
  private replay(change: RecoveryEvent) {
    if (change.kind === "account") {
      const raw = this.store.get(`account:${change.userId}`), account = raw ? JSON.parse(raw) as { emailKey: string } : null;
      this.sql.exec("DELETE FROM transcripts WHERE user_id=?", change.userId); this.sql.exec("DELETE FROM account_conversations WHERE user_id=?", change.userId);
      for (const key of [`account:${change.userId}`, `state:${change.userId}`, `account-policy:${change.userId}`, ...(account ? [`email:${account.emailKey}`] : [])]) this.sql.exec("INSERT INTO records(key,value,expires,deleted) VALUES(?,NULL,NULL,1) ON CONFLICT(key) DO UPDATE SET value=NULL,expires=NULL,deleted=1", key);
      this.sql.exec("DELETE FROM memory_suppressions WHERE user_id=?", change.userId); this.sql.exec("DELETE FROM privacy_suppressions WHERE user_id=?", change.userId);
    } else if (change.kind === "memory") this.sql.exec("INSERT OR REPLACE INTO memory_suppressions VALUES(?,?,?)", change.userId, change.id, Date.now());
    else if (change.kind === "conversation") {
      this.sql.exec("INSERT INTO account_conversations(user_id,id,deleted) VALUES(?,?,1) ON CONFLICT(user_id,id) DO UPDATE SET deleted=1", change.userId, change.id);
      this.sql.exec("DELETE FROM transcripts WHERE user_id=? AND json_extract(value,'$.conversationId')=?", change.userId, change.id);
      const raw = this.store.get(`state:${change.userId}`);
      if (raw) { const envelope = decodeAccountState(raw); envelope.state.companionReflections = []; this.sql.exec("UPDATE records SET value=? WHERE key=?", JSON.stringify(envelope), `state:${change.userId}`); }
    }
    else {
      const raw = this.store.get(`state:${change.userId}`), envelope = raw ? decodeAccountState(raw) : null;
      if (!envelope) return;
      if (!change.history) { this.sql.exec("DELETE FROM transcripts WHERE user_id=?", change.userId); envelope.state.calls = []; envelope.state.feedbackSignals = []; envelope.state.companionReflections = []; envelope.state.messages = []; this.sql.exec("UPDATE records SET value=? WHERE key=?", JSON.stringify(envelope), `state:${change.userId}`); }
      this.sql.exec("INSERT OR REPLACE INTO privacy_suppressions VALUES(?,?,?,?,?)", change.userId, Math.max(change.revision, envelope.revision + 1), change.ai ? 0 : 1, change.history ? 0 : 1, change.memory ? 0 : 1);
    }
  }
  finalize(proofRaw: unknown) {
    const state = this.restore();
    const proof = z.object({ version: z.literal(1), source: id, target: id, challenge: id, backupId: id, watermark: integer, issuedAt: integer, sourceRetired: z.literal(true) }).strict().parse(proofRaw);
    if (!state.ledger || proof.source !== state.snapshot.source || proof.target !== state.target || proof.challenge !== state.challenge || proof.backupId !== state.snapshot.archiveId || proof.watermark !== state.ledger.watermark || proof.issuedAt > Date.now() + 30_000 || proof.issuedAt < Date.now() - 30 * 60_000) fail("RESTORE_CURRENT_CUTOVER_PROOF_REQUIRED");
    if (state.next !== state.snapshot.chunks.length || state.ledgerNext !== state.ledger.chunks.length || state.ledgerSequence !== state.ledger.watermark) fail("RESTORE_INCOMPLETE");
    const accounts = this.sql.exec("SELECT key,value FROM records WHERE key LIKE 'account:%' AND deleted=0 ORDER BY key LIMIT 11 OFFSET ?", state.validatedAccounts).toArray();
    for (const row of accounts.slice(0, 10)) {
      const account = JSON.parse(String(row.value)) as Record<string, unknown>, userId = String(account.id);
      const profile = this.store.readAccountState(userId);
      if (!profile || this.store.get(`email:${String(account.emailKey)}`) !== userId || profile.state.memories.some(memory => memory.userId !== userId)) fail("RESTORE_OWNER_INVARIANT");
      const conversation = this.sql.exec("SELECT id FROM account_conversations WHERE user_id=? AND id=? AND deleted=0", userId, profile.state.activeConversationId).toArray()[0];
      if (!conversation) { profile.state.activeConversationId = crypto.randomUUID(); profile.state.messages = []; this.sql.exec("INSERT INTO account_conversations(user_id,id,deleted) VALUES(?,?,0)", userId, profile.state.activeConversationId); this.sql.exec("UPDATE records SET value=? WHERE key=?", JSON.stringify(profile), `state:${userId}`); }
      // No old password, session, reset link or verified-address assertion can
      // become valid again after a restore. Real sender configuration is a gate.
      account.passwordHash = randomCredential(32); account.passwordSalt = randomCredential(16); account.passwordChangedAt = new Date().toISOString(); account.passwordResetRequired = true; account.recoveryVerificationRequired = true; delete account.emailVerifiedAt;
      this.sql.exec("UPDATE records SET value=? WHERE key=?", JSON.stringify(account), String(row.key));
      const policy = JSON.parse(this.store.get(`account-policy:${userId}`) ?? "null");
      if (!policy) fail("RESTORE_OWNER_INVARIANT");
      this.sql.exec("UPDATE records SET value=? WHERE key=?", JSON.stringify({ ...policy, termsVersion: "recovery-reverification-required" }), `account-policy:${userId}`);
      state.validatedAccounts++;
    }
    this.set("control", state);
    if (accounts.length > 10) return { complete: false, validatedAccounts: state.validatedAccounts };
    const orphan = this.sql.exec("SELECT t.id FROM transcripts t LEFT JOIN records a ON a.key='account:'||t.user_id AND a.deleted=0 LEFT JOIN account_conversations c ON c.user_id=t.user_id AND c.id=json_extract(t.value,'$.conversationId') AND c.deleted=0 WHERE a.key IS NULL OR c.id IS NULL LIMIT 1").toArray();
    const orphanProfile = this.sql.exec("SELECT p.key FROM records p LEFT JOIN records a ON a.key='account:'||substr(p.key,instr(p.key,':')+1) AND a.deleted=0 WHERE (p.key LIKE 'state:%' OR p.key LIKE 'account-policy:%') AND p.deleted=0 AND a.key IS NULL LIMIT 1").toArray();
    if (orphan.length || orphanProfile.length || Number(this.sql.exec("SELECT count(*) AS count FROM records WHERE key LIKE 'account:%' AND deleted=0").toArray()[0]?.count) > 5000) fail("RESTORE_OWNER_INVARIANT");
    this.set("restored", { archiveId: state.snapshot.archiveId, source: state.snapshot.source, watermark: proof.watermark, completedAt: Date.now(), passwordsResetRequired: true, emailReverificationRequired: true });
    this.set("control", { mode: "active" });
    return { complete: true, validatedAccounts: state.validatedAccounts, passwordsResetRequired: true, emailReverificationRequired: true, note: "Target is validated; routing cutover and offsite availability require separate operator verification." };
  }
}

export type BackupSealed = SealedBackup;
