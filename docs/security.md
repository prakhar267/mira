# Security and privacy design

Last reviewed: 18 August 2026  
Status: synthetic/demo controls only; not approved for private or production data

## 1. Security objective

Protect confidentiality and user agency even when code, a dependency, a user device, or an operator behaves unexpectedly. Collect less, scope access to the authenticated owner, keep content out of logs, fail closed around identity and consent, and fail safely around chat.

This document does not certify security. Real conversations require independent testing, staffed incident response, current legal review, and evidence for every launch gate.

## 2. Current deployment facts

- One SQLite-backed `UserStateCoordinator` Durable Object is authoritative for each synthetic account and demo session.
- Separate token-hash coordinator objects serialize bootstrap and deletion status on the account's fixed horizon; completed deletion retains only status, expiry, and an opaque receipt.
- Separate hashed IP/account/global coordinator objects hold short-lived fixed-window abuse counts. The daily bootstrap admission object deduplicates a bounded set of validated token hashes.
- `STATE` KV contains only opaque session and user-session routing pointers through account expiry; it is not content, registry, receipt, or rate-counter storage. No `RATE_LIMIT` KV binding is active.
- Export is returned synchronously as authenticated JSON and is not stored in Queue or R2.
- A per-account Durable Object alarm irreversibly tombstones cloud state 30 days after bootstrap. Manual deletion does so sooner and clears active KV routing. There is no global Cron or renewal-on-activity.
- Ordinary chat is a disclosed deterministic fallback; crisis handling is deterministic and separate.
- There is no active D1, R2, Cron, Gemini credential, notification transport, payment system, verified identity provider, or durable audit sink.
- The coordinator cutover intentionally invalidates pre-coordinator synthetic sessions; it does not migrate them.
- Recovery from a coordinator release defect is a compatible forward fix, not a downgrade to KV authority.

The deployment may accept synthetic, non-sensitive content only.

## 3. Current versus required controls

| Control | Current synthetic beta | Required before real conversations |
|---|---|---|
| Static delivery | Integrated asset Worker, CSP/HSTS/MIME/framing/referrer/permissions/COOP headers, packaging tests | Clean-browser/custom-domain evidence and monitored release procedure |
| Session handling | Opaque non-renewable demo token; SHA-256 token hash routes through KV; authoritative validation/revocation and fixed 30-day expiry live in the coordinator; secure cookie and logout | Verified identity, recovery, rotation/list/revocation, recent re-auth, CSRF/Fetch Metadata review |
| Owner isolation | Server derives tenant/user from the session and routes to one account coordinator | Independent BOLA/IDOR assessment across every record and operator path |
| Concurrent writes | Durable Object serialization and exact revision compare-and-swap | Production record-level transaction/conflict design backed by load tests |
| Expiry/deletion safety | Per-account alarm or earlier manual delete discards state and leaves a content-free tombstone, preventing stale resurrection | Approved category-specific lifecycle and end-to-end deletion across live stores, recovery history, processors, analytics, support, and devices |
| Export | Owner-scoped synchronous JSON response | Recent re-auth, complete field inventory, safe delivery, audit, lifecycle and size controls |
| Model boundary | No deployed model call; deterministic fallback and crisis path | Approved paid provider/terms, key restriction, data minimization, evaluation, budgets and kill switch if AI is enabled |
| Monitoring | Request IDs, safe error envelopes, Cloudflare platform observability | Durable allowlisted audit/metrics, alerts, anomaly detection, staffed on-call and evidence retention |
| Restore/recovery | No tested account-data restore objective | Approved backup architecture, isolated restore drill, deletion suppression, and forward-compatible releases |

## 4. Data classification

| Class | Examples | Handling requirement |
|---|---|---|
| Restricted | conversations, memories, identity, session secrets, safety reports, exports, payment data | Never log; least privilege; explicit purpose/retention; encryption and reviewed processor boundary |
| Confidential | consent history, internal user ID, moderation category, entitlement | Authenticated service access; redacted logs; approved retention |
| Internal | aggregate latency/cost, deployment metadata, feature configuration | Workforce-only; no broad content joins |
| Public | approved marketing, policies, static assets | Integrity/review; no credentials or private source maps |

Treat emotional, relationship, health, religion, sexuality, finance, and precise-location information as Restricted.

## 5. Threat model

Highest-risk current scenarios:

| Scenario | Prevention and response |
|---|---|
| Cross-user read/write/export/delete | Ignore client owner IDs; derive coordinator from the session; use unguessable IDs; run two-user tests; disable affected routes on any suspected mismatch |
| Lost update | Serialize in the coordinator; require exact revision; return `409` instead of overwriting; never auto-replay an unknown mutation |
| Deleted state recreated by stale request | Replace state with a permanent tombstone; reject initialize/read/write after deletion |
| Account document exhaustion | Enforce the 1.8 MB ceiling; present an honest export/delete path; do not silently truncate content |
| Session theft or CSRF | `HttpOnly`/`Secure` cookie, origin allowlist, short bounded token lifetime, logout; verified auth and stronger CSRF controls remain gates |
| Export leakage | Owner-scoped authentication, `no-store`, same-request JSON, no server-side URL/archive; never log the body |
| Prompt or HTML injection | Render generated/user text as text; no model tools; bounded context; strict CSP and output handling |
| Secret exposure | No active external-provider credential; ignored local secret files; build scan; revoke any exposed Cloudflare/admin credential immediately |
| Unsafe chat | Deterministic classifier and crisis response; no model dependency; professional multilingual evaluation still required |

The whole-document coordinator reduces lost updates and stale resurrection and provides coarse whole-account expiry after 30 days. It does not provide field encryption, relational integrity, category-specific retention, row-level operator controls, backup isolation, or a production audit trail.

