# Protected archive v2: usable independent source-loss recovery

14 September 2026. **Implemented and locally tested; not provisioned or activated in production.** This adds a distinct usable path. It does not upgrade old v1 archives or open v1 authority-quarantine targets. Payment and provider work are unchanged.

## Guarantee and ordinary system assumptions

For a v2 archive captured by an independently protected source, the target cannot serve restored account data until it has replayed the authority's complete, current, permanently fenced suppression history and independently acknowledged that same history as the uniquely bound successor. Account/conversation deletion, memory forgetting/correction and privacy withdrawal acknowledged after capture cannot resurrect through restore. New target deletions use the same pre/post acknowledgement barriers as the source. Old passwords, sessions and reset links do not revive.

This assumes trusted application/operator code, authenticated TLS transport, and a durable linearizable authority whose state and identity survive independently and are not rolled back. Keys and a complete encrypted archive must survive too. It does not withstand compromised operators, simultaneous rollback/loss of every independent copy, or loss of all encryption keys. The authority is a security boundary, not an untrusted public data source.

Normal linearizable semantics apply: an old request authorized before fencing can finish afterward, and previously emitted/network-buffered bytes cannot be recalled. The old writer's subsequent read/write acknowledgement barriers are refused. No global response drain, central egress gateway, serving leases, synchronized-clock safety assumption or automatic failover is invented. Operators explicitly change routing only after recovery completes. Already processed provider data is outside this storage recovery guarantee.

## Capture and coverage

1. Explicit operator `protect` enrolls the current storage identity and chosen immutable writer ID, starts its durable protection row at genesis and replays its full minimal journal. Configuration alone never silently enrolls or resets a generation. A configured but missing local protection row remains unavailable, including after old-source rollback.
2. `begin` requires its current journal to be fully independently acknowledged, then starts the existing nonce-bound 15-minute snapshot freeze. Ordinary storage writes remain blocked. Async crypto/network calls never run inside SQL transactions.
3. Pages use the existing authenticated encryption, owner/table schemas, per-chunk and total resource bounds. `finish` constructs the manifest and checkpoint from the **frozen server source**, never from operator JSON. It registers that exact archive ID, manifest digest, writer and checkpoint in the independent authority. A new registration must be at the current authority head; exact immutable retries are allowed.
4. The source rechecks its export lease after registration/encryption before releasing it. The resulting encrypted envelope is `{version:2,kind:"protected-snapshot",snapshot:<v1 chunk manifest>,registration:<receipt>}`. Its manifest digest binds the entire chunk inventory; the authority independently stores the exact registration. Failed/lost export responses can require a new capture; incomplete files are never promoted to valid archives.

The registration proves coverage for this current v2 snapshot under trusted source code. It does not retroactively prove protection for previously captured v1 data. No browser endpoint accepts arbitrary registrations. The source-only authority credential authorizes append/registration; a different recovery credential authorizes enrollment and handoff.

## Source-loss restore and successor

`restore-v2` first verifies every local encrypted archive chunk, then contacts only the target operator endpoint. No call to a surviving source, retirement proof or old local `latest.json` is required.

- The empty target pins the exact registration, source writer, archive digest, target name, local target storage identity, a fresh challenge and a fresh successor writer. All account snapshot tables and any existing protection row must be empty. Metadata identity is preserved; nonempty targets are rejected, never cleared.
- An authenticated atomic authority handoff checks the registered archive, permanently fences the old writer at its current head, creates exactly one successor and binds target/challenge/archive/writer together. Different targets, substituted archives and later takeovers cannot reuse the operation. Lost responses retry the same immutable tuple.
- Each target step rechecks that current authority handoff. Bounded snapshot import and journal replay retain durable progress and immutable page receipts. The verifier reconstructs the old writer's complete hash chain; gaps, conflicting events, wrong heads, corrupt ciphertext or partial SQL failures leave the target unavailable. No cached signed historical ledger substitutes for the current authority.
- Validation runs in existing ten-account batches, applying suppression and ownership checks, randomizing old password verifiers, clearing verification and requiring reset/reverification. Sessions, demo sessions, old reset/verification tokens and mail jobs are not in the snapshot.
- The successor replays the entire inherited minimal journal under its own hash chain. Before admission, the authority accepts only events identical to the old source's final history and refuses new events beyond that head. A fabricated/truncated inherited history cannot be admitted.
- Admission is durable and idempotent. Only the separate **v2** finalizer checks prepared state, pinned handoff/admission, exact local protected writer and acknowledged checkpoint, then atomically opens the target. The existing v1 authority finalizer refusal is unchanged. A failed response after admission resumes safely; a target rollback behind independent deletion state is refused by the existing ahead-head checks.
- After opening, normal account requests still pass independent acknowledgement checks. A non-default server-selected object must also contain an active v2 admission bound to that exact target name and its own storage identity. Selecting a new blank or incomplete object cannot create a new active account universe.

