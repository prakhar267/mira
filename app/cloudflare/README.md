# Saathkind API Worker

This directory contains the integrated Cloudflare Module Worker for the synthetic Saathkind beta. It serves the React assets and the same-origin `/api/v1` API. The static Sites worker in `../worker/index.js` remains an alternate packaging artifact only.

## Release boundary

The active release is for synthetic, non-sensitive testing only.

- `USER_STATE` maps each tenant/user pair to one SQLite-backed `UserStateCoordinator` Durable Object. That object is the authoritative demo account and session store.
- The coordinator stores one bounded account document plus the authoritative demo-session record, uses a monotonically increasing revision for compare-and-swap writes, and retains a content-free tombstone after deletion.
- Initialization schedules a per-account Durable Object alarm for the session expiry exactly 30 days after bootstrap. The session is non-renewable; the alarm irreversibly tombstones the cloud account. This is not a global Cron or a production retention policy.
- Separate token-hash coordinator objects serialize bootstrap ownership, routing recovery, and deletion status on the account's fixed horizon. A completed deletion record contains only status, expiry, and an opaque receipt.
- Separate hashed IP/account/global coordinator objects store fixed-window request counts and delete them by alarm. The global validated-bootstrap ceiling is 400 accounts per day to preserve Free-plan KV routing headroom; this is not an entitlement or billing meter.
- `STATE` KV stores only the opaque token-hash session pointer and user-session pointer through the account's fixed expiry. It is not authoritative for content, bootstrap claims, deletion receipts, or rate counts. There is no `RATE_LIMIT` KV binding and new accounts do not write a registry.
- Export is assembled from the authenticated account snapshot and returned synchronously as JSON. It is not persisted as an export request, sent through Queue, or written to R2.
- Users may export or delete sooner. Manual deletion moves the token coordinator through deleting/deleted status, writes the account tombstone, and best-effort clears the two active KV routing pointers. Automatic expiry and manual deletion are irreversible; there is no grace period, cancellation window, processor-wide sweep or backup-erasure proof.
- Ordinary chat uses the disclosed deterministic fallback. The deterministic crisis path is independent of a model. No Gemini credential is configured.
- Follow-ups are planner records only. No Cron trigger or notification provider sends them.
- No D1 database, R2 bucket, payment provider, paid entitlement system or verified identity provider is active.

Bindings and inactive adapter code for future experiments are not release capabilities. Do not describe Queue, Vectorize, D1, R2 or Gemini as part of the current user flow merely because a type, binding or dormant handler exists.

## Coordinator semantics

`user-state.ts` implements a deliberately narrow beta coordinator:

1. `POST /initialize` creates the account document and authoritative session once, fixes expiry at 30 days after bootstrap, and schedules the account alarm.
2. `GET /state` returns the document and current revision.
3. `PUT /state` requires the exact prior revision through `If-Match`; a stale writer receives `409 state_conflict`.
4. Session validation/revocation is checked in the same coordinator; KV only routes the token hash to it.
5. `DELETE /state` removes the document and writes a permanent tombstone; later reads or writes cannot recreate it.
6. `alarm()` performs the same irreversible tombstoning when the fixed 30-day expiry arrives.
7. Documents larger than 1.8 MB are rejected.
8. The same class also backs isolated token-claim and rate-key objects; those records do not share the account document and use their own fixed alarms.

This whole-document design prevents lost updates and stale-write resurrection for a small synthetic beta. Its one automatic lifecycle is coarse whole-account expiry after 30 days. It is not a production semantic architecture: there are no normalized per-record transactions, category-specific retention indexes, point-in-time recovery proof or supported multi-object workflow.

The coordinator rollout intentionally invalidates pre-coordinator synthetic sessions. There is no user-data migration promise. Ask synthetic testers to start a new demo account after the cutover.

The Durable Object class migration is a forward-only deployment boundary. If a release fails, contain the affected routes and deploy a compatible forward fix. Do not deploy a pre-coordinator Worker, remove the class binding, or make KV authoritative as a rollback technique.

## API contract

Responses use `{ "ok": true, "data": ... }` or `{ "ok": false, "error": ... }`. Authentication accepts the `HttpOnly` `saathkind_session` cookie or `Authorization: Bearer <token>`.

There is no generic mutation-idempotency contract. Chat duplicate protection uses the caller's `clientMessageId` within a conversation. Reusing that ID returns the already-created assistant response instead of creating a second message. Other POST/PATCH/DELETE routes must not be assumed replay-safe.

Public routes:

- `GET /api/v1/health`
- `GET /api/v1/pricing`
- `POST /api/v1/auth/demo` (alias: `POST /api/v1/session/bootstrap`)
- `GET /api/v1/admin/health` with the separately configured admin bearer secret

Authenticated routes:

- `GET|DELETE /api/v1/session`, `POST /api/v1/auth/logout`
- `GET|PATCH /api/v1/profile`, `/api/v1/consents`, `/api/v1/quiet-hours`
- `GET|POST /api/v1/conversations`
- `GET|POST /api/v1/conversations/:id/messages` (or `POST /api/v1/chat`)
- `GET|POST /api/v1/memories`, `PATCH|DELETE /api/v1/memories/:id`, `POST /api/v1/memories/:id/pin`
- `GET|POST /api/v1/followups`, `PATCH|DELETE /api/v1/followups/:id`
- `GET|POST /api/v1/goals`, `PATCH|DELETE /api/v1/goals/:id`
- `GET /api/v1/usage`
- `POST /api/v1/data/export` — returns `status: "ready"` and the JSON snapshot in the same response
- `POST /api/v1/data/delete` — requires `confirmation: "DELETE"` and immediately tombstones beta account state
- `POST /api/v1/data/delete/cancel` — compatibility route only; immediate deletion creates nothing cancellable

The shorter `/api/*` prefix is accepted as a compatibility alias.

## Local verification

From `app/`:

```sh
npm run build
npm test
npx wrangler deploy --dry-run --config wrangler.jsonc
```

Do not enable the inactive D1, R2, Gemini, Cron, payment or notification paths as an operational shortcut. A real-data architecture requires a new reviewed decision, migration/cutover plan, privacy notice, threat model, restore/deletion design and release approval.
