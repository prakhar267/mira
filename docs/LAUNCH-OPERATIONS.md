# Mira launch operations — updated 14 September 2026

This file describes operations for the active `apps/web` source. The [current acceptance status](READINESS-STATUS.md) records the verified September 14 deployment and remaining external gates. Use [current architecture/configuration](CURRENT-ARCHITECTURE.md), [inference policy](INFERENCE-BOUNDARY.md), [storage/recovery](STORAGE-RECOVERY.md) and [verified release procedure](DEPLOYMENT.md) as the current implementation contract. Historical platform refusals and marker-only remote drills below were recorded September 12; they were not rerun as production-data recovery.

## Ownership and access

Project owner: Prakhar Gupta. On-call availability and a response commitment still require owner acceptance. No paid service or spending limit was enabled by this change.

- Website: https://luma-companion.prakhargupta267.workers.dev
- Operator inbox: `/admin`, protected by `MIRA_ADMIN_KEY`. The generated key is in macOS Keychain under service **Mira production operator**, account **prakhar**. Retrieve through Keychain Access; never paste it into issues, chats or URLs. The dashboard retains the key only in page memory; Lock clears it.
- Support tickets: private, paginated inbox with new/investigating/resolved states and email reply links. Sending replies still uses the operator's email client. Tickets retain their original 90-day expiry when updated.
- Reports include API errors/429s, daily averages, recent 15-minute latency histograms, launch configuration gaps and optional product/call timing counts. Never log message bodies, audio, reset tokens or API secrets.
- Threshold alerts: >5% failures/limits with at least 10 requests in 15 minutes; approximate P95 upper bound >5s with at least 20 AI/round-trip observations; 80% of the app's daily inference cap. Histogram buckets are 1/2.5/5/8/15/120 seconds, not exact percentiles or an uptime SLA.
- Periodic monitoring reuses the store's existing Durable Object alarm, every 15 minutes. A new cron was refused because all five account-wide free cron slots were occupied. No other project's schedule or paid plan was changed. This same-platform check cannot detect every platform/object outage; independent external monitoring remains needed.
- `MIRA_ALERT_WEBHOOK` sends content-free incident and recovery notifications to an approved HTTPS destination. Failed delivery retries; unchanged delivered incidents are deduplicated. Without a configured destination, dashboard status explicitly says `not-configured`. `MIRA_SUPPORT_OWNER` records configuration only, not acceptance of on-call duty.

## Storage and migration

SQLite-backed `MiraStore` Durable Object replaces KV writes for accounts, sessions, state, support, rate limits, metrics, reset tokens and webhook receipts. `LUMA_ACCOUNTS` remains read-only legacy input except explicit deletion. D1 creation was refused because all ten free database slots in this account were already occupied; unrelated databases were left alone.

Records validate and migrate on first read. Support/backup lists schedule bounded background import pages; legacy network I/O is outside the synchronous transaction. Revisioned account state and snapshots commit atomically; transcripts have a separate bounded paginated table. Current policy confirmation and recent reauthentication for export/deletion are required. Expired sessions/backups are not revived. Content-free tombstones prevent deleted or expired data from reappearing from KV. Account deletion fences concurrent autosaves atomically and queues deletion of legacy keys if a provider operation fails; an alarm retries. Older unimported session records become unusable immediately through the missing account and expire by their original TTL. Verify provider/platform backups separately.

This is **one beta coordinator**, not proof of unlimited scaling. Load-test before raising limits; partitioning or a dedicated database may be needed at larger scale. Application snapshots remain 30-day rolling snapshots in the same store, not an independent disaster-recovery copy. A separate `MiraRecoveryDrill` binding now proves remote Cloudflare point-in-time restore with synthetic markers only. This does not restore production user records or prove cross-provider/account recovery.

## Provider capacity and failure handling

