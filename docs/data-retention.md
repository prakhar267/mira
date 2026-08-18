# Data retention and deletion standard

Last reviewed: 18 August 2026  
Document status: proposed production standard; requires legal approval  
Implementation status: synthetic-beta controls only

## 1. Current release truth

The current deployment enforces one coarse synthetic-beta expiry, not a production retention schedule.

- One SQLite-backed `UserStateCoordinator` Durable Object stores the entire synthetic account document and authoritative demo-session record.
- Bootstrap fixes account/session expiry at 30 days and schedules that account's Durable Object alarm. Activity does not renew it. At expiry the alarm irreversibly discards state/session content and advances a content-free tombstone.
- Users may export or manually delete sooner. There is no global Cron and no category-specific automatic retention.
- Separate token-hash coordinator objects store a bootstrap fingerprint and stable opaque identity while active, then deletion status/expiry/opaque receipt after confirmed deletion. Their alarms follow the fixed account horizon.
- Separate hashed IP/account/global coordinator objects store short-lived fixed-window counts; alarms remove them after the window horizon.
- `STATE` KV stores only the token-hash session pointer and user-session pointer through the account's absolute expiry. It has no active registry or rate-counter role and is not authoritative conversation or memory storage.
- Export is generated from the authenticated account snapshot and returned synchronously as JSON. No Queue job, export request record, R2 object, signed URL, or server-side archive is created.
- Confirmed account deletion removes the document, leaves a content-free account tombstone, reduces the token coordinator to deletion status/expiry/receipt, and best-effort clears the two active KV routing pointers.
- There is no deletion grace/cancellation window, global Cron sweep, verified backup erasure, processor receipt, legal-hold system, or restore drill.
- No D1, R2, Gemini, notification, payment, or verified identity provider processes current beta account content.
- Browser-local demo state is a separate copy controlled by the device/client and is cleared by the product after successful connected deletion. Browser backups or manually copied exports are outside server deletion proof.

Use synthetic, non-sensitive content only. The beta deletion path must not be described as compliant erasure.

## 2. Current data map

| Data | Current location | Current lifecycle | Delete behavior |
|---|---|---|---|
| Profile, consent history, conversations, messages, memories, planner records, goals, usage | Per-account SQLite-backed Durable Object document | Irreversible whole-account expiry 30 days after bootstrap; bounded by 1.8 MB; user can edit/delete sooner | Item controls mutate the document; manual delete or alarm removes it and leaves a content-free tombstone |
| Authoritative demo session | Same Durable Object record | Non-renewable; expires with the account 30 days after bootstrap | Logout revokes; delete/alarm removes session content with account state |
| Session routing | `STATE` KV keyed by token hash | Matching 30-day TTL; logout/deletion clears the active mapping | Explicit KV delete where applicable, otherwise natural expiry |
| User-session pointer | `STATE` KV | Session TTL | Cleared on account deletion |
| Bootstrap/deletion coordination | Token-hash SQLite Durable Object | Request fingerprint and opaque account/session identity through the fixed account horizon; after deletion only status, expiry, and opaque receipt remain | Manual deletion removes fingerprint/identity; alarm deletes token metadata at expiry |
| Coarse rate counters | Hashed IP/account/global SQLite Durable Objects | Expiring fixed windows; up to two window lengths | Alarm deletes the counter record; no content body |
| Export | Authenticated response/browser download | Exists in memory during the request and wherever the user/browser saves it | No server archive to purge; client/user controls downloaded copies |
| Account coordinator tombstone | Durable Object storage | Indefinite in current beta | Content-free deletion guard; no automated purge |
| Reset revocation marker | Browser local storage | Timestamp only, until cookie/session revocation is confirmed | Removed after confirmed logout; contains no profile or conversation content |
| Browser profile/interface history | Browser local storage | Until browser/product clearing | Client clears connected demo state after deletion; device backups are not controlled by the Worker |

The coordinator tombstone exists to prevent a stale in-flight request from recreating manually deleted or automatically expired beta state. It is not a legal-retention ledger, subprocessor receipt, or proof that platform recovery history contains no older bytes.

## 3. Current user actions

### Forget one memory

The authenticated owner removes the memory from the serving account document. Retrieval stops after the accepted compare-and-swap write. No embedding is created in the active release. Any dormant/best-effort vector cleanup code is not proof of an external-index lifecycle.

### Pause memory or withdraw consent

The accepted coordinator write updates consent/profile state and stops current beta retrieval or creation. There is no background extraction queue to cancel in the active release.

### Export account data

`POST /api/v1/data/export` returns `status: "ready"` and the JSON snapshot in the same authenticated response. It does not enqueue work, persist a request, create an R2 object, or provide a later download URL.

### Automatic synthetic-beta expiry

Exactly 30 days after bootstrap, the account's Durable Object alarm irreversibly tombstones the cloud account and authoritative session. Activity does not extend the date. The matching KV route expires on the same horizon. This is per-account alarm behavior, not global Cron, and it is intentionally much coarser than a production retention schedule. Users should export anything they want before expiry.

### Delete the synthetic account

1. Require an active demo session and confirmation exactly equal to `DELETE`.
2. Replace the coordinator's account document with a content-free tombstone at a higher revision.
3. Reduce the token coordinator to deletion status/expiry/opaque receipt and best-effort clear the active session and user-session routing pointers from KV.
4. Expire the browser cookie and clear browser demo state in the client.
5. Return completion immediately.

