# Authority-backed restore preparation — permanent quarantine

Updated 14 September 2026. This is a dormant, internal preparation slice, not an operational disaster-recovery feature. No production data, source retirement, new route, authority endpoint, infrastructure, credential, payment or routing change is included.

## What this slice establishes

`prepareAuthorityQuarantine` in `apps/web/lib/authority-quarantine.ts` can decrypt a retained account archive, fetch a write-fenced journal from a separately surviving authority, replay newer suppression, and validate account ownership/authentication after the original SQLite source has been destroyed. It requires no call to that source. The result always has:

```ts
{ mode: "restore", prepared: boolean, coverageVerified: false, servingAllowed: false }
```

Even `prepared: true` means only that the provided snapshot and fetched journal were consumed and account validation finished. The target remains unavailable indefinitely. There is no activation method or serving permit. `BackupEngine.assertAvailable()` continues to reject it. Legacy `restoreFinalize`, including a correctly encrypted cutover proof, and `setLedger` unconditionally reject this preparation mode.

The existing controlled-transfer restore remains separate. Its final validation code is now a shared helper that never changes availability; only the existing legacy finalizer can perform its existing active-mode transition. Authority preparation does not call that finalizer.

## Internal boundaries

- The trusted caller supplies a `BackupEngine`, a synchronous SQL transaction wrapper, the configured archive decryption key, a target ID, and an **expected writer** (authority ID, source generation, writer ID and epoch). Archive fields do not choose an authority or credentials.
- `AuthorityPreparationArchive` supplies the encrypted manifest and a cancellable bounded chunk reader. AES-256-GCM verification, strict manifest/table schemas, chunk identity/digest checks and existing account-data limits remain in effect.
- `AuthorityQuarantineReader` supplies authenticated `fence(writer, target, challenge, signal)` and `read(writer, checkpoint, limit, signal)` operations. This change defines only an injected interface: it does not implement authenticated network serving, deployment, storage placement, an operator route or automatic enrollment.
- `fence` uses the existing authority's permanent write revocation and exact target/challenge retry semantics. It is **not a serving lease, response drain, recovery admission or new-writer handoff**. A returned object is trusted only insofar as the future configured caller authenticates the independent authority; matching IDs alone are not authentication.

### Durable binding and bounded progress

The empty target atomically pins a fresh challenge to the exact target, source/writer/epoch, archive ID and digest of the validated decrypted manifest. Every snapshot table must be empty, including conversation and privacy/memory suppression tables; a nonempty target is rejected without clearing its data or changing its existing target identity. Snapshot substitution or writer/target changes are refused on resume, including after target SQL restart.

The authority then permanently binds its final head to that target/challenge. This transitively associates the head with the target-pinned archive and writer. The same fresh authority operation is required on **every invocation**, even after preparation completes. An archive-contained or cached fence, local timestamp, signed historical ledger, or unavailable authority never substitutes for that call.

Each invocation performs at most eight snapshot chunks, journal pages or validation batches, with a 20-second overall deadline and a four-second bound per asynchronous reader operation. Journal pages contain at most 128 strict content-minimized events; the final head is capped at one million events. The original archive limits remain 1.8 MB plaintext per chunk, 20,000 chunks, one million rows and 4 GB cumulative plaintext. Network adapters must also bound bytes while reading responses; no such adapter is added here.

The verifier reconstructs every journal digest from the expected writer's genesis checkpoint through the pinned head. It rejects missing, reordered, malformed or oversized events, mismatched page/head digests and inconsistent `hasMore`. It runs cryptography outside SQL transactions. Verified page replay, immutable range/digest retry receipts and progress are committed in one synchronous transaction. A failed SQL page rolls back its suppression effects and its cursor together. Exact retries do not reapply suppression or rerandomize credentials. Target restart resumes from durable state.