## 6. Identity, session, and cutover requirements

Current demo sessions are not identity verification. The beta may not be described as a secure customer account.

1. Eligibility and synthetic-data disclosure occur before collection.
2. Session tokens are opaque, random, and non-renewable; the raw token must not be logged or stored as account content.
3. Owner identity comes from the validated session pointer, never a browser-supplied user ID.
4. Mutations are protected by the origin allowlist and cookie policy; private launch requires a separately reviewed CSRF/Fetch Metadata design.
5. Export and deletion require recent re-authentication before real data is allowed.
6. Staff/admin access requires a separate identity, phishing-resistant MFA, least privilege, time-bounded elevation, and immutable audit evidence.

The current coordinator rollout deliberately invalidates old synthetic sessions. Do not build or claim an automatic legacy-state migration. Testers start a fresh demo account after cutover.

## 7. API and replay safety

- Accept only documented methods and bounded payloads; private launch requires exhaustive content-type/schema tests.
- Render content as text, never raw HTML.
- Set user-data responses to `Cache-Control: no-store`.
- Never put content or bearer tokens in URLs, referrers, cache keys, analytics, or error messages.
- Apply rate controls without blocking export or deletion.
- There is no generic idempotency store or replay guarantee for mutations.
- Chat alone deduplicates by `clientMessageId` within the conversation. Other mutations must not be blindly retried after an unknown result.
- Future payment/provider webhooks or async jobs need their own reviewed event-identity and reconciliation semantics; current chat behavior is not reusable proof.

## 8. Durable Object security boundary

The coordinator stores one record containing `revision`, `deleted`, optional account state, hashed session metadata, and a fixed expiry.

- `initialize` is create-once, refuses a tombstoned identity, and schedules the per-account alarm for 30 days after bootstrap;
- session validation/revocation is authoritative in the coordinator while KV is routing only;
- reads of deleted state return `410`;
- writes require exact revision and return `409` when stale;
- delete or the expiry alarm discards account/session content and advances the tombstone revision;
- the size limit is enforced before storage;
- no route may fall back to KV content authority when the coordinator is required.

Health must be degraded if production-configured synthetic beta traffic lacks either the coordinator or routing KV.

The alarm does not renew with activity and is irreversible; users may export/delete before it fires. This is synthetic-beta hygiene, not an approved production retention policy. The class migration is forward-only. During an incident, disable affected routes and deploy a storage-compatible forward fix. A pre-coordinator Worker could misread routing or bypass tombstone guarantees and must not be used as rollback.

## 9. Browser and edge controls

Verify the deployed response set includes a restrictive CSP, HSTS after HTTPS coverage is proven, MIME sniffing protection, framing denial, strict referrer policy, a restrictive permissions policy, and `Cross-Origin-Opener-Policy: same-origin`.

Do not add wildcard origins, public content buckets, `'unsafe-inline'`, or camera/microphone permissions merely to silence an error. There are no uploads, voice, live audio, or video features in the current release.

## 10. Secrets and processors

The current beta needs only deployment/admin credentials appropriate to operating the Worker. No Gemini, notification, payment, email-auth, R2, or database credential should be added.

Adding a processor requires a separate change that documents:

- purpose and minimum fields sent;
- current service terms and data-processing agreement;
- region/location and subprocessor chain;
- retention and deletion behavior;
- key scope, rotation, budget, and kill switch;
- failure behavior, monitoring, incident contact, and user notice;
- multilingual safety/privacy evaluation where relevant.

If any credential appears in source, build output, a screenshot, chat, logs, or shell history, revoke/rotate it first. Removing text does not revoke access.

## 11. Logging, monitoring, and audit

Allowlisted logs may include timestamp, service/version, request ID, route template, status, duration, coarse dependency state, and content-free safety outcome.

Never log conversation, memory, export body, email, name, full IP, token, cookie, authorization header, or secret. `wrangler tail` is transient and may sample; it is not a durable audit system.

Before private launch, audit consent changes, memory edits/deletion, export, account deletion, staff access, entitlement changes, and secret/config changes using opaque identities and approved retention. Alerts must reach a real responder.

## 12. Product safety boundary

- Label Saathkind as AI; never claim consciousness, exclusive attachment, professional authority, or perfect memory.
- The service is adults-only and not medical care or emergency response.
- Crisis handling uses deterministic reviewed language and current local resources; verify resources before release.
- Never imply that emergency help or another person was contacted.
- The planner sends nothing. Any future contact feature requires separate consent, suppression, quiet-hours enforcement, provider testing, and an incident path.
- Users must be able to stop, pause memory, forget, export, and delete without guilt or bargaining.

## 13. Launch-blocking criteria

Real conversation collection remains blocked until all of the following have evidence:

1. verified identity, recovery, session security, consent, recent re-authentication, and owner authorization;
2. a reviewed production data architecture replaces the whole-document beta coordinator;
3. encryption/key rotation, backup/restore, retention, deletion, and export work end to end;
4. no Restricted data appears in logs, analytics, URLs, errors, or build artifacts;
5. any model/provider is paid, contractually approved, server-side, restricted, budgeted, and evaluated;
6. rate limits, abuse controls, circuit breakers, and support kill switches are active;
7. monitored SLOs and incident runbooks reach a real responder;
8. independent security review has no unresolved critical/high finding;
9. legal/privacy/terms/safety/commerce copy is approved and consistent;
10. a production-shaped synthetic canary and compatible forward-recovery drill pass.

See [go-live-checklist.md](go-live-checklist.md) for sign-off and [runbooks.md](runbooks.md) for response procedures.
