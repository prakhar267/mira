import { BackupEngine, archiveManifestSchema } from "./backup-engine";
import { backupDigest, openBackup, type BackupKey } from "./backup-crypto";
import { advanceCheckpoint, checkpointSchema, genesisCheckpoint, writerSchema, type Checkpoint, type Writer } from "./suppression-protocol";
import {
  authorityReadPageSchema, authorityRestoreBindingSchema, authorityWriteFenceSchema,
  AUTHORITY_PREPARATION_STEPS, type AuthorityQuarantineReader,
  type AuthorityRestoreBinding, type AuthorityVerifiedPage, type AuthorityWriteFence,
} from "./authority-quarantine-protocol";

type Transaction = <T>(work: () => T) => T;
export interface AuthorityPreparationArchive {
  sealedManifest: unknown;
  readSealedChunk(index: number, signal: AbortSignal): Promise<unknown>;
}
export interface AuthorityPreparationInput {
  engine: BackupEngine;
  transaction: Transaction;
  archive: AuthorityPreparationArchive;
  key: BackupKey;
  target: string;
  expectedWriter: Writer;
  authority: AuthorityQuarantineReader;
  signal?: AbortSignal;
}

/** Bound even an injected reader which ignores cancellation. A late result is
 * never used for target mutation. A remotely completed but lost fence response
 * is retried with the same immutable target/challenge, not rolled back. */
async function bounded<T>(parent: AbortSignal, work: (signal: AbortSignal) => Promise<T>, code: string): Promise<T> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(4_000)]);
  signal.throwIfAborted();
  let stop: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    stop = () => reject(new Error(code));
    signal.addEventListener("abort", stop, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return work(signal); }), aborted]); }
  catch { throw new Error(code); }
  finally { signal.removeEventListener("abort", stop); }
}

/** Hash verification is deliberately outside any SQL transaction. The write
 * fence's target/challenge refers to a target-pinned writer/archive digest; no
 * field read from an encrypted archive selects the trusted authority endpoint. */
export async function verifyAuthorityQuarantinePage(rawBinding: AuthorityRestoreBinding, rawFence: AuthorityWriteFence, rawBefore: Checkpoint, raw: unknown): Promise<AuthorityVerifiedPage> {
  const binding = authorityRestoreBindingSchema.parse(rawBinding), fence = authorityWriteFenceSchema.parse(rawFence), before = checkpointSchema.parse(rawBefore);
  const writer = writerSchema.parse({ authorityId: binding.authorityId, source: binding.source, writerId: binding.writerId, epoch: binding.epoch });
  if (fence.target !== binding.target || fence.challenge !== binding.challenge || fence.authorityId !== writer.authorityId || fence.source !== writer.source || fence.writerId !== writer.writerId || fence.epoch !== writer.epoch) throw new Error("RESTORE_AUTHORITY_BINDING_CHANGED");
  const page = authorityReadPageSchema.parse(raw);
  const head = { authorityId: fence.authorityId, source: fence.source, writerId: fence.writerId, epoch: fence.epoch, sequence: fence.sequence, digest: fence.digest };
  if (JSON.stringify(page.head) !== JSON.stringify(head) || before.sequence >= fence.sequence || !page.entries.length) throw new Error("RESTORE_AUTHORITY_PAGE_INVALID");
  const after = await advanceCheckpoint(writer, before, page.entries);
  if (after.sequence > fence.sequence || after.sequence !== page.checkpoint.sequence || after.digest !== page.checkpoint.digest || page.hasMore !== (after.sequence < fence.sequence)) throw new Error("RESTORE_AUTHORITY_PAGE_INVALID");
  if (after.sequence === fence.sequence && after.digest !== fence.digest) throw new Error("RESTORE_AUTHORITY_HEAD_MISMATCH");
  const verified = { binding, before, entries: page.entries, after };
  return { ...verified, digest: await backupDigest(verified) };
}

/** Source-independent, permanently quarantined preparation. Internal only: no
 * route, CLI, network authority, source retirement, protected-writer activation,
 * restoration admission or routing release is implemented by this function.
 * Each invocation handles at most eight chunks/pages/validation batches.
 * Historical v1 archive coverage remains unverified even after preparation. */
export async function prepareAuthorityQuarantine(input: AuthorityPreparationInput) {
  const { engine, transaction, archive, key, target, authority } = input;
  const signal = AbortSignal.any([AbortSignal.timeout(20_000), ...(input.signal ? [input.signal] : [])]);
  signal.throwIfAborted();
  const writer = writerSchema.parse(input.expectedWriter);
  if (!authority || authority.authorityId !== writer.authorityId) throw new Error("RESTORE_AUTHORITY_UNAVAILABLE");
  const manifest = archiveManifestSchema.parse(await openBackup(archive.sealedManifest, "manifest", key));
  const manifestDigest = await backupDigest(manifest), genesis = await genesisCheckpoint(writer);
  signal.throwIfAborted();
  let progress = transaction(() => engine.beginAuthorityQuarantine(manifest, target, writer, manifestDigest, genesis));
  // Always consult the authority again on resume; a cached/archive-contained
  // fence is never a substitute for an independently current authority.
  const fence = await bounded(signal, stop => authority.fence(writer, target, progress.binding.challenge, stop), "RESTORE_AUTHORITY_UNAVAILABLE");
  signal.throwIfAborted();
  progress = transaction(() => engine.pinAuthorityWriteFence(fence));
  for (let step = 0; step < AUTHORITY_PREPARATION_STEPS; step++) {
    signal.throwIfAborted();
    progress = transaction(() => engine.authorityPreparationState());
    if (progress.prepared) break;
    if (progress.snapshotNext < progress.snapshotChunks) {
      const sealed = await bounded(signal, stop => archive.readSealedChunk(progress.snapshotNext, stop), "RESTORE_ARCHIVE_UNAVAILABLE");
      const chunk = await openBackup(sealed, "chunk", key), digest = await backupDigest(chunk);
      signal.throwIfAborted();
      transaction(() => engine.importChunk(chunk, digest));
    } else if (progress.fence && progress.cursor.sequence < progress.fence.sequence) {
      const raw = await bounded(signal, stop => authority.read(writer, progress.cursor, 128, stop), "RESTORE_AUTHORITY_UNAVAILABLE");
      const page = await verifyAuthorityQuarantinePage(progress.binding, progress.fence, progress.cursor, raw);
      signal.throwIfAborted();
      transaction(() => engine.importAuthorityPage(page));
    } else {
      transaction(() => engine.validateAuthorityPreparation());
    }
  }
  return { ...transaction(() => engine.authorityPreparationState()), mode: "restore" as const, coverageVerified: false as const, servingAllowed: false as const };
}
