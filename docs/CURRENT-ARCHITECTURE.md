# Mira: active architecture and configuration

Updated 14 September 2026. This guide describes the active implementation. The [current acceptance status](READINESS-STATUS.md) distinguishes the verified deployed commit from later test/documentation changes. See [inference contract](INFERENCE-BOUNDARY.md), [storage/recovery](STORAGE-RECOVERY.md), and [protected recovery v2](PROTECTED-RECOVERY-V2.md).

## Serving path and trust boundaries

`apps/web` is the active React/vinext Cloudflare Worker. `/demo` stores optional browser history; `/app` uses an authenticated cloud account. Both call the same `/api/companion-*` routes. The optional `apps/api` Fastify/PostgreSQL stack, `apps/worker`, Expo shell and archived `app/` do not serve the public website.

- Server-issued HttpOnly demo/account cookies select the identity. Current, server-recorded AI consent and an 18+ **self-declaration** gate inference. Revoked account cookies never fall through to demo authority. Old accounts explicitly reconfirm the current disclosure.
- Cloudflare Workers AI handles Llama chat/reranking and Whisper fallback. Inworld handles primary STT and Priya TTS. No new voice, model, paid fallback or processor was introduced. Anonymous LLM7 is not used.
- `MiraStore`, addressed as `mira-production-v1`, remains one SQLite Durable Object. Accounts, hashed sessions, revisioned bounded state, paginated transcripts, policy evidence, content-free suppression, budgets, metrics, support and durable mail jobs live there. Legacy `LUMA_ACCOUNTS` KV is migration input/deletion cleanup, never the new write authority.
- A user-controlled camera is a local preview. The companion is a client-rendered animated avatar, not a human feed or camera understanding. Physical playback/lip-sync quality remains a separate acceptance gate.
- React account synchronization and conversation-turn adapters serialize/coalesce saves, expose conflicts and fence late results after cancellation. Service errors remain typed failures with an explicit retry; they are not saved as companion replies.

## Capability matrix

| Surface | Demo | Cloudflare account | Optional Fastify |
|---|---|---|---|
| Chat / STT / Priya / calls | Limited server demo session + consent | Server account/policy and reserved capacity | Separate adapter, not live evidence |
| Conversation persistence | Browser, optional | Revisioned server state + paginated transcripts, optional | Separate repository |
| Memory | Explicit browser records; server retrieval needs consent | Owner-scoped create/edit/forget; rechecks before returning context | Separate service |
| Journal / future events | Personal records | Personal records | Optional background services |
| Delivered reminders / generated reflections | Unavailable | Unavailable | Not deployed |
| Upload / generated images / vision | Unavailable; existing artwork labeled | Unavailable; no data-URL state injection | Optional providers, not enabled here |
| Personality / relationship / reply preferences | Supported subset affects prompt | Canonical saved preferences affect prompt | Separate implementation |
| Voice choice / mood sliders | Fixed Priya; unsupported controls removed/disabled | Same | Not relevant to active voice |
| Payments | Disabled | Disabled | Excluded from this work |