Resource bounds remain 1.8 MB plaintext/chunk, 20,000 chunks, one million rows/events and 4 GB total plaintext. Each replay request performs at most eight 128-event/ten-account steps; replication performs at most eight batches. Operator calls have a 15-second outer deadline, authority HTTP calls a four-second deadline and a 300 KB streamed response bound. Workerd-compatible `redirect:manual` plus non-2xx refusal never follows redirects or forwards secrets to another origin. A target remains quarantined on interruption; re-entry uses fresh authority checks. Historical suppression entries are not pruned.

Authenticated request and response parsers also cap empty/data chunks at 1,024, enforce a four-second read deadline and never await a hostile cancellation promise. Deadline timers are cleared after completion. A timed-out operator operation cannot later pin a handoff or finalize/open a target; an already-running replication flush may still finish immutable acknowledgements safely. Such acknowledgement progress is not admission. New capture refuses a suppression history beyond the implemented one-million-event recovery bound rather than producing an apparently usable but unsupported archive.

## Dormant deployment and owner-controlled activation

No current production Wrangler binding, route target, secret or paid service is changed. `apps/web/workers/recovery-authority.ts` is a separately deployable entrypoint; it is **not referenced by production configuration**. The operator must approve and configure independently surviving durable placement for its `MIRA_SUPPRESSION_STATE` SQL Durable Object binding, class `MiraSuppressionAuthority`, migration and retention. A separate SQL object in synthetic tests demonstrates source-file independence, not actual regional/account disaster survival. Do not colocate its only retained state with the source's only recoverable copy.

Authority settings:

- `MIRA_SUPPRESSION_AUTHORITY_ID`: stable non-secret authority identity, durably checked against existing metadata.
- `MIRA_SUPPRESSION_AUTHORITY_TOKEN`: cryptographically random source append/registration credential, at least 32 characters.
- `MIRA_RECOVERY_AUTHORITY_TOKEN`: different cryptographically random recovery/enrollment/handoff credential. Keep both out of Git, CLI arguments, evidence and archives. Missing/equal/malformed credentials fail closed.

Source/target settings additionally require `MIRA_SUPPRESSION_AUTHORITY_URL` (explicit HTTPS; no credentials/query/fragment/redirects), the matching authority ID/tokens, `MIRA_PROTECTED_RECOVERY_ENABLED=true`, owner-held `MIRA_BACKUP_KEY`/`MIRA_BACKUP_KEY_ID`, and existing `MIRA_ADMIN_KEY`. The authority never accepts a reset, raw SQL upload, deletion of its journal or browser-selected destination. The operator route retains same-origin and bearer authorization. Exported account chunks remain encrypted.

Enabling external authority configuration before provisioning deliberately makes ordinary access unavailable until explicit enrollment/replay succeeds. Plan that bounded maintenance window and an authority outage policy: this implementation chooses **unavailable, not unprotected success**. Secret removal or a missing local protection row cannot silently downgrade a protected generation. Never reset or erase authority state to clear an outage.

The existing operator script supports these commands (paths/IDs are placeholders, secrets come only from owner-managed environment):