There is no cancellation, 24-hour wait, Queue job, global Cron dependency, or processor-wide completion receipt. The operation prevents stale coordinator writes from resurrecting the account, but it does not evidence erasure from Cloudflare recovery media, request logs, browser backups, screenshots, or user-saved exports.

## 4. Coordinator lifecycle limitations

Whole-document compare-and-swap plus tombstoning is a synthetic-beta mitigation, not a production retention architecture:

- no record-level expiry or retention index exists; only fixed whole-account expiry after 30 days;
- unrelated record updates contend on one revision;
- no transactional outbox or reconciliation ledger exists;
- no category-specific purge, backup inventory, legal hold, or restore suppression exists;
- the permanent tombstone has no approved retention or purge policy;
- no processor graph exists because external AI, notification, payment, and export providers are disabled.

The coordinator rollout intentionally invalidates pre-coordinator synthetic sessions. There is no migration promise for older demo state. Do not retain or copy old state merely to make the cutover appear seamless.

## 5. Production principles

Before real data, legal/product/security must approve these principles and the implementation must enforce them:

1. Collect only data needed for a named user-facing purpose.
2. Separate raw conversation, approved memory, identity, safety evidence, telemetry, billing, and export lifecycles.
3. Withdrawal, forget, and delete stop serving-path use immediately.
4. Every live store, cache, backup, analytics sink, support tool, and enabled processor is in deletion scope.
5. Retention periods come from a versioned policy and cannot be changed only in UI copy.
6. Use de-identified aggregates that cannot be rejoined to a person; do not extend raw retention for analytics convenience.
7. Do not send personal or intimate data to any model/provider without approved paid terms, data-processing obligations, minimization, and deletion behavior.

## 6. Proposed production schedule

This is a planning proposal, not deployed behavior or legal advice. Final values require counsel and provider-contract review.

| Category | Proposed active-account default | Proposed deletion target |
|---|---:|---:|
| Eligibility/policy evidence | Account life, minimized | Disable immediately; purge or retain only legally approved evidence within 30 days |
| Identity and active sessions | Account life; sessions bounded | Revoke immediately; purge according to approved security/legal schedule |
| Raw messages | 90-day rolling maximum unless user chooses shorter | Unavailable immediately; live-store purge within 24 hours where possible, hard deadline 7 days |
| User-approved memories | Until forgotten/account closed | Unavailable immediately; live-store purge within 24 hours, hard deadline 7 days |
| Unapproved candidates | 30 days maximum | Purge within 24 hours |
| Planner/open-loop records | Until completed/dismissed or 90 days | Cancel immediately; purge within 24 hours |
| Consent evidence | Account life | Minimized legal evidence only if counsel approves; otherwise purge within 30 days |
| Security/audit metadata | 30 days unless incident/legal basis requires narrower extension | Pseudonymize or age out under approved schedule |
| Safety reports | 180 days maximum, restricted | Purge within 30 days unless a documented active case/lawful hold applies |
| Analytics | 90 days identifiable maximum | Delete/pseudonymize within 30 days |
| Export delivery artifact, if a future design stores one | At most 24 hours or first successful download | Delete immediately |
| Notification metadata, if enabled | 90 days maximum | Purge within 30 days; retain only approved suppression evidence |
| Billing records, if enabled | Legally required minimum | Restrict and retain only required fields/period; never store payment instruments |
| Recovery history/backups | Defined by approved RPO/RTO and legal schedule | Keep deleted accounts inaccessible; expire/crypto-erase within the approved window |

## 7. Production deletion and export requirements

Production account deletion must require recent re-authentication, revoke access immediately, suppress all future processing/contact, remove live account content across every enabled system, obtain content-free processor receipts, keep deletion suppression effective during restore, and alert on missed deadlines.

Production export must require recent re-authentication, be complete and owner-scoped, exclude secrets/internal policy/other users, use a delivery mechanism appropriate to size and sensitivity, expire any server artifact quickly, and audit request/access/deletion without logging content or a reusable URL.

The production architecture is not predetermined by the inactive D1/R2/Queue code in this repository. Select it through a reviewed architecture decision and test it on production-shaped synthetic data.

## 8. Backup, restore, and release recovery

- Test recovery in isolation with synthetic data before real launch.
- A restore can resurrect content deleted after the restore point; deletion/withdrawal suppression must be replayed before serving traffic.
- Record restoration authority, exact target, evidence, and approval.
- The current Durable Object class migration is forward-only. A release defect is repaired with a compatible forward fix; do not restore a pre-coordinator Worker or use KV as content authority.
- Before real data, demonstrate the approved recovery-point objective, recovery-time objective, deletion behavior, and tombstone retention/purge policy.

## 9. Verification before real data

- clock-controlled tests for every approved retention boundary;
- deletion tests for every selected store, cache, backup, provider, analytics, auth, support, and device-facing copy;
- two-user export/deletion isolation tests;
- duplicate/delayed provider-event reconciliation tests where asynchronous systems exist;
- isolated restore proving deleted-user suppression;
- dashboards for overdue data and failed processor deletion;
- privacy/support status tools that do not reveal content;
- a counsel-approved privacy notice matching actual storage, providers, schedules, and exceptions.

The accountable privacy owner signs the final matrix and every exception.
