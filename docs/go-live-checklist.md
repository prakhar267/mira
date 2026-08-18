# Saathkind go-live checklist

Last updated: 18 August 2026  
Current decision: **BLOCKED for real users, private conversations, external AI processing, notifications, and payments**  
Permitted now: clearly labelled synthetic, non-sensitive integrated beta only

## 0. Current release boundary

- `UserStateCoordinator`, a SQLite-backed Durable Object, is authoritative for each synthetic account and its demo session.
- The account is one bounded document protected by revision compare-and-swap and a deletion tombstone.
- Bootstrap schedules that account's irreversible Durable Object alarm for exactly 30 days later. Activity does not renew the session/account. Users can export or delete sooner.
- The 30-day alarm is per account, not global Cron, and is synthetic-beta hygiene—not a production retention policy.
- Separate token-hash and hashed rate-key coordinator objects hold bootstrap/deletion metadata and short-lived fixed-window counts; their alarms enforce the disclosed horizons.
- `STATE` KV stores only opaque routing/user-session pointers through account expiry. There is no active registry or `RATE_LIMIT` KV binding, and KV is not content authority.
- Export is synchronous authenticated JSON; it does not use Queue or R2.
- Ordinary chat is deterministic and disclosed; no Gemini credential or external model call is active.
- Follow-ups are planner records only; no notification is delivered.
- No D1, R2, global Cron, Gemini, verified identity, payment, paid entitlement, or notification provider is active.
- Pre-coordinator synthetic sessions are intentionally invalid. There is no legacy-state migration promise.
- The Durable Object class migration is forward-only. Recovery is containment and a compatible forward fix, never a downgrade to KV authority.

Every checked item needs dated evidence and an owner. A polished UI or successful deploy is not proof of private/enterprise readiness.

## 1. Release record

- [ ] Release candidate commit SHA: `________________`
- [ ] Cloudflare version/deployment ID: `________________`
- [ ] Target URL: `________________`
- [ ] Release manager: `________________`
- [ ] Incident owner: `________________`
- [ ] Product sign-off/date: `________________`
- [ ] Engineering sign-off/date: `________________`
- [ ] Security/privacy sign-off/date: `________________`
- [ ] Synthetic-beta go/no-go time (UTC/IST): `________________`

## 2. Scope and legal truth

- [x] Product/architecture/security documents distinguish synthetic beta from private/paid service.
- [x] Current docs name the account, token, and rate coordinator roles and KV as routing only.
- [x] Current docs state synchronous JSON export and no Queue/R2 export.
- [x] Current docs state irreversible 30-day per-account expiry, earlier export/delete, no global Cron, and no production retention claim.
- [x] Current docs state no active Gemini, notification, payment, D1, R2, or verified identity.
- [x] Current docs state that coordinator cutover invalidates old synthetic sessions without migration.
- [x] Current docs state forward-fix recovery and forbid pre-coordinator/KV-authority rollback.
- [ ] Every visible CTA and settings label says synthetic/non-sensitive beta where context requires it.
- [ ] No page claims private, confidential, anonymous, therapeutic, human, production-ready, compliant, encrypted end-to-end, or enterprise-certified service.
- [ ] Pricing/plan limits are clearly research hypotheses with no checkout, renewal, tax, cancellation, or refund offer.
- [ ] Qualified Indian counsel approves final identity, terms, privacy, age, safety, contact/grievance, and future commerce policy before real users/payment.
- [ ] Working brand “Saathkind,” domain, copy, assets, licenses, and clean-room status receive professional clearance.

## 3. Synthetic-beta data correctness

