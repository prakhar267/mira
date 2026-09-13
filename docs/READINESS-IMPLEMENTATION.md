# Mira production-readiness implementation — 13 September 2026

## Scope and outcome

Implemented against `5487e4e1655292ef4dc6b9da67f189cf3511b437` on `codex/mira-production-readiness`, using three independent implementation agents plus root integration/review. The owner's [assessment](PRODUCTION_READINESS_PROMPT.md) was preserved. **All payment work is excluded.** No live deployment, production migration, real provider inference, real email/alert recipient, purchase or account billing change was performed.

This is a substantial free-beta hardening implementation, not unconditional launch approval. Current source and current public deployment are different until an authorized promotion. The capability, access, persistence and failure-recovery defects were addressed; human acoustic quality, actual delivery, independent reviews and large-scale disaster recovery remain separate gates.

## Acceptance ledger

“Verified” below means the named local regression, not code inspection alone. Source-only or external requirements are explicitly limited.

| Phase / condition | Affected implementation and regression | Status |
|---|---|---|
| 1. Active runtime, isolated setup and supported Node | `CURRENT-ARCHITECTURE.md`; Node24.18.0 pins; synthetic Wrangler configs; actual browser/Worker startup | Implemented and verified locally |
| 2. Identity, revocation, age declaration and processing consent | `inference-policy.ts`, four companion routes, demo/capability routes; missing/expired/revoked/withdrawn tests and real Worker unauthorized routes | Implemented and verified; age remains self-declared |
| 2. Payload bounds, budgets, capability denial and retry metadata | Streamed byte/depth reader, explicit schemas, attempt/unit/concurrency reservations; account capacity isolated from demo share; inference/capacity suites | Implemented and verified; audio duration/token use are estimates, not billable measurements |
| 3. Concurrent writes, duplicate turns and signup failure | Schema/envelopes, SQLite atomic bootstrap/CAS, coalesced client saves; rollback/conflict/idempotence tests; browser conflict recovery | Implemented and verified; conflict recovery discards only after confirmation, no semantic merge |
| 3. Memory erasure and stale-write/import/restore suppression | Server memory/conversation commands, suppression tables and rechecks; raw-record/export assertions and isolated SQL restore with newer suppression | Implemented and verified at application level; independent encrypted backup/ledger remains deferred |
| 3. Sensitive operations, history controls and pagination | Recent-password reauth, optional history enforced in SQL/snapshots, bounded transcript table (2,000 messages /8 MB cumulative UTF-8) and older-message UI; actual Worker lifecycle + browser contract fixture | Implemented and verified; malformed oversized legacy profiles need operator-assisted recovery |
| 4. Real capabilities and supported prompt preferences | Server capability contract; runtime adapter; unsupported images/vision/reflections/notifications/voice customization disabled; preferences normalized consistently; prompt and UI tests | Implemented and verified for supported paths |
| 4. Natural continuity and real streaming | Language/pronoun/correction/prompt/safety regression cases; completed reply remains browser-revealed text | Improved and synthetically checked; open-ended human quality and incremental browser transport deferred, not claimed |
| 5. Category/language safety and output checks | Central `companion-safety.ts`, EN/HI/Hinglish positives/negative near-matches, output check before speech/context | Implemented and verified on curated cases; novel adversarial semantics and independent safety review unverified |
| 6. Calls/replies/resource cleanup and retry | Real UI reply adapter, CallSession, signal/epoch fences, voice-note limits; unit and cross-browser microphone late-result/cleanup scenarios | Implemented and verified with synthetic browser media, not physical acoustics |
| 6. Timing measurement and real audio | Endpoint delay included in roundtrip; stage metrics; P50/P95/P99 histogram upper bounds; existing physical-device checklist | Instrumented and unit-verified; physical acoustic/lip-sync/echo/long-call and P95 target unverified |
| 7. Recovery, verification, compatible passwords | Leased SQLite mail outbox with expiring dedupe receipts, one-use tokens, all-old-reset invalidation and dummy missing-account hashing; 5 real Worker mail lifecycle tests plus units | Implemented and verified with mocked delivery; no real sender/mailbox acceptance |
| 7. Payments/commercial lifecycle | Existing billing-disabled boundary preserved; release seal refuses activation | Deferred: explicitly excluded by owner |
| 8. Mixed load, bounded migration/cleanup and finite envelope | Atomic 250-known-account admission cap, separate transcripts, bounded legacy/expiry work, storage/queue metrics; actual workerd workload and slow-KV race/alarm tests | Implemented and measured locally; no production scale/cost claim |
| 8. Recovery-point and availability commitments | Local account-shaped restore with post-snapshot deletion/privacy replay; compatible forward-fix procedure | Isolated logic verified; external encrypted backup, full provider PITR, RPO/RTO and delivered external alerts require named operator inputs |
| 9. Maintainability, truthfulness and accessibility | Extracted account-sync/conversation-turn/capability/dialog modules; lazy call/3D components, route boundaries, scroll preservation, mobile widths, keyboard focus and labeled forms | Implemented and browser-verified. Full screen-reader/contrast/zoom audit and mobile hardware performance remain unverified |
| 10. Mandatory Worker/browser/CI tests | Active suites fail with no tests; Node checks, workerd routes/SQLite/alarms, Playwright Chromium/Firefox/WebKit and actual vinext build | Local checks recorded below; GitHub Actions execution blocked externally |
| 10. Exact artifact promotion and release correlation | Hash manifest guards, trusted-CI provenance before source execution, isolated compiled-byte smoke, explicit manual promotion, exact health SHA/version and retained failed smoke | Implemented; local artifact smoke verified, public promotion not authorized/performed |
| 10. Advisory/config/docs and external gates | Advisory-ID/version/path/owner/expiry exception, current-run reports, active/optional env split, historical-doc warnings; one current guide | Implemented; upstream mobile-only advisories remain mitigated exceptions, not absent vulnerabilities |