- Chat: Cloudflare Llama 3.3 70B directly, inference deadline up to 8s inside an 8.5s server budget; client deadline 12s. LLM7 was removed from the live route after its current terms were found to require written downstream-integration approval. This also removes an unnecessary rate-limited provider hop.
- Spoken inference consumes SSE and stops at two complete sentences or `[DONE]`; a hanging transport cancellation cannot delay the completed reply. A wrong-script/style draft can receive one same-provider repair only while time remains, counted against the daily cap. This is not a guarantee of sub-five-second speech round trips.
- Reply validation checks Mira's own first-person grammar, not every person's gender against every word in the user's message. The prior global check could reject valid mixed-person exchanges (e.g. a sister and brother) or masculine past-event nouns. Contextual entity agreement still requires conversation evaluation; it is not proven by a regex.
- Recognition: Inworld STT, deadline 4s; Cloudflare Whisper turbo fallback, deadline 2.5s. Every browser fallback path requires confidence >=0.88 and a complete four-word phrase. The client waits 1.6s before considering that result. Ambiguous short phrases no longer bypass this check when a service fails.
- Both call modes use one fenced call controller. Closing/muting invalidates pending recognition; late replies cannot restart audio. Mic permission and TTS preparation are visible states. STT/permission errors require explicit Retry; failed reply text is retained. An optional **headphone-only talk-over beta**, off by default, retains the same microphone recording when speech interrupts playback. Speakerphone-safe automatic barge-in has not been certified.
- Speech: Inworld Priya, one server attempt, 10s deadline. Client 12s deadline; no retry loop for quota/unavailable errors. No different voice is silently substituted.
- Circuit breakers cool for 30s after repeated failures; their scope is the Worker isolate, not global provider status.
- Shared caps default to 600 attempts/service/day, including reranking; demo aggregate share is at most 40% so demos cannot consume account-reserved headroom. Per-principal attempts, estimated units and concurrent leases also apply. Daily failures retain their charge and report the real UTC reset. Admission defaults to 250 known active accounts. See [exact limits](INFERENCE-BOUNDARY.md). None of these caps measures upstream credits or proves storage capacity.
- Per-IP limits use a hash of Cloudflare's client IP, not a spoofable user agent. Shared-network users share this allowance. Storage outages fail closed.

The free providers can fail independently of the site. Check Inworld dashboard balance, Cloudflare Workers AI usage and the operator dashboard. No paid fallback, provider quota API or contractual SLA is configured.

## Incident checklist

1. Check `/api/health` (app + database reachability; does NOT synthesize or transcribe audio).
2. Inspect `/admin`, Cloudflare logs, error counts, request IDs and provider dashboards. Do not copy private transcript data into logs/tickets.
3. Identify app regression versus upstream timeout/quota. Stop a release if sign-in, deletion or rate limiting fails.
4. For exhausted capacity, explain the outage; do not switch providers with different data-processing terms or purchase credits without approval.
5. Prefer a forward fix. A previous Worker is rollback-compatible only if it preserves the new schema, transcript, consent, token and suppression semantics; SQLite support alone is not sufficient. Verify it in isolation first. Never roll back to the old KV-authoritative build: new account data and deletion tombstones would be bypassed.
6. Record times, scope, requests affected, remediation, evidence and follow-up owner. Contact affected users using approved channels; regulatory notification decisions require counsel.

## Release and rollback

