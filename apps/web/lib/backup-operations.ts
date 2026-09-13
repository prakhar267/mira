import { BackupEngine } from "./backup-engine";
import { backupDigest, openBackup, sealBackup, type BackupKey } from "./backup-crypto";

export interface BackupEnvironment { MIRA_BACKUP_KEY?: string; MIRA_BACKUP_KEY_ID?: string }
export async function runBackupOperation(engine: BackupEngine, transaction: <T>(work: () => T) => T, environment: BackupEnvironment, input: Record<string, unknown>) {
  const config: BackupKey = { keyId: environment.MIRA_BACKUP_KEY_ID ?? "", material: environment.MIRA_BACKUP_KEY ?? "" };
  // Validate configured key and crypto support before any maintenance/retirement
  // mutation. No development/default key and no client-supplied key are accepted.
  await sealBackup({ configurationCheck: true }, "cutover", config);
  const field = (key: string) => { const value = input[key]; if (typeof value !== "string" || value.length > 120) throw new Error("BACKUP_INVALID_REQUEST"); return value; };
  switch (input.operation) {
    case "status": return transaction(() => engine.status());
    case "begin": return transaction(() => engine.begin("snapshot"));
    case "ledger": return transaction(() => engine.begin("ledger"));
    case "page": {
      const archiveId = field("archiveId"), nonce = field("nonce"), chunk = transaction(() => engine.page(archiveId, nonce));
      if (!chunk) return { done: true };
      const sealed = await sealBackup(chunk, "chunk", config), digest = await backupDigest(chunk);
      transaction(() => engine.acknowledge(archiveId, nonce, chunk, digest, new TextEncoder().encode(JSON.stringify(chunk)).length));
      return { done: false, sealed };
    }
    case "finish": {
      const archiveId = field("archiveId"), nonce = field("nonce"), manifest = transaction(() => engine.manifest(archiveId, nonce)), sealed = await sealBackup(manifest, "manifest", config);
      transaction(() => engine.finish(archiveId, nonce)); return { sealed };
    }
    case "cancel": return transaction(() => engine.cancel(field("archiveId"), field("nonce")));
    case "retire": {
      const proof = transaction(() => engine.retire({ target: field("destination"), challenge: field("challenge"), backupId: field("backupId"), source: field("source"), confirm: field("confirm") }));
      return { sealed: await sealBackup(proof, "cutover", config) };
    }
    case "restoreBegin": { const manifest = await openBackup(input.sealed, "manifest", config); return transaction(() => engine.beginRestore(manifest, field("target"))); }
    case "restoreLedger": { const manifest = await openBackup(input.sealed, "manifest", config); return transaction(() => engine.setLedger(manifest)); }
    case "restoreChunk": { const chunk = await openBackup(input.sealed, "chunk", config), digest = await backupDigest(chunk); return transaction(() => engine.importChunk(chunk, digest)); }
    case "restoreFinalize": { const proof = await openBackup(input.sealed, "cutover", config); return transaction(() => engine.finalize(proof)); }
    default: throw new Error("BACKUP_INVALID_REQUEST");
  }
}