`GET /api/capabilities` is the authoritative configured-capability contract. Configured does not mean quota is available. Text chat negotiates genuine incremental NDJSON delivery, releasing checked complete-sentence prefixes while the upstream response is still in progress. A valid terminal `done` is required before saving the assistant reply; cancellation/error removes the transient draft. One-sentence replies may still wait until completion. Voice/video use complete JSON replies and Priya playback, not raw token streaming. See [streaming boundaries and runtime evidence](INFERENCE-BOUNDARY.md#incremental-text-delivery); this is not a measured production time-to-first-token claim.

## Isolated developer setup

Use Node **24.18.0** (`.node-version` / `.nvmrc`) and pnpm **11.19.0**:

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm --filter @companion/web dev:synthetic
```

Open `http://127.0.0.1:4397`. `tests/local/wrangler.jsonc` has distinct local bindings, a zero/dummy KV ID, synthetic-only provider service bindings, and no production keys. Environment-file loading is disabled by the script. Provider-fetch refuses test bindings on a public origin and refuses a synthetic marker without its mock binding. Do not add real credentials or conversations to this environment. Stop it with Ctrl-C; browser tests manage their own instance and require the port to be free.

The fixture voice payload tests the response-format boundary only. It is **not** a playable recording or evidence of Priya quality. Browser media fixtures explicitly mock microphone/Audio APIs to test cleanup and late callbacks. The browser suite builds the actual Cloudflare artifact and runs it with a server-enforced `MIRA_INFERENCE_DISABLED:true` override, a unique local database and an empty env file. `wrangler --local` by itself does not isolate Workers AI. Helpers use a non-credential in place of owner OAuth; unmocked companion requests are also blocked by browser fixtures. Account browser fixtures exercise UI state contracts with service workers blocked (they bypass HTTP interception); Worker integration covers real auth/cookie/SQL behavior. This avoids development-module compilation obscuring UI results.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @companion/web test:worker
pnpm --filter @companion/web exec playwright install chromium firefox webkit
pnpm --filter @companion/web test:browser
pnpm --filter @companion/web build:vinext
```

The active web unit, Worker and browser suites fail if no tests are found. The optional background workspace still has no test files; its historical `--passWithNoTests` is not active Worker coverage. Current Cloudflare Vitest plugin uses actual workerd/SQLite with deterministic provider bindings. Its reset workaround clears **only test storage**; never reuse that fixture reset against production.

## Active configuration

`.env.example` lists active Worker settings; `.env.fastify.example` documents the optional mock platform. Do not copy optional OpenAI/S3/database flags into the deployed web app. No secret belongs in `NEXT_PUBLIC_*`, a trace or GitHub issue.

| Setting | Purpose / activation boundary |
|---|---|
| `SITE_ORIGIN` | Canonical HTTPS origin and mail links; local fixture overrides only locally |
| `NEXT_PUBLIC_SITE_URL` | Public build-time canonical URLs, no secret |
| `AI`, `MIRA_STORE`, `MIRA_RECOVERY_TEST`, `LUMA_ACCOUNTS`, `ASSETS` | Bindings in existing `wrangler.jsonc`; names/migrations preserved |
| `INWORLD_API_KEY` | Server-only STT/Priya key; free provider quota is external |
| `CHAT_DAILY_LIMIT`, `TRANSCRIBE_DAILY_LIMIT`, `SPEECH_DAILY_LIMIT` | Default 600 attempts/service/day, further demo/account/unit/lease limits apply |
| `MIRA_BETA_ACCOUNT_LIMIT` | Default 250 known active accounts; finite admission cap, not a scaling claim |
| `MIRA_ADMIN_KEY` | Operator bearer secret; never in query parameters/localStorage |
| `MIRA_ALERT_WEBHOOK`, `MIRA_SUPPORT_OWNER` | Approved HTTPS delivery destination / owner metadata, not delivered-alert or staffed-support proof |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional recovery/verification sender; requires verified sender, HTTPS origin and authorized mailbox test |
| Protected-recovery v2 configuration | Independent suppression authority, separately retained encrypted archive, role-separated credentials and explicit enrollment; see [activation settings](PROTECTED-RECOVERY-V2.md#dormant-deployment-and-owner-controlled-activation). Not active merely because the code or a same-store snapshot exists |
| `BILLING_ENABLED=false` | Remains disabled; no payment implementation/activation work in this run |
| `DODO_PAYMENTS_ENVIRONMENT=test_mode` | Existing dormant integration. Merchant/product/pricing/webhook secrets remain excluded; do not configure to satisfy readiness |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Scoped release secrets only, absent from compiled client code |

## Recovery email and verification

Forgot-password accepts a bounded request and queues an idempotent job before account lookup. Unknown addresses follow the same public path. An alarm claims leased jobs, resolves the account, prepares a one-use hashed-token record and sends using a stable Resend idempotency key. It attempts at most three times before original 15-minute expiry; jobs and raw link/address data are removed on terminal completion, deletion or expiry. Short-lived content-free receipts prevent reuse of a completed idempotency key with a different link. A late retry cannot revive a consumed token.

The queue is capped at 500 jobs, processes up to five per alarm and retries at bounded intervals. This bounds work; it does **not** promise the entire backlog can be delivered before expiry. `/admin` exposes content-free pending/age/retry counts and provider-acceptance metrics. Missing configuration returns an honest unavailable state. Provider acceptance, mailbox receipt, password-reset completion and email verification are four different events. No real mail was sent in this implementation run.

Passwords retain compatible PBKDF2 hashing with algorithm/work-factor metadata. Missing-account login performs dummy hashing rather than a short-circuit. A reset invalidates older sessions. Sensitive export/deletion requires recent password reauthentication; ordinary conversation does not. This preserves existing passwords, rather than raising iterations past runtime compatibility without evidence.

## Release and remaining gates

See [deployment](DEPLOYMENT.md) for immutable artifact hashes, commit/version correlation and explicit promotion. Application deployment and post-release reachability are verified separately from human audio, independent backup activation, external sender/alerts, real provider performance, security/legal review and on-call ownership. [Current evidence and remaining inputs](READINESS-STATUS.md) record those distinctions. No uptime, universal safety, strong age verification, perfect recall or paid-GA claim is made.