- [ ] Bootstrap creates one coordinator document/session, fixed `expiresAt`, and the per-account alarm.
- [ ] The demo session is non-renewable and coordinator-authoritative; KV only routes the token hash.
- [ ] Pre-coordinator session returns the documented invalid/expired state and no migration occurs.
- [ ] Concurrent writers from one revision produce one success and one `409`, with no lost update.
- [ ] Account documents over 1.8 MB fail honestly while read/export/delete remain reachable.
- [ ] `clientMessageId` prevents duplicate chat creation within the conversation.
- [ ] No other mutation is described or tested as generically idempotent/replay-safe.
- [ ] Export returns `status: ready` and complete owner-scoped JSON in the same response.
- [ ] Export creates no data-request record, Queue message, R2 object, or reusable server URL.
- [ ] Manual deletion requires exact `DELETE`, removes account/session content, writes a tombstone, clears routing, and invalidates the old session.
- [ ] A stale in-flight write cannot recreate manually deleted or automatically expired state.
- [ ] Alarm does nothing before `expiresAt`, tombstones at/after it, does not renew on activity, and is irreversible.
- [ ] Browser copy explains that device-local state/downloads may outlive cloud expiry until cleared by the user/product.
- [ ] Two synthetic accounts cannot list/read/mutate/export/delete each other's data.

## 4. Application and deployment security

- [ ] `npm ci`, production build, all tests, dependency audit, and Wrangler dry-run pass on the exact release commit.
- [ ] Built client contains no `.env`, `.dev.vars`, source map, credential, raw private fixture, or internal secret.
- [ ] GitHub `main` protection, required CI, private vulnerability reporting, secret scanning/push protection, and dependency alerts are enabled.
- [ ] Protected deploy environment requires approval and uses a narrowly scoped Cloudflare token.
- [ ] Deployed version contains the `USER_STATE`, `STATE`, and asset bindings expected by health checks; no stale `RATE_LIMIT`, Queue, Vectorize, R2, D1, or Cron binding remains.
- [ ] No Gemini, payment, notification, R2, or database credential is present.
- [ ] Origin allowlist, cookie flags, CSP, HSTS, framing, MIME, referrer, permissions, COOP, and `no-store` headers pass a clean-browser test.
- [ ] Body/method/schema limits and safe error envelopes cover every active route.
- [ ] Logs exclude conversation, memory, export body, email/name, token/cookie, authorization header, and secrets.
- [ ] A cross-user test suite covers list/read/write/export/delete and error behavior.
- [ ] A compatible forward-fix drill preserves the coordinator class/migration and returns the beta to health.

## 5. Product, accessibility, and safety QA

- [ ] Desktop/mobile/short-landscape journeys pass in a clean browser against the exact deployed bundle.
- [ ] Keyboard, focus, dialogs, drawers, onboarding, chat status, export/delete, reduced motion, zoom/reflow, and screen-reader names pass.
- [ ] Refresh, back/forward, offline/slow, expired session, cutover session, conflict, duplicate chat, and account-size states are understandable.
- [ ] Ordinary chat is labelled deterministic fallback and performs no outbound model request.
- [ ] English/Hindi/Hinglish/Devanagari/transliteration/obfuscation safety tests pass the reviewed synthetic set.
- [ ] Crisis copy accurately identifies Saathkind as AI and never claims emergency contact.
- [ ] Planner/follow-up copy says nothing will be delivered.
- [ ] Memory view/edit/pin/forget/pause and consent state are understandable and owner-scoped.
- [ ] Safety reporting states that no human case system is connected.

## 6. Operations gate for the synthetic beta

- [ ] Release and incident owners can access Cloudflare status/deploy/log views with MFA.
- [ ] Synthetic probes cover root, nested route, health, bootstrap, deterministic chat, export, delete, and alarm tests.
- [ ] Alerts identify route-wide 5xx, missing coordinator/bindings, conflict surge, tombstone/alarm failure, and secret-scan findings.
- [ ] [Runbooks](runbooks.md) have been exercised for forward fix, invalid session, conflict storm, early/late alarm, deletion failure, export leakage, cross-user exposure, and credential rotation.
- [ ] Public/status communication can explain synthetic-beta outage and irreversible expiry without exposing data.
- [ ] Beta can be closed immediately if correctness or safety is uncertain.
- [ ] No real-data support, privacy, or grievance SLA is implied before a staffed, verified channel exists.