```sh
node apps/web/scripts/backup-operator.mjs protect approved-writer-id "ENABLE INDEPENDENT SUPPRESSION"
node apps/web/scripts/backup-operator.mjs backup-v2
node apps/web/scripts/backup-operator.mjs verify /absolute/retained-vault/archive-id
node apps/web/scripts/backup-operator.mjs restore-v2 /absolute/retained-vault/archive-id mira-recovery-approved-target
```

Use `MIRA_BACKUP_SOURCE_URL`, `MIRA_BACKUP_OPERATOR_KEY`, `MIRA_BACKUP_DIRECTORY` and encryption-key settings for capture. `MIRA_BACKUP_SOURCE_OBJECT` defaults to `mira-production-v1`; explicitly set it to the admitted recovery target when making subsequent backups of that generation. For source-loss recovery, `MIRA_BACKUP_TARGET_URL` is required; the old source URL is not contacted. Resume the same archive/target after a partial recovery. A permanently fenced generation is never unfenced, even when the operator loses a response.

After the target reports `complete:true`, separately configure the application's **server-side** `MIRA_STORE_OBJECT_NAME` to that exact target and retain its authority configuration. No CLI command performs a deployment/routing change. Verify real reset/reverification delivery and owner-scoped account access before reopening consumer traffic. Restoration cannot bypass the real sender requirement; an email-delivery provider still needs explicit owner setup. Test operational authority availability and independent archive/key restoration before promising RPO/RTO.

## Evidence and remaining activation gates

`lib/protected-recovery.test.ts` uses three separate real SQLite files, synthetic accounts and an encrypted filesystem vault. It closes and physically unlinks the source **before any retirement**, successfully opens a protected target, verifies post-backup deletion/privacy suppression and credential invalidation, then independently acknowledges a new target deletion. It forbids global network fetch; an injected adapter exercises actual authenticated service/transport code. The journal contains no conversation or corrected-memory plaintext.

Additional cases cover lost handoff/admission responses, SQL restart, archive substitution after fencing, competing targets, v1 upgrade/finalization refusal, partial replay/authority loss, failed SQL replay rollback, fabricated successor events, expired capture lease, strict schemas, nonempty target suppression rows, separate authentication roles, oversized bodies and orphan authority metadata. The actual workerd suite uses only synthetic bindings and validates transport, selection/admission refusal and account storage behavior. These are local correctness tests, not production/offsite service certification.

Production remains gated on approved independent authority/archive placement and retention, credential/key custody, configured transport, real recovery-email delivery, explicit enrollment/capture, actual source-loss operational drill, approved recovery objectives and reviewed routing release. Those are concrete activation requirements; no paid infrastructure is provisioned or assumed free indefinitely by this source change.

### Verified local run

On 14 September 2026, using pinned Node **24.18.0** and the repository's existing dependency installation:

```sh
node node_modules/vitest/vitest.mjs run --config vitest.config.ts
node node_modules/vitest/vitest.mjs run --config vitest.worker.config.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/vitest/vitest.mjs run --config vitest.config.ts lib/protected-recovery.test.ts -t 'physically destroys' --disableConsoleIntercept
```

Executed from `apps/web`: **363/363 web tests across 46 files** passed in 9.26 seconds; **35/35 actual Worker tests across seven files** passed in 31.16 seconds. Full web typecheck and scoped ESLint covering all changed TypeScript, Worker/operator scripts and tests passed with zero warnings. `git diff --check` passed. The current source-loss fixture measured **40.96 ms** for local archive verification/import, independent suppression replay and protected target admission after physically deleting the source file; the subsequent protected deletion assertion passed. This small synthetic measurement is not a production/offsite RTO, and excludes provisioning, network distance, consumer email delivery and operator routing.

The 14 new Node cases include eleven recovery/core/transport cases and three actual operator-route/selector module tests. Three new actual Worker cases exercise source SQL destruction, authenticated transport through a separate synthetic authority Durable Object, active target storage/new deletion, invalid/unprepared selection refusal and disabled/unauthenticated operator access. No external provider/network endpoint or production object was called. The test-only authority binding exists only in `wrangler.test.jsonc`; no production configuration was modified.
