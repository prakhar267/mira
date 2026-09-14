# Independent suppression acknowledgement — 14 September 2026

This is a tested **partial implementation**, not activated disaster recovery. Payments remain disabled. No authority service, archive vault, credential, email sender or alert recipient was provisioned, and no consumer data was copied.

## Implemented

- `suppression-authority.ts`: a separate SQL-backed authority core with durable identity, permanent source/writer binding, epoch-1 enrollment, bounded ordered append/read, immutable content-checked retries and atomic permanent write fencing. Hashing runs outside synchronous SQL transactions; commit rechecks the current writer and head. There is no reset, takeover, pruning or reactivation method. Callers must authenticate and authorize access; this core is not a deployed HTTP service.
- `suppression-protocol.ts`: strict versioned hash domains and fixed-order event encoding. Source/authority/writer/epoch, predecessor digest and sequence bind every event. Payloads are limited to IDs, sequence/revision and consent flags; extra content/credential fields are rejected. Hashes detect inconsistency, **not freshness, authenticity or independent durability** by themselves.
- `suppression-replication.ts`: permanent source-side protection state and acknowledged checkpoint. Enrollment always starts at genesis, never at a caller-supplied high-water mark. A locally committed operation can receive success only after all relevant journal entries have independent acknowledgement. Lost receipts retry exact entries; missing credentials never downgrade protected mode. Eight 128-entry batches bound each catch-up attempt; remaining backlog returns unavailable while preserving progress. Concurrent flushes are serialized without holding SQL transactions across network calls.
- `worker.ts`: pre/post response barriers around the real store action path, plus scheduled-work barriers. Protected generations cannot import stale legacy KV, use generic raw account/state/policy writes, or use the old source-retirement backup admission path. This explicitly avoids letting the legacy archive format bypass authority requirements. No public or operator activation route exists.
- `suppression-transport.ts`: dormant HTTPS adapter with a pinned server-side endpoint/identity/token, redirect rejection, a four-second request timeout, bounded receipt body and no logged provider content. Configuring it does not enroll a production source or create independent infrastructure.
- Legacy read migrations now journal each newly discovered deleted-memory ID once, without retaining its content. Account deletion, conversation deletion, memory edits/forgetting, privacy withdrawal and subsequent opt-in use the same minimal journal schema as encrypted archive validation.

## Acknowledgement semantics

The local restrictive change and journal event commit together. Independent acknowledgement happens **after that commit but before a successful app response**. If the remote append fails, local deletion stays applied, the checkpoint remains pending, and the caller receives unavailable. The next request retries pending entries before doing new work. A failure before the request starts does not falsely claim that a new deletion has been accepted.

A lost response is an unknown outcome, not a rollback. Source loss may lose unacknowledged local operations. The promised future recovery invariant is zero loss of **successfully acknowledged** suppressions, not zero loss of every submitted operation. Re-enabling history cannot undo the earlier history-withdrawal event. The user-facing pending-deletion/status experience still needs design before activation; current protected-mode failures use existing 503 handling.

## Executed verification

The focused authority/replication tests use real Node SQLite transactions, not arrays standing in for storage. They cover immutable retries, reordered/conflicting entries, partial-prefix retries, fencing during hashing, corrupt heads, restart identity, missing configuration, invalid receipts, bounded backlog and source rollback/gaps.

The source-loss fixture performs real StoreEngine memory correction, forgetting, conversation deletion, privacy withdrawal/re-enabling and account deletion; independently acknowledges all seven events; closes and physically removes the synthetic source SQL file; then reopens the separate authority SQL file and verifies every event survives without conversation/memory plaintext. **This proves independent journal-file retention, not completed source-loss account restore, geographic separation or provider durability.** Temporary synthetic files are removed after the test; no real user information or secret is retained.

The Worker integration suite uses the actual MiraStore handler and actual workerd SQLite in two isolated test objects. It checks 503 after a remotely committed but lost deletion receipt, durable local tombstones, automatic retry before normal success, absent-transport refusal after reconstruction, all typed suppression actions, raw-write/legacy-recovery denial and scheduled-work refusal after writer fencing. Every external fetch is forbidden. Two test objects in the same runtime are not an offsite authority.

A separate code review found a transition race in legacy imports: protection could start while a KV read was waiting, and the old value could then be imported. The commit transaction now rechecks protection after that await. The added workerd regression holds the legacy read, begins protection, releases the stale account and verifies no record is imported.

Fresh local results: **329/329** web tests across 42 files; **30/30** Worker tests across six files, including six new actual-handler scenarios; full web ESLint and route generation/TypeScript passed. The two focused authority/replication files contain 27 tests. These results do not include a new acoustic/device test or live source-loss restore. Browser/build verification remains the GitHub CI gate for this continuation.

Commands (pinned Node 24, existing locked dependencies):

```sh
pnpm --filter @companion/web exec vitest run --config vitest.config.ts lib/suppression-authority.test.ts lib/suppression-replication.test.ts
pnpm --filter @companion/web exec vitest run --config vitest.worker.config.mjs tests/worker/suppression.test.mjs
pnpm --filter @companion/web test
pnpm --filter @companion/web test:worker
pnpm --filter @companion/web lint
pnpm --filter @companion/web typecheck
```

## Not implemented or activated

1. Independently hosted, authenticated authority service; privilege-separated operator fencing/enrollment; encrypted durable placement and trustworthy recovery of the authority itself. An uncertain old authority snapshot is not a valid latest head.
2. Complete initial suppression coverage under a bootstrap fence and an operator-safe activation/rollback process. `beginProtection` is an internal tested primitive, not permission to enroll existing consumer data with incomplete history. There is no deploy-time flag that enables it.
3. Bounded serving leases/in-flight drain, target/archive/challenge-bound fresh authority admission, suppression replay from the authority into a quarantined target and protected-writer handoff. The current permanent write fence **does not prove** that an old in-flight response cannot finish. No source-loss target is opened by this code; legacy `BackupEngine.finalize` restrictions remain unchanged.
4. Actual offsite source-loss/split-brain drill, verified archive/key custody/retention, agreed RPO/RTO and operator sign-off. No production backup keys or destinations are configured.
5. Real recovery email and external alert receipt, physical-device acoustic/lip-sync acceptance, screen-reader acceptance and independent security/legal/provider-data reviews remain separate product gates.

Production environment configuration is unchanged. The live release/evidence is recorded separately in the release report and GitHub; passing local tests or opening this PR is not a deployment claim.