All journal entries are retained in the target, but events at or below the snapshot watermark are not applied twice. Newer account/conversation deletion, memory correction/forgetting and privacy withdrawal use the existing suppression replay. Correction conservatively removes the old memory; replacement plaintext is not stored in the authority. Later opt-in does not restore previously deleted history. Validation runs in batches of ten accounts, excludes old tokens/sessions, randomizes password verifiers, clears address verification and requires password reset/reverification.

## Deliberately unverified and still required

- Version-one archives do not prove that **all** historically acknowledged deletion was covered by independent protection. A matching source ID, contiguous journal and valid encryption are insufficient to establish that coverage. `coverageVerified` therefore remains false permanently in this mode.
- This code assumes the injected reader represents a trustworthy, independently retained latest authority. It does not establish independent failure domains, detect a compromised/rolled-back authority, provision offsite storage, or recover lost decryption keys.
- Protection bootstrap/archive provenance, source serving/response-drain fencing, recovery admission, target writer enrollment/handoff, future target-side protected acknowledgements, restoration-email delivery and routing cutover remain separate engineering and activation work. A write fence alone does not show that an old source has stopped all in-flight responses.
- Production activation requires approved independent placement, authentication and key custody, availability/retention decisions and an authenticated bounded reader implementation. None is configured or activated here. No production RPO/RTO or complete source-loss recovery claim follows from the local test timing.
- A permanently fenced authority is not reset if preparation fails. An eventual operator integration must require explicit destructive-fencing authorization and a verified retained archive before calling this internal operation. No generic backup command invokes it.

## Reproducible local evidence

The new `lib/authority-quarantine.test.ts` uses real, separate `node:sqlite` files and the existing encrypted filesystem-vault adapter. Every account, transcript, key and authority is synthetic. It closes and physically removes the source database **before retirement or authority fencing**, then prepares a different SQLite target from the encrypted vault and retained authority. It verifies suppressed account/history/memory stay absent, unaffected transcripts survive, credentials are invalidated and quarantine remains enforced. Temporary synthetic files are removed after each test; no key or user-data artifact is committed.

Nine cases cover archive substitution after initial fencing and target restart; stale/wrong/offline authority; strict page validation and transaction rollback; 268-event paged replay with durable retry/restart; competing targets and revoked writers; unconditional legacy-finalize refusal; targets containing only pre-existing privacy, memory or conversation suppression; and deterministic cancellation/deadline checks where late authority/archive responses cannot mutate target state. Every case forbids global `fetch` and asserts no external network request occurred.

Run from `apps/web` with pinned Node 24.18.0 and the repository's locked dependencies:

```sh
node node_modules/vitest/vitest.mjs run lib/authority-quarantine.test.ts lib/backup-recovery.test.ts lib/suppression-authority.test.ts lib/suppression-replication.test.ts --disableConsoleIntercept
node node_modules/eslint/bin/eslint.js lib/authority-quarantine.ts lib/authority-quarantine-protocol.ts lib/authority-quarantine.test.ts lib/backup-engine.ts --max-warnings=0
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/vitest/vitest.mjs run --config vitest.config.ts
node node_modules/vitest/vitest.mjs run --config vitest.worker.config.mjs
```

The source-destruction case prints only timing/count/boolean metadata. That timing measures small local preparation, not archive capture, offsite transfer, authority deployment, email delivery or serving readiness. No production authority or inference request is made by these tests.

Observed 14 September 2026 with Node 24.18.0: the four listed suites passed **49/49 tests** (including all nine new preparation cases) in 2.06 seconds; scoped lint with zero warnings and the full web TypeScript check both passed. The eight-event, three-account source-destruction fixture's preparation took **43.03 ms** in that run. These are local synthetic observations, not availability or production recovery objectives.

The subsequent full checks also passed: **345/345 web unit tests across 43 files** in 4.15 seconds and **32/32 actual Worker integration tests across six files** in 14.94 seconds. Worker integration used the isolated `wrangler.test.jsonc` configuration with remote bindings disabled and synthetic AI/provider service bindings; no production provider or remote store was exercised. These broader checks cover the existing `BackupEngine` paths after extracting validation from finalization, not just the new preparation mode.
