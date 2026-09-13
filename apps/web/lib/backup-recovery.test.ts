import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { StoreEngine, type SqlStorage } from "./store-engine";
import { BackupEngine } from "./backup-engine";
import { runBackupOperation } from "./backup-operations";
import { backupDigest, openBackup, sealBackup, type BackupKey } from "./backup-crypto";
import { freshDemo } from "./demo-storage";
// The production operator's actual filesystem adapter, not a same-object SQL snapshot.
// @ts-expect-error The independently executable Node CLI intentionally uses .mjs.
import { captureArchive, restoreArchive, verifyArchive } from "../scripts/backup-vault.mjs";

let directory: string, key: BackupKey;
const handles: DatabaseSync[] = [];
function database(path: string) {
  const db = new DatabaseSync(path); handles.push(db);
  const sql: SqlStorage = { exec(query, ...values) { const result = db.prepare(query).all(...values) as Record<string, unknown>[]; return { toArray: () => result }; } };
  const store = new StoreEngine(sql), backup = new BackupEngine(sql, store);
  const transaction = <T>(work: () => T): T => { db.exec("BEGIN IMMEDIATE"); try { const result = work(); db.exec("COMMIT"); return result; } catch (cause) { db.exec("ROLLBACK"); throw cause; } };
  const call = (input: Record<string, unknown>) => runBackupOperation(backup, transaction, { MIRA_BACKUP_KEY: key.material, MIRA_BACKUP_KEY_ID: key.keyId }, input);
  return { db, sql, store, backup, transaction, call };
}
async function account(source: ReturnType<typeof database>, name: string, messages = 0) {
  const id = crypto.randomUUID(), emailKey = (await backupDigest(`${name}@example.test`)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), now = new Date().toISOString();
  const state = freshDemo(); state.user.id = id; state.user.name = name; state.user.adultConfirmed = true;
  state.memoryEnabled = true; state.aiProcessingConsent = true; state.conversationStorageEnabled = true;
  state.messages = Array.from({ length: messages }, (_, index) => ({ id: `${name}-${index}`, conversationId: state.activeConversationId, role: "user" as const, content: `Synthetic private transcript ${name} ${index}`, createdAt: new Date(Date.now() - 10_000 + index).toISOString() }));
  source.transaction(() => source.store.bootstrap(`email:${emailKey}`, { id, email: `${name}@example.test`, emailKey, name, passwordHash: "a".repeat(43), passwordSalt: "b".repeat(22), createdAt: now, updatedAt: now } as { id: string }, state, `session:${name}`, JSON.stringify({ userId: id, createdAt: now }), 86400));
  return { id, emailKey };
}
async function importArchive(target: ReturnType<typeof database>, archive: { directory: string; manifest: { chunks: unknown[] } }) {
  for (let index = 0; index < archive.manifest.chunks.length; index++) await target.call({ operation: "restoreChunk", sealed: JSON.parse(await readFile(join(archive.directory, `${String(index).padStart(6, "0")}.sealed.json`), "utf8")) });
}
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "mira-encrypted-recovery-test-")); key = { keyId: "synthetic-key-v1", material: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64") }; });
afterEach(() => { for (const db of handles.splice(0)) { try { db.close(); } catch { /* A source intentionally wiped by the drill is already closed. */ } } vi.useRealTimers(); });

describe("independent encrypted archive and deletion-safe recovery", () => {
  it("writes ciphertext to distinct vaults, wipes source, restores transcripts and replays newer suppression before serving", async () => {
    const sourcePath = join(directory, "source.sqlite"), source = database(sourcePath), keep = await account(source, "kept", 1200), removed = await account(source, "deleted", 1200);
    const unchanged = await account(source, "unchanged", 600);
    const created = source.transaction(() => source.store.memoryCommand(keep.id, { action: "create", content: "Synthetic secret to forget after backup" }, 1));
    if (!("state" in created)) throw Error("fixture failed");
    const memoryId = created.state.memories[0]!.id;
    const snapshot = await captureArchive(source.call, join(directory, "account-vault"), key);
    source.transaction(() => source.store.memoryCommand(keep.id, { action: "forget", id: memoryId }, 2));
    source.transaction(() => source.store.acceptPolicy(keep.id, { aiProcessingConsent: false, memoryEnabled: false, conversationStorageEnabled: false }, 3));
    // Re-enabling history must not resurrect the history explicitly erased in between.
    source.transaction(() => source.store.acceptPolicy(keep.id, { aiProcessingConsent: false, memoryEnabled: false, conversationStorageEnabled: true }, 4));
    source.transaction(() => source.store.eraseAccount(removed.id, removed.emailKey, []));
    const target = database(join(directory, "restored.sqlite")), targetName = "mira-recovery-synthetic-target";
    const start = await target.call({ operation: "restoreBegin", target: targetName, sealed: snapshot.sealed }) as { challenge: string };
    const proof = await source.call({ operation: "retire", destination: targetName, challenge: start.challenge, backupId: snapshot.manifest.archiveId, source: snapshot.manifest.source, confirm: "RETIRE mira-production-v1" }) as { sealed: unknown };
    const ledger = await captureArchive(source.call, join(directory, "suppression-vault"), key, "ledger");
    for (const vault of [snapshot.directory, ledger.directory]) for (const filename of await readdir(vault)) expect(await readFile(join(vault, filename), "utf8")).not.toContain("Synthetic private");
    expect(() => source.backup.assertAvailable()).toThrow("RECOVERY_MAINTENANCE");
    // The archived ciphertext and current cutover proof now survive a real source-file loss.
    source.db.close(); await unlink(sourcePath);
    const started = performance.now();
    await target.call({ operation: "restoreLedger", sealed: ledger.sealed });
    await importArchive(target, snapshot); await importArchive(target, ledger);
    expect(() => target.backup.assertAvailable()).toThrow("RECOVERY_MAINTENANCE");
    const complete = await target.call({ operation: "restoreFinalize", sealed: proof.sealed });
    const elapsedMs = Math.round((performance.now() - started) * 100) / 100;
    expect(complete).toMatchObject({ complete: true, passwordsResetRequired: true, emailReverificationRequired: true });
    expect(() => target.backup.assertAvailable()).not.toThrow();
    const restored = target.transaction(() => target.store.exportAccountState(keep.id));
    expect(restored?.state.messages).toEqual([]); expect(restored?.state.aiProcessingConsent).toBe(false); expect(restored?.state.conversationStorageEnabled).toBe(true);
    expect(target.transaction(() => target.store.exportAccountState(unchanged.id))?.state.messages).toHaveLength(600);
    expect(target.store.get(`account:${removed.id}`)).toBeNull(); expect(target.store.get("session:kept")).toBeNull(); expect(target.backup.legacyAllowed()).toBe(false);
    expect(JSON.stringify(target.sql.exec("SELECT * FROM records").toArray())).not.toContain("Synthetic secret to forget after backup");
    const credentials = JSON.parse(target.store.get(`account:${keep.id}`)!); expect(credentials.passwordHash).not.toBe("a".repeat(43)); expect(credentials).toMatchObject({ passwordResetRequired: true, recoveryVerificationRequired: true });
    expect(() => target.transaction(() => target.store.acceptPolicy(keep.id, { aiProcessingConsent: true, memoryEnabled: true, conversationStorageEnabled: true }, restored!.revision))).toThrow("ACCOUNT_VERIFICATION_REQUIRED");
    const evidence = { evidence: "independent-encrypted-vault-source-wipe-restore", accounts: 3, originalTranscriptRows: 3000, preservedTranscriptRows: 600, snapshotPlaintextBytesBeforeEncryption: snapshot.manifest.totalBytes, replayedLedgerEvents: ledger.manifest.totalRows, restoreElapsedMs: elapsedMs, offsiteConfigured: false, sourceLossBeforeFreshCutoverProofSupported: false };
    await writeFile(join(directory, "recovery-evidence.json"), JSON.stringify(evidence), { mode: 0o600 });
    console.log(JSON.stringify({ ...evidence, evidenceDirectory: directory }));
  });
  it("requires a current source-retirement watermark, not merely an old correctly encrypted ledger", async () => {
    const source = database(join(directory, "source.sqlite")), user = await account(source, "stale"), snapshot = await captureArchive(source.call, join(directory, "data-vault"), key);
    const stale = await captureArchive(source.call, join(directory, "ledger-vault"), key, "ledger");
    source.transaction(() => source.store.eraseAccount(user.id, user.emailKey, []));
    const target = database(join(directory, "target.sqlite")), targetName = "mira-recovery-stale-ledger";
    const start = await target.call({ operation: "restoreBegin", target: targetName, sealed: snapshot.sealed }) as { challenge: string };
    const proof = await source.call({ operation: "retire", destination: targetName, challenge: start.challenge, backupId: snapshot.manifest.archiveId, source: snapshot.manifest.source, confirm: "RETIRE mira-production-v1" }) as { sealed: unknown };
    await target.call({ operation: "restoreLedger", sealed: stale.sealed }); await importArchive(target, snapshot); await importArchive(target, stale);
    await expect(target.call({ operation: "restoreFinalize", sealed: proof.sealed })).rejects.toThrow("RESTORE_CURRENT_CUTOVER_PROOF_REQUIRED");
    expect(() => target.backup.assertAvailable()).toThrow("RECOVERY_MAINTENANCE");
  });
  it("refuses admission when the source disappears before retirement, despite intact independently archived ciphertext", async () => {
    const sourcePath = join(directory, "lost-before-retirement.sqlite"), source = database(sourcePath);
    const user = await account(source, "source-loss", 3);
    const snapshot = await captureArchive(source.call, join(directory, "account-vault"), key);
    const staleLedger = await captureArchive(source.call, join(directory, "suppression-vault"), key, "ledger");
    // A real acknowledged local transaction, not a tampered archive. Nothing in
    // the surviving archive changes when this newer deletion commits locally.
    source.transaction(() => source.store.eraseAccount(user.id, user.emailKey, []));
    expect(source.store.get(`account:${user.id}`)).toBeNull();
    const acknowledgedWatermark = source.backup.status().watermark;
    expect(acknowledgedWatermark).toBeGreaterThan(staleLedger.manifest.watermark);
    source.db.close(); await unlink(sourcePath);
    await expect(readFile(sourcePath)).rejects.toMatchObject({ code: "ENOENT" });

    // Both archives are still authentic and complete, including the atomic local
    // latest pointer. That establishes integrity, not a current deletion head.
    expect((await verifyArchive(snapshot.directory, key)).manifest.archiveId).toBe(snapshot.manifest.archiveId);
    expect((await verifyArchive(staleLedger.directory, key)).manifest.watermark).toBe(staleLedger.manifest.watermark);
    const head = JSON.parse(await readFile(join(directory, "suppression-vault", "latest.json"), "utf8"));
    expect(head.watermark).toBe(staleLedger.manifest.watermark);

    const target = database(join(directory, "quarantined.sqlite")), targetName = "mira-recovery-source-loss";
    const unavailableSource = vi.fn(async () => { throw new Error("SYNTHETIC_SOURCE_LOST"); });
    const targetCall = vi.fn(target.call);
    await expect(restoreArchive(unavailableSource, targetCall, snapshot.directory, join(directory, "suppression-vault"), key, targetName, "RETIRE mira-production-v1")).rejects.toThrow("SYNTHETIC_SOURCE_LOST");
    expect(unavailableSource).toHaveBeenCalledTimes(1);
    expect(targetCall.mock.calls.map(([input]) => input.operation)).toEqual(["status", "restoreBegin"]);
    expect(target.backup.status()).toMatchObject({ mode: "restore", next: 0, ledgerNext: 0, legacyImportAllowed: false });
    expect(() => target.backup.assertAvailable()).toThrow("RECOVERY_MAINTENANCE");

    // Even manually importing the authentic old material cannot substitute a
    // ledger for target-bound cutover proof or open the quarantined target.
    await target.call({ operation: "restoreLedger", sealed: staleLedger.sealed });
    await importArchive(target, snapshot); await importArchive(target, staleLedger);
    await expect(target.call({ operation: "restoreFinalize", sealed: staleLedger.sealed })).rejects.toThrow("BACKUP_INVALID");
    expect(() => target.backup.assertAvailable()).toThrow("RECOVERY_MAINTENANCE");
    await writeFile(join(directory, "source-loss-admission-evidence.json"), JSON.stringify({
      evidence: "source-lost-before-retirement-admission-denied", sourceFileRemoved: true,
      snapshotAndLedgerIntegrityVerified: true, archivedWatermark: staleLedger.manifest.watermark,
      acknowledgedWatermarkBeforeSourceLoss: acknowledgedWatermark, targetMode: target.backup.status().mode,
      independentLatestAuthorityConfigured: false, sourceLossRecoveryImplemented: false,
    }), { mode: 0o600 });
  });
  it("runs the actual vault restore orchestrator and removes corrected memory/deleted conversation while retaining another conversation", async () => {
    const source = database(join(directory, "source.sqlite")), user = await account(source, "correction", 3);
    const initial = source.transaction(() => source.store.readAccountState(user.id))!;
    const opened = source.transaction(() => source.store.conversationCommand(user.id, { action: "create" }, 1));
    if (!("state" in opened)) throw Error("fixture failed");
    opened.state.messages.push({ id: "other-conversation-message", conversationId: opened.state.activeConversationId, role: "user", content: "Synthetic preserved other conversation", createdAt: new Date().toISOString() });
    source.transaction(() => source.store.saveAccountState(user.id, opened.state, 2));
    const added = source.transaction(() => source.store.memoryCommand(user.id, { action: "create", content: "Synthetic old preference to remove" }, 3));
    if (!("state" in added)) throw Error("fixture failed");
    const snapshot = await captureArchive(source.call, join(directory, "data-vault"), key);
    source.transaction(() => source.store.memoryCommand(user.id, { action: "edit", id: added.state.memories[0]!.id, content: "Synthetic corrected preference never stored in ledger" }, 4));
    source.transaction(() => source.store.conversationCommand(user.id, { action: "delete", id: initial.state.activeConversationId }, 5));
    const target = database(join(directory, "target.sqlite"));
    const result = await restoreArchive(source.call, target.call, snapshot.directory, join(directory, "ledger-vault"), key, "mira-recovery-vault-cli", "RETIRE mira-production-v1");
    expect(result.complete).toBe(true);
    const restored = target.transaction(() => target.store.exportAccountState(user.id))!;
    expect(restored.state.messages.map(message => message.id)).toEqual(["other-conversation-message"]);
    expect(restored.state.memories).toEqual([]);
    const ledgerText = JSON.stringify(source.sql.exec("SELECT * FROM recovery_events").toArray());
    expect(ledgerText).not.toContain("Synthetic old preference"); expect(ledgerText).not.toContain("Synthetic corrected preference");
  });
  it("rejects missing keys, authentication tampering, wrong purpose, unknown tables and nonempty restore targets", async () => {
    const source = database(join(directory, "source.sqlite")); await account(source, "valid");
    await expect(runBackupOperation(source.backup, source.transaction, {}, { operation: "begin" })).rejects.toThrow("BACKUP_KEY_REQUIRED");
    expect(source.backup.status().mode).toBe("active");
    const sealed = await sealBackup({ synthetic: true }, "chunk", key);
    await expect(openBackup({ ...sealed, ciphertext: `${sealed.ciphertext[0] === "A" ? "B" : "A"}${sealed.ciphertext.slice(1)}` }, "chunk", key)).rejects.toThrow();
    await expect(openBackup(sealed, "manifest", key)).rejects.toThrow("BACKUP_INVALID");
    const snapshot = await captureArchive(source.call, join(directory, "vault"), key);
    await expect(source.call({ operation: "restoreBegin", target: "mira-recovery-not-empty", sealed: snapshot.sealed })).rejects.toThrow("RESTORE_TARGET_NOT_EMPTY");
    const invalid = structuredClone(snapshot.manifest); invalid.chunks[0].table = "sqlite_master";
    await expect(database(join(directory, "target.sqlite")).call({ operation: "restoreBegin", target: "mira-recovery-unknown-table", sealed: await sealBackup(invalid, "manifest", key) })).rejects.toThrow();
    const verified = await verifyArchive(snapshot.directory, key); expect(verified.manifest.archiveId).toBe(snapshot.manifest.archiveId);
  });
  it("expires an abandoned ordinary export without ever auto-opening a restore or retired source", async () => {
    vi.useFakeTimers(); const source = database(join(directory, "source.sqlite")); await account(source, "lease");
    const job = await source.call({ operation: "begin" }) as { archiveId: string; nonce: string };
    expect(() => source.backup.assertAvailable()).toThrow("RECOVERY_MAINTENANCE"); vi.advanceTimersByTime(16 * 60_000);
    expect(() => source.backup.assertAvailable()).not.toThrow(); await expect(source.call({ operation: "page", ...job })).rejects.toThrow("BACKUP_LEASE_EXPIRED");
    const snapshot = await captureArchive(source.call, join(directory, "vault"), key), target = database(join(directory, "target.sqlite"));
    await target.call({ operation: "restoreBegin", target: "mira-recovery-held-quarantine", sealed: snapshot.sealed }); vi.advanceTimersByTime(7 * 86400_000);
    expect(() => target.backup.assertAvailable()).toThrow("RECOVERY_MAINTENANCE");
  });
});