## Verification log

Initial tree contained only the owner's untracked assessment. Initial lint/typecheck were cached. Disk had about14GiB free, so no cleanup was performed.

- Baseline fresh active web tests: **112 tests /21 files**.
- Fresh workspace run `pnpm exec turbo run lint typecheck test --force`: **36/37 tasks succeeded, zero cache hits**. All tests/typechecks passed; two test-harness anonymous-default-export lint warnings failed the web lint gate. Both warnings were fixed. Optional platform tests executed with mocks; optional background worker has no test files and is not counted as active Worker verification.
- Required `pnpm lint`: **passed**, active web fresh /11 other tasks cached from the forced run.
- Required `pnpm typecheck`: **passed**, active web fresh /11 other tasks cached. The command includes Next route type generation. Bare `tsc` after a Vite development run can read incompatible generated route stubs; the stable vinext augmentation now lives separately and generated `next-env.d.ts` is not tracked.
- Required `pnpm test`: **260 active web tests /36 files passed fresh**, other12 Turbo tasks reused the forced run. Optional workspaces contribute96 tested cases; they are not evidence of the live backend.
- `pnpm --filter @companion/web test:worker`: **18/18 tests across3 files passed fresh**. These execute actual route handlers, SQLite transactions, alarms, slow legacy import, one-use tokens and isolated restore logic. HTTP/provider/email behavior is synthetic.
- `pnpm --filter @companion/web test:browser`: **final frozen-source run36/36 passed**, zero skips/retries/flakes, Chromium/Firefox/WebKit12 each,78.7seconds including artifact startup (2026-09-13T11:36:57Z). Initial runs exposed a hydration race, development-module cold-loading delays, and WebKit service-worker bypass of HTTP mocks (30/36 on the first compiled run). Recovery waits for hydration; tests now use compiled artifacts and block service workers only in HTTP-mocked specs with fixture-hit assertions. A prior corrected compiled run also passed36/36. These are lifecycle/UI checks, not human acoustic acceptance.
- `pnpm --filter @companion/web build:vinext`: **passed**. Ignored Next `webpack` configuration, vinext route-classification and >500KB chunk warnings remain visible. Lazy loading is implemented; no mobile LCP/INP improvement is claimed without device measurements.
- `node apps/web/scripts/artifact-smoke.mjs`: compiled Worker executed locally with the server inference shutdown override, no rebundle, unique storage and empty env file; **5/5 HTTP checks plus inference-refusal probe passed**. Initial asset check incorrectly required optional Content-Length; corrected to inspect actual GLB/VRM bytes. Final committed-source build/seal is checked again before handoff. `--local` alone is not an AI egress guarantee.
- Dependency audit: exact two `image-size@1.2.1` mobile/Metro-path high advisories are covered only by reviewed parser mitigation, exact advisory IDs, owner and **2026-09-27 expiry**. Latest report: [dependency-audit.json](../audit/readiness-2026-09-13T11-31-40-557Z/dependency-audit.json). Earlier run retained. No other finding is allowed by package name alone.
- `git diff --check`: passed during integration; final commit review repeats it.

