# Mira launch operations — 12 September 2026

This file describes the actual `apps/web` Cloudflare deployment. Older Saathkind, PostgreSQL/Fastify and mobile architecture documents are not evidence that those systems serve the public Mira site.

## Ownership and access

Project owner: Prakhar Gupta. On-call availability and a response commitment still require owner acceptance. No paid service or spending limit was enabled by this change.

- Website: https://luma-companion.prakhargupta267.workers.dev
- Operator inbox: `/admin`, protected by `MIRA_ADMIN_KEY`. The generated key is in macOS Keychain under service **Mira production operator**, account **prakhar**. Retrieve through Keychain Access; never paste it into issues, chats or URLs. The dashboard retains the key only in page memory; Lock clears it.
- Support tickets: private, paginated inbox with new/investigating/resolved states and email reply links. Sending replies still uses the operator's email client. Tickets retain their original 90-day expiry when updated.
- Reports include API errors/429s, daily average latency, optional product event counts. Never log message bodies, audio, reset tokens or API secrets.
- Threshold alerts: >5% failures/limits or >6s average AI endpoint latency, with at least 10 requests/day. These are beta investigation thresholds, not an uptime SLA or p95 monitor.

## Storage and migration

SQLite-backed `MiraStore` Durable Object replaces KV writes for accounts, sessions, state, support, rate limits, metrics, reset tokens and webhook receipts. `LUMA_ACCOUNTS` remains read-only legacy input except explicit deletion. D1 creation was refused because all ten free database slots in this account were already occupied; unrelated databases were left alone.

Records migrate on first read. Existing support and backup lists import their legacy records. Expired sessions/backups are not revived. Content-free tombstones prevent deleted or expired data from reappearing from KV. Account deletion fences concurrent autosaves atomically and queues deletion of legacy keys if a provider operation fails; an alarm retries. Older unimported session records become unusable immediately through the missing account and expire by their original TTL. Verify provider/platform backups separately.

This is **one beta coordinator**, not proof of unlimited scaling. Load-test before raising limits; partitioning or a dedicated database may be needed at larger scale. Application snapshots remain 30-day rolling snapshots in the same store, not an independent disaster-recovery copy. Export recovery and Cloudflare point-in-time recovery procedures require an operator drill.

## Provider capacity and failure handling

- Chat: Cloudflare Llama 3.3 70B directly, inference deadline up to 8s inside an 8.5s server budget; client deadline 12s. LLM7 was removed from the live route after its current terms were found to require written downstream-integration approval. This also removes an unnecessary rate-limited provider hop.
- Spoken inference consumes SSE and stops at two complete sentences; it does not wait for an unnecessary extra paragraph. A wrong-script/style draft can receive one same-provider repair only while time remains, counted against the daily cap. This is not a guarantee of sub-five-second speech round trips.
- Recognition: Inworld STT, deadline 4s; Cloudflare Whisper turbo fallback, deadline 2.5s. Browser recognition is a confidence-gated fallback. The client waits 1.6s before considering a confident browser result, rather than replacing multilingual STT after 420ms.
- Speech: Inworld Priya, one server attempt, 10s deadline. Client 12s deadline; no retry loop for quota/unavailable errors. No different voice is silently substituted.
- Circuit breakers cool for 30s after repeated failures; their scope is the Worker isolate, not global provider status.
- Shared beta caps default to 600 upstream requests/day for each of chat, STT and TTS, resetting at midnight UTC. Configure `CHAT_DAILY_LIMIT`, `TRANSCRIBE_DAILY_LIMIT`, `SPEECH_DAILY_LIMIT` only after checking provider allowance. These app caps do not reveal or increase provider credit balances.
- Per-IP limits use a hash of Cloudflare's client IP, not a spoofable user agent. Shared-network users share this allowance. Storage outages fail closed.

