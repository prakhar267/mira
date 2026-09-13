# Mira account storage, migration and recovery

Updated 13 September 2026. Applies to `apps/web`, the existing `MIRA_STORE` SQLite Durable Object, and its existing production object name. This is implementation and local synthetic evidence, not a Cloudflare capacity or disaster-recovery certification. No production data or provider traffic was used for these tests.

## Authority and write boundaries

- `records` retains accounts, hashed-token sessions, versioned profile envelopes, policy evidence, bounded snapshots and operational records. Legacy `LUMA_ACCOUNTS` remains read-only migration input and a deletion-cleanup target; it is not authoritative.
- A profile envelope is `{ schemaVersion: 1, revision, state }`. Account reads and legacy import validate the schema. Malformed, unknown-version or oversized legacy profiles fail closed for operator-assisted recovery; the app does not replace them with a demonstration conversation.
- `PUT /api/account/state` requires the last observed revision. Compare-and-swap executes with transcript updates and the daily profile snapshot in one SQLite transaction. One of two simultaneous saves wins; the other receives `409 STATE_CONFLICT`. Missing revision receives `428 REVISION_REQUIRED`. Retry is not a license to overwrite a newer document.
- Signup validates before writing and atomically claims the email, creates the account, profile, transcript, policy evidence and session. A transaction failure rolls everything back. If a response is lost after a successful commit, the existing password can sign in; a duplicate signup cannot create a second account with that email.
- Account/companion/conversation identity, voice identity, catalog, wallet, ownership and subscription fields are not client-authoritative. Billing entitlement is still read from verified billing records. Legacy demonstration balances are reset during migration because they were not trustworthy economic records; payments are not enabled by this work.
- Conversation creation/deletion uses server commands and server-generated IDs. Deleting a conversation tombstones its ID and deletes its transcript rows. A delayed write cannot re-create the removed conversation. Saved memories are a separate user-controlled record; deleting a transcript does not claim to delete independently saved memories.

## Bounded beta envelope

| Resource | Enforced bound / behavior |
| --- | --- |
| New active accounts | Default 250; `MIRA_BETA_ACCOUNT_LIMIT` accepts an integer from 1 through 5,000. Invalid values use 250. New signup receives `503 BETA_CAPACITY` when full, without a fabricated retry time. Existing accounts remain usable. |
| Known legacy accounts | Existing account imports are not denied by the new-signup cap. They may lift the known count above the configured cap; further new signup remains closed. Inventory unfinished legacy migration before expanding public access. |
| State upload | Streamed byte limit of 2 MB, then a validated state budget of 1.5 MB. Profile/journal data excluding messages is bounded to 850 KB. |
| Transcript | Separate rows keyed by account and message ID; at most 2,000 messages and 8 MB cumulative UTF-8 transcript payload per account; 8,000 characters per message. The byte cap keeps complete export within a bounded serialization envelope. Retried IDs update once, rather than append duplicates. Unchanged messages avoid SQLite value rewrites. |
| Initial transcript window | At most 200 recent messages and 600 KB of transcript payload. `GET /api/account/messages` pages older records, optionally by owned conversation ID. The complete bounded transcript is included in a reauthenticated export. |
| Memory | At most 300 bounded records; 2,000 characters each. Server create/edit/forget commands, never whole-state memory updates. |
| Other collections | Explicit schema bounds include 100 journal entries, 200 call records, 100 events, 100 photos/artwork entries and bounded nested metadata. The profile byte budget can be reached before a count limit. |
| Account media | No inline `data:`/`blob:` uploads or arbitrary remote asset URLs. Only bundled `/assets/` artwork is persisted. A private upload service has not been implemented. |
| Daily profile snapshots | At most the first eligible snapshot per account/day, retained for 30 days. Snapshots exclude transcripts and are retired by privacy changes. They are not complete account backups. |
| Legacy work | One 25-record migration page per alarm; 25 key purges and one 25-record prefix purge batch per pass. Progress is persisted. Failed cleanup retries while authoritative access stays denied. Expiry cleanup processes at most 500 records and 1,000 counters per pass; reads already reject expired values before cleanup. |