## 7. Explicit private/paid-service blockers

All remain unchecked. The inactive adapters in this repository do not satisfy them.

- [ ] Verified identity, account recovery, recent re-authentication, staff/admin controls, and independent authorization review.
- [ ] A new, approved production data architecture with record-level semantics, encryption/key rotation, audit, category-specific retention, capacity, backup/restore, and deletion suppression.
- [ ] Complete private export design and tested delivery lifecycle.
- [ ] Counsel-approved data inventory, purposes, consent/legal basis, processor list, locations, retention, deletion, and user rights.
- [ ] Approved paid model/provider arrangement, current terms/DPA, minimum-data design, key/budget/circuit breaker, and multilingual safety/privacy evaluation—if AI generation is enabled.
- [ ] Approved notification provider, opt-in/suppression/quiet-hours correctness, event reconciliation, and incident response—if delivery is enabled.
- [ ] Approved payment/tax/refund/cancellation design, hosted/tokenized payment input, verified webhooks, reconciliation, support, and consumer-law review—if payment is enabled.
- [ ] Durable monitoring/audit, staffed on-call, support/grievance channel, incident notification process, SLO/error budget, capacity/cost plan, and independent penetration test.
- [ ] Production-shaped migration/cutover and forward-recovery plan with no unreviewed use of D1/R2/Queue/Gemini adapters.

Do not instruct operators to “enable D1,” “add R2,” “attach Cron,” or “set a Gemini key” as a shortcut. The production design is an open architecture decision.

## 8. Launch procedure for synthetic beta

1. Freeze unrelated changes and record candidate commit/config/policy versions.
2. Run build/tests/audit/secret scan/dry-run and save evidence.
3. Confirm old synthetic sessions are expected to be invalid after coordinator cutover.
4. Deploy the new compatible version; do not remove the coordinator migration.
5. Run clean-browser, API, owner-isolation, synchronous export, manual delete, stale-write, and alarm tests with synthetic accounts.
6. Record explicit go/no-go; open only the synthetic beta.
7. Watch errors/conflicts/bindings for the first hour and at +24 hours.

## 9. Automatic abort criteria

- any suspected cross-user content/export exposure;
- deleted/expired state can be recreated;
- alarm fires early, fails overdue, or renews unexpectedly;
- session/token/secret/content appears in client artifacts, logs, URLs, errors, or analytics;
- coordinator/routing binding missing or state falls back to KV authority;
- export/delete/auth is unavailable or materially misrepresented;
- ordinary chat makes an outbound model call or planner sends a notification;
- route-wide 5xx, blank/inaccessible critical journey, or unsafe crisis regression;
- no incident owner or no ability to deploy a compatible forward fix.

Abort means close/disable the affected synthetic capability and follow [runbooks.md](runbooks.md). It does not mean hiding the problem in UI or deploying a pre-coordinator Worker.

## 10. Post-release checkpoints

- [ ] +15 min: static/API routes, assets, headers, bindings, and no secret exposure.
- [ ] +1 h: bootstrap/session, deterministic chat, conflicts, rate limits, export/delete, and safety normal.
- [ ] +24 h: error/alarm scheduling evidence, tombstone behavior, browser QA, and user-copy truth reviewed.
- [ ] +7 d: synthetic state size, conflict rate, false-memory/safety findings, and incident/support load reviewed.
- [ ] Before day 30: verify alarm test evidence and remind testers to export before irreversible expiry.
- [ ] After a 30-day cohort: sample content-free evidence that due accounts tombstoned and no global Cron/provider was involved.

The release manager closes this checklist only for the synthetic-beta scope. No exception may waive truthful claims, user safety, security, privacy, or legal approval.