The free providers can fail independently of the site. Check Inworld dashboard balance, Cloudflare Workers AI usage and the operator dashboard. No paid fallback, provider quota API or contractual SLA is configured.

## Incident checklist

1. Check `/api/health` (app + database reachability; does NOT synthesize or transcribe audio).
2. Inspect `/admin`, Cloudflare logs, error counts, request IDs and provider dashboards. Do not copy private transcript data into logs/tickets.
3. Identify app regression versus upstream timeout/quota. Stop a release if sign-in, deletion or rate limiting fails.
4. For exhausted capacity, explain the outage; do not switch providers with different data-processing terms or purchase credits without approval.
5. Use the previous **SQLite-compatible** Worker version for rollback, then run the synthetic lifecycle and call smoke tests. Never roll back to the old KV-authoritative build: new account data and deletion tombstones would be bypassed.
6. Record times, scope, requests affected, remediation, evidence and follow-up owner. Contact affected users using approved channels; regulatory notification decisions require counsel.

## Release and rollback

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter @companion/web build`, and `pnpm --filter @companion/web build:vinext`. Cloudflare deploy target is `apps/web/dist/server/wrangler.json`, not the legacy `app/` directory. Deploy with `pnpm --filter @companion/web deploy:vinext`, then `pnpm --filter @companion/web smoke:production` and `node apps/web/scripts/conversation-eval.mjs`.

Mira CI/deploy/15-minute health workflow definitions are included. They require restored GitHub Actions execution and a scoped `CLOUDFLARE_API_TOKEN` plus `CLOUDFLARE_ACCOUNT_ID` in the protected production environment. No such GitHub secrets were present during inspection. `MIRA_ALERT_WEBHOOK` is optional; without it, use GitHub failure notifications and the operator dashboard. A workflow file is not proof that scheduling or alerts ran.

Record exact commit, Worker version, artifacts and smoke results for each deployment. Rehearse deployment of the same SQLite-compatible artifact before an actual rollback. Do not delete the Durable Object migration or downgrade database authority. For a custom domain, owner must select a domain they control, then set `SITE_ORIGIN`, build-time `NEXT_PUBLIC_SITE_URL`, Cloudflare custom-domain route, email DNS and billing return/webhook URLs; keep the old public URL functional until verified.

## Billing and email activation gates

Dodo SDK is explicitly in test mode by default. Checkout and portal require an authenticated account; product and quantity are server-selected. Signed webhooks alone write subscription state; replay IDs and event time are checked in the same storage transaction. Browser plan edits and success redirects cannot grant membership. Test signatures, duplicate/older events and password token expiry have local regression tests; an actual test-card lifecycle still requires a Mira-authorized merchant setup.

Set `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_WEBHOOK_KEY`, `DODO_PRODUCT_ID`, `BILLING_PRICE_LABEL`, `DODO_PAYMENTS_ENVIRONMENT`, `SITE_ORIGIN`, then `BILLING_ENABLED=true` only after choosing a price, confirming merchant approval for this product, testing success/decline/renewal/cancellation and publishing accurate commercial terms. The browser was signed into a separate **DrumToScore** business; this deployment did not use or mutate that business.

Email recovery needs `RESEND_API_KEY`, a verified `EMAIL_FROM` sender and `SITE_ORIGIN`. Tokens are random, hashed at rest, single-use, 15-minute TTL; changing a password invalidates older sessions. Without delivery configuration the UI reports unavailability instead of fake success. Do not claim mailbox delivery until a real message is received and its link exercised.

## Remaining external sign-offs

Real phones/laptops and speakers with Indian accents; long calls, weak microphones, noisy rooms, physical echo and interruption. Independent penetration test, counsel review, provider DPA/retention approval and stronger age assurance. Approved production domain and commercial price. Provider billing/credit alarms, an accepted on-call owner and external alert destination. YouTube upload Terms acceptance and final review of the demo before publication. These are not fulfilled by passing unit tests.
