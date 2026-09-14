import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoreEngine, type SqlStorage } from "./store-engine";
import { BackupEngine } from "./backup-engine";
import { runBackupOperation } from "./backup-operations";
import { backupDigest, openBackup, sealBackup, type BackupKey } from "./backup-crypto";
import { freshDemo } from "./demo-storage";
import { RecoveryJournal } from "./recovery-journal";
import { SuppressionAuthorityEngine } from "./suppression-authority";
import { advanceCheckpoint, genesisCheckpoint, type Writer } from "./suppression-protocol";
import { prepareAuthorityQuarantine, verifyAuthorityQuarantinePage, type AuthorityPreparationArchive, type AuthorityPreparationInput } from "./authority-quarantine";
import type { AuthorityQuarantineReader } from "./authority-quarantine-protocol";
// @ts-expect-error The existing independently executable vault adapter uses .mjs.
import { captureArchive } from "../scripts/backup-vault.mjs";

let directory: string, key: BackupKey;
const handles = new Set<DatabaseSync>();
const externalFetch = vi.fn(async () => { throw Error("External network forbidden in quarantine tests"); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept; }); return { promise, resolve }; }
function database(name: string) {
  const path = join(directory, name), db = new DatabaseSync(path); handles.add(db);
  let inTransaction = false;
  const sql: SqlStorage = { exec(query, ...values) { const rows = db.prepare(query).all(...values) as Record<string, unknown>[]; return { toArray: () => rows }; } };
  const transaction = <T>(work: () => T): T => {
    db.exec("BEGIN IMMEDIATE"); inTransaction = true;
    try { const value = work(); if (value instanceof Promise) throw Error("Async SQL transaction"); db.exec("COMMIT"); return value; }
    catch (cause) { db.exec("ROLLBACK"); throw cause; }
    finally { inTransaction = false; }
  };
  const store = new StoreEngine(sql), backup = new BackupEngine(sql, store), journal = new RecoveryJournal(sql);
  const call = (input: Record<string, unknown>) => runBackupOperation(backup, transaction, { MIRA_BACKUP_KEY: key.material, MIRA_BACKUP_KEY_ID: key.keyId }, input);
  return { path, db, sql, store, backup, journal, transaction, call, inTransaction: () => inTransaction, close() { db.close(); handles.delete(db); } };
}
type Database = ReturnType<typeof database>;
async function account(source: Database, name: string) {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const emailKey = (await backupDigest(`${name}@example.test`)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const state = freshDemo(); state.user.id = id; state.user.name = name; state.user.adultConfirmed = true;
  state.memoryEnabled = true; state.aiProcessingConsent = true; state.conversationStorageEnabled = true;
  state.messages = [0, 1].map(index => ({ id: `${name}-${index}`, conversationId: state.activeConversationId, role: "user" as const, content: `Synthetic ${name} transcript ${index}`, createdAt: new Date(Date.now() - 10 + index).toISOString() }));
  source.transaction(() => source.store.bootstrap(`email:${emailKey}`, { id, name, emailKey, email: `${name}@example.test`, passwordHash: "a".repeat(43), passwordSalt: "b".repeat(22), emailVerifiedAt: now, createdAt: now, updatedAt: now } as { id: string }, state, `session:${name}`, JSON.stringify({ userId: id, createdAt: now }), 86400));
  return { id, emailKey, conversationId: state.activeConversationId };
}
async function snapshot(source: Database, vault = "vault"): Promise<AuthorityPreparationArchive> {
  const captured = await captureArchive(source.call, join(directory, vault), key);
  return { sealedManifest: captured.sealed, readSealedChunk: async index => JSON.parse(await readFile(join(captured.directory, `${String(index).padStart(6, "0")}.sealed.json`), "utf8")) };
}
async function fixture() {
  const source = database("source.sqlite"), remote = database("authority.sqlite"), target = database("target.sqlite");
  const kept = await account(source, "kept"), removed = await account(source, "removed"), history = await account(source, "history");
  const revision = (userId: string) => source.store.readAccountState(userId)!.revision;
  for (const content of ["Synthetic old corrected secret", "Synthetic forgotten secret"]) source.transaction(() => source.store.memoryCommand(kept.id, { action: "create", content }, revision(kept.id)));
  const [edited, forgotten] = source.store.readAccountState(kept.id)!.state.memories;
  const archive = await snapshot(source);
  const core = new SuppressionAuthorityEngine(remote.sql, remote.transaction, "synthetic-authority");
  const writer: Writer = { authorityId: "synthetic-authority", source: source.backup.source(), writerId: "synthetic-writer", epoch: 1 };
  await core.enroll(writer.source, writer.writerId);
  const reader: AuthorityQuarantineReader = {
    authorityId: writer.authorityId,
    fence: vi.fn(async (owner, destination, challenge, signal) => { signal.throwIfAborted(); expect(target.inTransaction()).toBe(false); return core.fence(owner, destination, challenge); }),
    read: vi.fn(async (owner, after, limit, signal) => { signal.throwIfAborted(); expect(target.inTransaction()).toBe(false); return core.read(owner, after, limit); }),
  };
  const input: AuthorityPreparationInput = { engine: target.backup, transaction: target.transaction, archive, key, target: "mira-recovery-quarantine-target", expectedWriter: writer, authority: reader };
  async function replicate() {
    let after = await genesisCheckpoint(writer);
    while (after.sequence < source.journal.watermark()) { const reply = await core.append({ writer, after, entries: source.journal.page(after.sequence, source.journal.watermark()) }); after = { sequence: reply.sequence, digest: reply.digest }; }
    return after;
  }
  function mutate() {
    source.transaction(() => source.store.memoryCommand(kept.id, { action: "edit", id: edited!.id, content: "Synthetic new corrected preference" }, revision(kept.id)));
    source.transaction(() => source.store.memoryCommand(kept.id, { action: "forget", id: forgotten!.id }, revision(kept.id)));
    source.transaction(() => source.store.conversationCommand(history.id, { action: "delete", id: history.conversationId }, revision(history.id)));
    source.transaction(() => source.store.acceptPolicy(history.id, { aiProcessingConsent: false, memoryEnabled: false, conversationStorageEnabled: false }, revision(history.id)));
    source.transaction(() => source.store.acceptPolicy(history.id, { aiProcessingConsent: true, memoryEnabled: true, conversationStorageEnabled: true }, revision(history.id)));
    source.transaction(() => source.store.eraseAccount(removed.id, removed.emailKey, []));
  }
  return { source, remote, target, kept, removed, history, archive, core, writer, reader, input, replicate, mutate };
}
async function finish(input: AuthorityPreparationInput) {
  for (let attempt = 0; attempt < 100; attempt++) { const state = await prepareAuthorityQuarantine(input); if (state.prepared) return state; }
  throw Error("Synthetic preparation bound exceeded");
}
async function snapshotOnly(input: AuthorityPreparationInput) {
  const unavailable: AuthorityQuarantineReader = { ...input.authority, read: async () => { throw Error("Synthetic pause before journal"); } };
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await prepareAuthorityQuarantine({ ...input, authority: unavailable }); } catch (cause) { expect((cause as Error).message).toBe("RESTORE_AUTHORITY_UNAVAILABLE"); }
    const state = input.transaction(() => input.engine.authorityPreparationState());
    if (state.snapshotNext === state.snapshotChunks) { expect(state.cursor.sequence).toBe(0); return state; }
  }
  throw Error("Synthetic snapshot bound exceeded");
}
function data(target: Database) { return JSON.stringify(target.sql.exec("SELECT key,value,deleted FROM records ORDER BY key").toArray()); }
beforeEach(async () => { externalFetch.mockClear(); vi.stubGlobal("fetch", externalFetch); directory = await mkdtemp(join(tmpdir(), "mira-authority-quarantine-test-")); key = { keyId: "synthetic-key", material: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64") }; });
afterEach(async () => { for (const db of handles) db.close(); handles.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }); expect(externalFetch).not.toHaveBeenCalled(); });

describe("dormant source-independent authority quarantine preparation", () => {
  it("destroys the source before retirement, replays later suppression and resets credentials without opening the restored target", async () => {
    const setup = await fixture(), retire = vi.spyOn(setup.source.backup, "retire");
    setup.mutate(); const head = await setup.replicate();
    setup.source.close(); await unlink(setup.source.path);
    await expect(readFile(setup.source.path)).rejects.toMatchObject({ code: "ENOENT" });
    const started = performance.now(), prepared = await finish(setup.input), elapsedMs = performance.now() - started;
    expect(prepared).toMatchObject({ prepared: true, coverageVerified: false, servingAllowed: false, mode: "restore", cursor: head });
    expect(retire).not.toHaveBeenCalled(); expect(() => setup.target.backup.assertAvailable()).toThrow("RECOVERY_MAINTENANCE");
    expect(setup.target.backup.status()).toMatchObject({ mode: "restore", prepared: true, servingAllowed: false, coverageVerified: false, legacyImportAllowed: false, restored: undefined });
    expect(setup.target.store.get(`account:${setup.removed.id}`)).toBeNull();
    const kept = setup.target.transaction(() => setup.target.store.readAccountState(setup.kept.id))!;
    const history = setup.target.transaction(() => setup.target.store.readAccountState(setup.history.id))!;
    expect(kept.state.messages).toHaveLength(2); expect(kept.state.memories).toEqual([]);
    expect(history.state.messages).toEqual([]); expect(history.state.conversationStorageEnabled).toBe(true);
    expect(setup.target.store.get("session:kept")).toBeNull();
    const credentials = JSON.parse(setup.target.store.get(`account:${setup.kept.id}`)!);
    expect(credentials).toMatchObject({ passwordResetRequired: true, recoveryVerificationRequired: true });
    expect(credentials.passwordHash).not.toBe("a".repeat(43)); expect(credentials.emailVerifiedAt).toBeUndefined();
    expect(data(setup.target)).not.toContain("Synthetic old corrected secret"); expect(data(setup.target)).not.toContain("Synthetic forgotten secret");
    console.log(JSON.stringify({ evidence: "source-independent-quarantined-preparation", sourceRemovedBeforeRetirement: true, replayedEvents: head.sequence, elapsedMs: Math.round(elapsedMs * 100) / 100, coverageVerified: false, servingAllowed: false, offsiteConfigured: false }));
  });

  it("pins writer, target, archive identity and digest through a target restart and rejects archive substitution after fencing", async () => {
    const setup = await fixture(); setup.mutate(); await setup.replicate();
    const state = await snapshotOnly(setup.input), before = data(setup.target), challenge = state.binding.challenge;
    setup.target.close(); const reopened = database("target.sqlite"), input = { ...setup.input, engine: reopened.backup, transaction: reopened.transaction };
    const manifest = await openBackup(setup.archive.sealedManifest, "manifest", key) as Record<string, unknown>;
    for (const replacement of [{ ...manifest, archiveId: "substituted-archive" }, { ...manifest, createdAt: Number(manifest.createdAt) + 1 }]) {
      const sealedManifest = await sealBackup(replacement, "manifest", key);
      await expect(prepareAuthorityQuarantine({ ...input, archive: { ...setup.archive, sealedManifest } })).rejects.toThrow("RESTORE_AUTHORITY_BINDING_CHANGED");
    }
    await expect(prepareAuthorityQuarantine({ ...input, target: "mira-recovery-different-target" })).rejects.toThrow("RESTORE_AUTHORITY_BINDING_CHANGED");
    await expect(prepareAuthorityQuarantine({ ...input, expectedWriter: { ...setup.writer, writerId: "replacement-writer" } })).rejects.toThrow("RESTORE_AUTHORITY_BINDING_CHANGED");
    await expect(prepareAuthorityQuarantine({ ...input, expectedWriter: { ...setup.writer, source: "wrong-source" } })).rejects.toThrow("RESTORE_AUTHORITY_BINDING_INVALID");
    expect(data(reopened)).toBe(before); expect(reopened.backup.authorityPreparationState().binding.challenge).toBe(challenge);
    expect(() => reopened.backup.assertAvailable()).toThrow("RECOVERY_MAINTENANCE");
  });

  it("requires a fresh matching authority fence on every resume and never substitutes stale or unavailable authority state", async () => {
    const setup = await fixture(); setup.mutate(); await setup.replicate();
    const manifest = await openBackup(setup.archive.sealedManifest, "manifest", key) as { watermark: number };
    const old: AuthorityQuarantineReader = { ...setup.reader, fence: async (...args) => ({ ...await setup.reader.fence(...args) as object, sequence: manifest.watermark - 1 }) };
    await expect(prepareAuthorityQuarantine({ ...setup.input, authority: old })).rejects.toThrow("RESTORE_AUTHORITY_FENCE_INVALID");
    expect(setup.target.backup.authorityPreparationState().snapshotNext).toBe(0);
    const state = await snapshotOnly(setup.input), saved = data(setup.target);
    for (const change of [{ challenge: "stale-challenge" }, { target: "mira-recovery-another-target" }, { writerId: "stale-writer" }, { sequence: state.fence!.sequence - 1 }]) {
      const stale = { ...setup.reader, fence: async () => ({ ...state.fence, ...change }) };
      await expect(prepareAuthorityQuarantine({ ...setup.input, authority: stale })).rejects.toThrow(/RESTORE_AUTHORITY_FENCE_(INVALID|CHANGED)/);
    }
    const offline = { ...setup.reader, fence: vi.fn(async () => { throw Error("Unavailable independent service"); }) };
    await expect(prepareAuthorityQuarantine({ ...setup.input, authority: offline })).rejects.toThrow("RESTORE_AUTHORITY_UNAVAILABLE");
    expect(offline.fence).toHaveBeenCalledTimes(1); expect(data(setup.target)).toBe(saved);
    expect(setup.target.backup.authorityPreparationState().cursor.sequence).toBe(0);
    expect(() => setup.target.backup.assertAvailable()).toThrow("RECOVERY_MAINTENANCE");
  });

  it("rejects malformed, conflicting, out-of-order and oversized pages and rolls back a partial SQL replay failure", async () => {
    const setup = await fixture(); setup.mutate(); await setup.replicate();
    const state = await snapshotOnly(setup.input), before = data(setup.target), raw = setup.core.read(setup.writer, state.cursor, 128);
    const mutations: unknown[] = [
      { ...raw, entries: [raw.entries[1], raw.entries[0], ...raw.entries.slice(2)] },
      { ...raw, entries: raw.entries.slice(1) },
      { ...raw, entries: [] },
      { ...raw, entries: Array.from({ length: 129 }, () => raw.entries[0]) },
      { ...raw, checkpoint: { ...raw.checkpoint, digest: "A".repeat(43) + "=" } },
      { ...raw, head: { ...raw.head, writerId: "wrong-writer" } },
      { ...raw, fenced: false },
      { ...raw, entries: [{ ...raw.entries[0], event: { ...raw.entries[0]!.event, content: "Forbidden plaintext" } }, ...raw.entries.slice(1)] },
      { ...raw, entries: [{ ...raw.entries[0], event: { kind: "account", userId: "different-owner" } }, ...raw.entries.slice(1)] },
    ];
    for (const page of mutations) {
      const reader = { ...setup.reader, read: async () => page };
      await expect(prepareAuthorityQuarantine({ ...setup.input, authority: reader })).rejects.toThrow();
      expect(setup.target.backup.authorityPreparationState().cursor.sequence).toBe(0); expect(data(setup.target)).toBe(before);
    }
    setup.target.sql.exec("CREATE TRIGGER synthetic_replay_failure BEFORE INSERT ON recovery_events WHEN NEW.seq=5 BEGIN SELECT RAISE(ABORT,'SYNTHETIC_STORAGE_FAILURE'); END");
    await expect(prepareAuthorityQuarantine(setup.input)).rejects.toThrow("SYNTHETIC_STORAGE_FAILURE");
    expect(setup.target.journal.watermark()).toBe(0); expect(data(setup.target)).toBe(before);
    expect(setup.target.sql.exec("SELECT * FROM authority_restore_pages").toArray()).toEqual([]);
    setup.target.sql.exec("DROP TRIGGER synthetic_replay_failure");
    expect((await finish(setup.input)).prepared).toBe(true);
  });

  it("persists bounded replay progress, retries exact pages without replay, and resumes after target loss of process state", async () => {
    const setup = await fixture(); setup.mutate();
    setup.source.transaction(() => { for (let index = 0; index < 260; index++) setup.source.journal.append({ kind: "memory", userId: setup.kept.id, id: `synthetic-old-memory-${index}` }); });
    const expectedHead = await setup.replicate(); const initial = await snapshotOnly(setup.input);
    const firstRaw = setup.core.read(setup.writer, initial.cursor, 128);
    const firstVerified = await verifyAuthorityQuarantinePage(initial.binding, initial.fence!, initial.cursor, firstRaw);
    let calls = 0;
    const interrupted = { ...setup.reader, read: async (...args: Parameters<AuthorityQuarantineReader["read"]>) => { if (++calls > 1) throw Error("Synthetic lost process after first committed page"); return setup.reader.read(...args); } };
    await expect(prepareAuthorityQuarantine({ ...setup.input, authority: interrupted })).rejects.toThrow("RESTORE_AUTHORITY_UNAVAILABLE");
    expect(setup.target.backup.authorityPreparationState().cursor.sequence).toBe(128);
    const beforeRetry = data(setup.target);
    expect(setup.target.transaction(() => setup.target.backup.importAuthorityPage(firstVerified))).toMatchObject({ imported: true, duplicate: true });
    expect(data(setup.target)).toBe(beforeRetry);
    const changedEntries = [{ ...firstRaw.entries[0]!, event: { kind: "account" as const, userId: "conflicting-retry" } }, ...firstRaw.entries.slice(1)];
    const changedCheckpoint = await advanceCheckpoint(setup.writer, initial.cursor, changedEntries);
    const changed = await verifyAuthorityQuarantinePage(initial.binding, initial.fence!, initial.cursor, { ...firstRaw, entries: changedEntries, checkpoint: changedCheckpoint });
    expect(() => setup.target.transaction(() => setup.target.backup.importAuthorityPage(changed))).toThrow("RESTORE_AUTHORITY_PAGE_CONFLICT");
    setup.target.close(); const reopened = database("target.sqlite"), input = { ...setup.input, engine: reopened.backup, transaction: reopened.transaction };
    const result = await finish(input); expect(result.prepared).toBe(true); expect(result.cursor).toEqual(expectedHead);
    const credential = reopened.store.get(`account:${setup.kept.id}`);
    await finish(input); expect(reopened.store.get(`account:${setup.kept.id}`)).toBe(credential);
    expect(reopened.sql.exec("SELECT count(*) AS n FROM authority_restore_pages").toArray()[0]!.n).toBe(3);
    expect(() => reopened.backup.assertAvailable()).toThrow("RECOVERY_MAINTENANCE");
  });

  it("denies a competing target and old writer, and a validly encrypted legacy proof cannot open authority mode", async () => {
    const setup = await fixture(); setup.mutate(); await setup.replicate();
    const prepared = await finish(setup.input), other = database("other-target.sqlite");
    await expect(prepareAuthorityQuarantine({ ...setup.input, engine: other.backup, transaction: other.transaction, target: "mira-recovery-competing-target" })).rejects.toThrow("RESTORE_AUTHORITY_UNAVAILABLE");
    await expect(setup.core.append({ writer: setup.writer, after: await genesisCheckpoint(setup.writer), entries: [] })).rejects.toThrow("SUPPRESSION_WRITER_FENCED");
    const legacyProof = { version: 1, source: setup.writer.source, target: setup.input.target, challenge: prepared.binding.challenge, backupId: prepared.binding.archiveId, watermark: prepared.fence!.sequence, issuedAt: Date.now(), sourceRetired: true };
    const sealed = await sealBackup(legacyProof, "cutover", key);
    await expect(setup.target.call({ operation: "restoreFinalize", sealed })).rejects.toThrow("RESTORE_AUTHORITY_QUARANTINED");
    expect(() => setup.target.transaction(() => setup.target.backup.finalize(null))).toThrow("RESTORE_AUTHORITY_QUARANTINED");
    expect(() => setup.target.transaction(() => setup.target.backup.setLedger({}))).toThrow("RESTORE_AUTHORITY_QUARANTINED");
    for (const db of [setup.target, other]) expect(() => db.backup.assertAvailable()).toThrow("RECOVERY_MAINTENANCE");
    expect(setup.target.backup.status()).toMatchObject({ mode: "restore", prepared: true, coverageVerified: false, servingAllowed: false, restored: undefined });
  });

  it("rejects targets containing only an archived suppression or conversation row without clearing them or changing identity", async () => {
    const setup = await fixture();
    const cases = [
      { table: "memory_suppressions", insert: "INSERT INTO memory_suppressions VALUES(?,?,?)", values: [setup.kept.id, "existing-forgotten-id", 1] },
      { table: "privacy_suppressions", insert: "INSERT INTO privacy_suppressions VALUES(?,?,?,?,?)", values: [setup.kept.id, 1, 1, 1, 1] },
      { table: "account_conversations", insert: "INSERT INTO account_conversations VALUES(?,?,?)", values: [setup.kept.id, "existing-deleted-conversation", 1] },
    ];
    for (const item of cases) {
      const target = database(`nonempty-${item.table}.sqlite`), identity = target.backup.source();
      target.sql.exec(item.insert, ...item.values);
      const before = target.sql.exec(`SELECT * FROM ${item.table}`).toArray();
      await expect(prepareAuthorityQuarantine({ ...setup.input, engine: target.backup, transaction: target.transaction })).rejects.toThrow("RESTORE_TARGET_NOT_EMPTY");
      expect(target.sql.exec(`SELECT * FROM ${item.table}`).toArray()).toEqual(before);
      expect(target.backup.source()).toBe(identity); expect(target.backup.status().mode).toBe("active");
      expect(target.sql.exec("SELECT count(*) AS n FROM records").toArray()[0]!.n).toBe(0);
    }
    expect(setup.reader.fence).not.toHaveBeenCalled();
  });

  it("cancels an in-flight authority call and ignores its late fence while requiring fresh authority on retry", async () => {
    const setup = await fixture(); setup.mutate(); await setup.replicate();
    const cancelled = new AbortController(), ready = deferred<unknown>(), late = deferred<unknown>();
    let readerSignal: AbortSignal | undefined;
    const delayed: AuthorityQuarantineReader = { ...setup.reader, fence: async (...args) => {
      readerSignal = args[3];
      // The authority may have committed revocation before the receipt is lost.
      const receipt = await setup.reader.fence(...args); ready.resolve(receipt);
      return late.promise;
    } };
    const pending = prepareAuthorityQuarantine({ ...setup.input, authority: delayed, signal: cancelled.signal });
    const receipt = await ready.promise, before = data(setup.target);
    cancelled.abort();
    await expect(pending).rejects.toThrow("RESTORE_AUTHORITY_UNAVAILABLE");
    expect(readerSignal!.aborted).toBe(true);
    expect(setup.target.backup.authorityPreparationState()).toMatchObject({ snapshotNext: 0, fence: null, cursor: { sequence: 0 } });
    late.resolve(receipt); await Promise.resolve(); await Promise.resolve();
    expect(data(setup.target)).toBe(before);
    expect(setup.target.backup.authorityPreparationState()).toMatchObject({ snapshotNext: 0, fence: null, prepared: false });
    expect(() => setup.target.backup.assertAvailable()).toThrow("RECOVERY_MAINTENANCE");
    expect((await finish(setup.input)).prepared).toBe(true);
    expect(vi.mocked(setup.reader.fence).mock.calls.length).toBeGreaterThan(1);
  });

  it("enforces the reader deadline and ignores a late archive chunk; re-entry cannot reuse the prior fence", async () => {
    const setup = await fixture(); setup.mutate(); await setup.replicate();
    const chunk = await setup.archive.readSealedChunk(0, new AbortController().signal);
    const deadlines: { milliseconds: number; controller: AbortController }[] = [];
    // Drive exactly the real timeout signal path without wall-clock sleeps.
    vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => { const controller = new AbortController(); deadlines.push({ milliseconds, controller }); return controller.signal; });
    const ready = deferred<AbortSignal>(), late = deferred<unknown>();
    const archive = { ...setup.archive, readSealedChunk: async (_index: number, signal: AbortSignal) => { ready.resolve(signal); return late.promise; } };
    const pending = prepareAuthorityQuarantine({ ...setup.input, archive });
    const readerSignal = await ready.promise;
    expect(deadlines.map(item => item.milliseconds)).toEqual([20_000, 4_000, 4_000]);
    deadlines.at(-1)!.controller.abort(new DOMException("Synthetic deadline", "TimeoutError"));
    await expect(pending).rejects.toThrow("RESTORE_ARCHIVE_UNAVAILABLE");
    expect(readerSignal.aborted).toBe(true);
    const before = data(setup.target), state = setup.target.backup.authorityPreparationState();
    expect(state).toMatchObject({ snapshotNext: 0, cursor: { sequence: 0 }, prepared: false }); expect(state.fence).not.toBeNull();
    late.resolve(chunk); await Promise.resolve(); await Promise.resolve();
    expect(data(setup.target)).toBe(before); expect(setup.target.backup.authorityPreparationState().snapshotNext).toBe(0);
    const offline = { ...setup.reader, fence: vi.fn(async () => { throw Error("Fresh independent authority unavailable"); }) };
    await expect(prepareAuthorityQuarantine({ ...setup.input, authority: offline })).rejects.toThrow("RESTORE_AUTHORITY_UNAVAILABLE");
    expect(offline.fence).toHaveBeenCalledOnce(); expect(data(setup.target)).toBe(before);
    expect(setup.target.backup.authorityPreparationState().snapshotNext).toBe(0);
    expect(() => setup.target.backup.assertAvailable()).toThrow("RECOVERY_MAINTENANCE");
    expect((await finish(setup.input)).prepared).toBe(true);
  });
});