The account cap is a controlled-beta admission boundary, not a demonstrated maximum concurrency or total byte quota guarantee. Worst-case transcript sizes, indexes, tombstones, provider quotas and Cloudflare account quotas still need operational monitoring. Do not infer “250 simultaneous calls” from this setting.

## Privacy and erasure semantics

Memory forgetting removes the memory object—including content, normalized content and source references—from active state and ordinary exports. Derived companion reflections are retired, linked future events are removed, existing profile snapshots are tombstoned, and legacy backup-prefix cleanup is queued. Editing memory also retires old snapshots and derived reflections. A source transcript is not erased by forgetting a memory; use conversation deletion or turn stored history off to remove source messages.

Paused memories remain visible, editable and deletable. Creating another memory while memory storage is paused is rejected. Turning off stored history atomically clears transcript rows, call histories and derived conversation reflections, and retires old snapshots. Explicit journal entries and manually saved memories remain separate; switching off AI processing does not itself delete them.

`memory_suppressions` stores only account ID, memory ID and forgetting time, never the forgotten content. `privacy_suppressions` stores the most recent revision and disabled/enabled processing/history/memory flags. Deleted conversation rows retain only their IDs and a deletion flag. These records remain for the account lifetime so arbitrarily old tabs and restored snapshots can be denied. They are removed on account deletion, when the stronger account tombstone takes over.

Account deletion erases the account, state, transcript rows, policy, sessions, recovery/verification links, billing link, queued mail information and snapshots inside the authoritative transaction. Content-free account and legacy-key tombstones remain indefinitely until a separately reviewed legacy-retirement policy can prove they are unnecessary. Expired demo sessions need no KV migration tombstones and are removed during cleanup. Operator dashboards expose tombstone and purge-backlog counts, not conversation content.

These are application-level guarantees. SQLite/PITR retention and any already-processed provider data are separate retention systems. The application does not claim to retroactively erase provider logs or every physical backup byte. Provider-retention review remains a launch gate.

## Migration and compatible release behavior

1. Deploy only the active Worker build preserving the existing Worker name, object identity, bindings and Durable Object migration history. New SQL tables are created additively.
2. Legacy network reads occur outside request-wide concurrency locks. Recheck authoritative rows and deletion tombstones inside a synchronous transaction after the remote read. A newer save or deletion wins over stale KV.
3. A valid unversioned state migrates transactionally on account read: bounded transcript rows are split out, a version/revision is added, old snapshots are retired, deleted-memory objects are removed, and historical demo economic values lose authority.
4. Existing age declarations remain self-declarations, not verified age. Migrated policy evidence is marked `legacy-self-declaration`; inference remains blocked until the user explicitly accepts the current 13 September 2026 disclosure. An ordinary autosave cannot upgrade this evidence.
5. Storage/list requests schedule legacy scan work rather than scanning the entire namespace on every page. Access to not-yet-imported support entries may require the bounded migration alarm to finish. Track backlog before declaring migration complete.

Do not roll back to the archived prototype, KV-authoritative code, or a build that expects unversioned state. Those releases cannot safely interpret split transcripts and versioned envelopes. After the first migration, use a tested compatible release or a forward fix. Keep admission closed if compatible rollback evidence is unavailable.

## Recovery procedure and remaining gates

The checked-in test restores a synthetic account-shaped SQL snapshot into a distinct local object, then replays **post-snapshot** memory, privacy and account-deletion suppression before permitting reads. It verifies that forgotten memory is scrubbed from active restored records, withdrawn history is removed, inference consent stays off, and a deleted account cannot return. There is no public or production restore endpoint.

For a real incident, the operator must:

1. Stop admission/writes and isolate the recovery target; never let a historical object serve traffic immediately.
2. Preserve the current content-minimized suppression/deletion state outside the object being restored. Recover from a trustworthy, encrypted backup or authorized Cloudflare recovery point, using a compatible tested build.
3. Replay account tombstones, deleted-conversation IDs, memory suppression and the latest privacy decisions before any state/export/inference route is allowed. Read/sanitize restored profiles, remove suppressed transcripts and retire invalid snapshots. A rollback of the ledger itself is not erasure-safe.
4. Invalidate restored sessions and outstanding recovery/verification credentials; reconcile mailbox jobs and verified billing records without enabling new payments. Check that suppression does not depend on a subsequently resurrected session.
5. Run owner-scoped synthetic checks and document recovery-point age, elapsed recovery time, missing data and reconciliation outcomes before reopening admission.

An operator-driven encrypted account/transcript archive and separately exported minimal recovery journal are now implemented. See [Encrypted backup operations](ENCRYPTED-BACKUP-OPERATIONS.md) for authenticated manifests/chunks, explicit key/destination gates, bounded freeze leases, target quarantine, credential invalidation and fresh surviving-source cutover proof. Independent filesystem and actual Worker regressions exercise this path; production keys/offsite storage have not been configured and no real user data has been exported.

**Source-loss disaster recovery is not established.** If the source is lost before fresh cutover proof and no trusted independent latest-ledger authority survives, restore stays quarantined rather than guessing that an older signed ledger is current. Owner-approved RPO/RTO, a real offsite/source-loss recovery exercise, recovery-email delivery, retention/legal review and routing cutover remain external gates. The daily profile-only snapshots and earlier marker-only PITR drill do not satisfy those requirements. Proposed RPO ≤1 hour and RTO ≤4 hours still require approval and measurement; they are not achieved service promises.

## Local evidence

Commands (Node 24.19.0, pnpm 11.19.0, fresh execution):

```sh
pnpm --filter @companion/web exec vitest run lib/account-state-integrity.test.ts lib/account-request-boundary.test.ts lib/store-engine.test.ts
pnpm --filter @companion/web exec vitest run --config vitest.worker.config.mjs tests/worker/account-integrity.test.mjs --reporter=verbose
```

The focused Node suite passed 38 tests. The Worker suite passed 10 tests against the actual route handlers, SQLite binding, synchronous transactions, legacy-race fencing and alarm. External `fetch` is forbidden by the test fixture; provider, email and physical-device acceptance are not inferred from these results.

Worker rerun at 16:26 IST on 13 September 2026 measured a synthetic mixed load with four accounts and 1,500 messages each (6,000 transcript rows). It measured 80 operations: 20 authenticated state-read/save pairs, 20 metric updates, 20 support writes and 20 support-list requests, with four interleaved clients. Bootstrap is outside the timed workload. The combined account/boundary run passed 13 tests.

| Observation | Result |
| --- | --- |
| Timed workload | 741 ms |
| Measured operation failures | 0 / 80 |
| P50 / P95 / P99 operation duration | 6 / 137 / 166 ms |
| Recorded profile/operational rows | 45; 63,301 logical value bytes |
| Transcript rows / logical value bytes | 6,000 / 1,209,120 |
| Purge backlog / active inference leases | 0 / 0 |

This small warm local-workerd workload has no production network, provider inference, cost accounting or acoustic work. An earlier 16:20 run measured 385 ms total and 3/63/107 ms percentiles with zero failures; this variation demonstrates host contention, not a controlled before/after optimization result. It is not evidence of a production throughput ceiling. Separate integration cases cover slow legacy KV, deletion, expiry/cleanup alarms and restore suppression. Repeat with sustained admission, adversarial large payloads and realistic network conditions before expanding beta capacity.

The current Cloudflare Vitest plugin exhibited a native runtime crash when its generic `reset()` cleared live SQLite actors. The account suite drains response bodies, clears **only synthetic** tables and alarms through `runInDurableObject`, evicts actors, then calls `reset()`. This avoids stale fixture state and does not add cleanup or restore access to production routes.