Commands used the root Node24.18.0 PATH override. Some agent-focused checks used their supplied Node24.19.0 runtime; the mandatory root runs and release smoke used the pinned24.18.0. No test output is interpreted as universal conversation/safety certification.

## Reproduced and repaired integration defects

Beyond the original findings, tests/review caught and repaired:

1. Signup redirected to login before onboarding; the public onboarding page now works while APIs retain authentication.
2. Saving status appeared “Saved” during debounce, and logout/export could omit the pending edit; status updates immediately and flushes before those actions.
3. A recovery input could be filled before hydration and lose that value; all recovery inputs/actions wait for ready state.
4. Completed mail requests reused provider idempotency keys with new links; expiring content-free completion receipts now prevent this.
5. Older queued/issued reset links could survive a newer password reset; timestamp fences invalidate them and old sessions.
6. Frequent duplicate email requests could postpone the alarm; enqueue now preserves an earlier scheduled alarm.
7. Personality values stored on a0–1 scale were labeled0–100 to the model; payload validation and production prompt now agree.
8. Release provenance was checked after installing caller-selected source; verification now occurs before checkout/install.
9. Generated Next/vinext type files dirtied release source; the generated file remains locally present but untracked, with the required augmentation in a stable source file.
10. The production service worker bypassed WebKit HTTP mocks. Fixture-only specs now block service workers and assert that their handlers ran; no production cookie/service-worker security was weakened. Separate capability-refresh ownership guards prevent stale anonymous responses from overriding newer consent.
11. Pausing, deleting or correcting memory during body streaming, provider work or reranking could leave stale context. Rechecks now fence direct recall, every provider attempt and delivery; already-sent requests cannot be recalled.
12. `wrangler --local` alone does not isolate Workers AI. Compiled test helpers now enforce the server inference kill switch, verify its refusal, and use a non-credential rather than cached owner OAuth. No production kill switch was activated.

## Capacity evidence, limits and residual risks

[Storage evidence](STORAGE-RECOVERY.md) records four synthetic accounts,6,000 messages and80 mixed operations with zero failures. One run measured741ms total and local P50/P95/P99 of6/137/166ms; an earlier run was materially faster. These are short, warm, contention-dependent local observations, not a user count, production cost or throughput promise.

The single coordinator remains intentional until measurements justify partitioning. It now has bounded admission/payload/records/cleanup, but retained tombstones and worst-case data still require monitoring. Profile snapshots exclude transcripts and are not a disaster backup. Independently retained encrypted deletion/privacy evidence must survive a real restore; this release does not create that external system.

Safety remains deterministic defense-in-depth plus prompting, not a comprehensive semantic moderation service. Decoded compressed-audio duration is not verified. Browser audio is mocked for lifecycle tests; it does not prove real microphone recognition, Priya playback, lip-sync, echo suppression, mobile frame rate or long-call reliability. Automatic account memory extraction and unsupported creative features remain disabled rather than simulated.

## GitHub and release status

Target repository: [prakhar267/mira](https://github.com/prakhar267/mira), private, unchanged visibility. Delivery branch: [`codex/mira-production-readiness`](https://github.com/prakhar267/mira/tree/codex/mira-production-readiness). This implementation is offered for review, not an automatic merge or live deployment. Exact delivered commits are available in Git history and the final handoff.

The September13 GitHub health job check again reported no started steps because of account payments/spending limit; configuring workflows cannot clear that external block. No spending setting was changed. Production credentials were not inspected or activated. A normal branch/main push no longer automatically deploys; promotion requires an explicit successful main CI artifact and deployment authorization.

**Limited free beta:** materially hardened source with local automated coverage; controlled release still requires authorized deployment and genuine provider/device acceptance.

**Paid general availability:** not ready and deliberately out of scope. Payments, verified sender, external alerts/on-call, domain decision, independent legal/security/provider-retention review and approved recovery commitments remain owner/external gates.

## Current guides

- [Architecture, capability matrix and configuration](CURRENT-ARCHITECTURE.md)
- [Inference authorization, budgets and safety scope](INFERENCE-BOUNDARY.md)
- [Storage, migration, recovery and load evidence](STORAGE-RECOVERY.md)
- [Build, artifact promotion and rollback boundary](DEPLOYMENT.md)
- [Physical-device call checklist](REAL-DEVICE-CALL-QA.md)