Follow [deployment and promotion](DEPLOYMENT.md): mandatory unit/Worker/browser checks, the vinext build, isolated execution of built bytes, sealed hashes, explicit authorized promotion and exact deployed SHA/version checks. Post-deploy smoke is read-only; it does not create accounts or consume provider inference. The [current conversation evaluator](DEPLOYMENT.md#explicitly-authorized-conversation-evaluation) requires explicit target, consent and finite request-budget settings and is not part of automatic production smoke. Other historical provider scripts remain unsuitable for blind production execution.

The public repository's Mira CI and availability monitor are now executing. [Main CI 34825950777](https://github.com/prakhar267/mira/actions/runs/34825950777) and [post-deployment monitor 34826987758](https://github.com/prakhar267/mira/actions/runs/34826987758) passed for the deployed application commit. The latest monitor was manually dispatched; an earlier scheduled run also passed, but a dependable 15-minute cadence and actual external alert receipt are not established. The September 13 private-repository billing block is historical, not a current CI execution blocker.

GitHub-driven production promotion still needs scoped `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` configuration. No GitHub secrets were present at the September 14 recheck, including no alert destination. The verified release used the existing owner Cloudflare login to deploy the exact successful main-CI artifact without rebuilding or exporting OAuth credentials. CI checks the parser patch, seals the actual Worker artifact, and verifies its upload round trip. Workflow success does not prove email/alert delivery or repair private-account billing.

Record exact commit, Worker version, artifacts and smoke results for each deployment. Rehearse deployment of the same SQLite-compatible artifact before an actual rollback. Do not delete the Durable Object migration or downgrade database authority. For a custom domain, owner must select a domain they control, then set `SITE_ORIGIN`, build-time `NEXT_PUBLIC_SITE_URL`, Cloudflare custom-domain route, email DNS and billing return/webhook URLs; keep the old public URL functional until verified.

Run `node apps/web/scripts/operations-smoke.mjs` for the operator-authenticated **synthetic-only** PITR drill. On macOS it reads the existing Keychain credential into memory, never prints it, and records no tickets or user data. On another host use a securely supplied `MIRA_ADMIN_KEY`. The three steps prepare a marker/bookmark, request restore on the separate object, then verify the earlier marker; main account health is checked before and after. Never substitute the production `MIRA_STORE` namespace. A real account disaster requires a deletion/retention reconciliation plan and explicit incident authority.

## Billing and email activation gates

Dodo SDK is explicitly in test mode by default. Checkout and portal require an authenticated account; product and quantity are server-selected. Signed webhooks alone write subscription state; replay IDs and event time are checked in the same storage transaction. Browser plan edits and success redirects cannot grant membership. A cancellation at period end retains access until the verified renewal timestamp, while immediate cancellation/expiry revokes it. Test signatures, duplicate/older events, entitlement dates and password token expiry have local regression tests; an actual test-card lifecycle still requires a Mira-authorized merchant setup.

Set `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_WEBHOOK_KEY`, `DODO_PRODUCT_ID`, `BILLING_PRICE_LABEL`, `DODO_PAYMENTS_ENVIRONMENT`, `SITE_ORIGIN`, then `BILLING_ENABLED=true` only after choosing a price, confirming merchant approval for this product, testing success/decline/renewal/cancellation and publishing accurate commercial terms. The browser was signed into a separate **DrumToScore** business; this deployment did not use or mutate that business.

Email recovery needs `RESEND_API_KEY`, a verified `EMAIL_FROM` sender and `SITE_ORIGIN`. Recovery and verification tokens are random, hashed in lookup records, single-use and expire after 15 minutes. A reset invalidates older sessions and reset requests. A SQLite outbox now persists pending address/link data for at most 15 minutes and uses leases, original-expiry dedupe receipts, stable provider idempotency keys and at most three attempts. Configured requests return a uniform queued response before account lookup. Terminal jobs are erased. `/admin` shows queue backlog/age and provider-acceptance metrics; this is not mailbox receipt. No real sender or recipient was activated in this run. Without delivery configuration the UI reports unavailability instead of fake success. Do not claim mailbox delivery until a real message is received and its link exercised.

## Remaining external sign-offs

Real phones/laptops and speakers with Indian accents; long calls, weak microphones, noisy rooms, physical echo and interruption. Independent penetration test, counsel review, provider DPA/retention approval and stronger age assurance. Approved production domain and commercial price. Provider billing/credit alarms, an accepted on-call owner and external alert destination. Promotional upload approval is separate from technical release readiness. These gates are not fulfilled by passing unit tests.
