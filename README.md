# Mira

An adults-only AI companion with chat, voice, animated avatar calls and memory you control.

[Live website](https://luma-companion.prakhargupta267.workers.dev/) · [Try the demo](https://luma-companion.prakhargupta267.workers.dev/demo) · [GitHub](https://github.com/prakhar267/mira)

Mira is an original AI companion, not a real person or a substitute for professional or emergency support. The public website is a free beta. English, Hindi and Hinglish conversation is supported, but speech recognition and generated replies can make mistakes.

## Current website

The hardening, incremental text streaming and protected-recovery v2 code is deployed at commit `f2d00cb4694d20f93b81c2c35e754dc8b7eeec60`. [PR #3's verified release evidence](https://github.com/prakhar267/mira/pull/3#issuecomment-5661724599) records successful main CI, exact-artifact promotion and live checks. Independent backup **activation**, real-device call acceptance, email/alert receipt and independent reviews remain separate gates; payments stay disabled. See the [current acceptance status](docs/READINESS-STATUS.md), not a dated audit, for the handoff.

The [continuation](docs/READINESS-CONTINUATION.md) records further loading improvements and source-loss denial evidence, without claiming the outstanding physical-device, independent-review or production gates are complete.

- **Conversation:** context-aware chat, with Cloudflare Llama 3.3 70B inference.
- **Voice and avatar calls:** shared call controls, automatic listening, Inworld speech recognition and the Priya voice. Cloudflare Whisper provides a transcription fallback. The video companion is an animated, open-licensed avatar; it is not a live human video feed.
- **Memory:** inspect, edit and delete saved memories; export or delete your data.
- **Accounts and storage:** authenticated account routes and SQLite-backed Cloudflare Durable Objects. Demo state is versioned and can be reset.
- **Operations:** health reporting, private support inbox, aggregate metrics, request limits and provider-capacity safeguards.

Voice and chat depend on external inference services and their available quotas. The website being online does not guarantee speech availability. Camera preview is local; camera-frame understanding is not available.

Billing and transactional recovery-email integrations exist in code but still require configuration and verification. Independent security/legal review, real-device call acceptance, commercial setup and other launch gates are tracked in the [launch operations guide](docs/LAUNCH-OPERATIONS.md). This repository does not claim those gates are complete.

## Run locally

Prerequisites: Node.js 24.18.0 (see `.node-version`) and pnpm 11.19.0.

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm --filter @companion/web dev:synthetic
```

Open [localhost:4397](http://127.0.0.1:4397). This runs the active Worker-shaped app against isolated SQLite storage and deterministic local providers, with no production credentials. Audio fixtures are control-flow tests, not real Priya playback. Do not put real conversations in this environment. The optional Next.js/Fastify path is separate; see [current architecture and configuration](docs/CURRENT-ARCHITECTURE.md).

## Validate and deploy

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @companion/web test:worker
pnpm --filter @companion/web exec playwright install chromium firefox webkit
pnpm --filter @companion/web test:browser
pnpm --filter @companion/web build:vinext
```

See [deployment instructions](docs/DEPLOYMENT.md) for the Cloudflare release workflow, required credentials and post-deployment checks. GitHub Actions execution also depends on the account's Actions access and configured production secrets.

## Repository map

```text
apps/web/           Active Mira website, Worker routes and Cloudflare storage
packages/           Shared contracts, UI, configuration and platform libraries
apps/api/           Optional Fastify backend; not the public Cloudflare API
apps/mobile/        Mobile shell; not a released native application
apps/worker/        Optional background-service workspace
design/             Product design and assets
docs/               Current guides and historical architecture references
audit/              Dated QA and deployment evidence
app/                Archived prototype; not a deploy or rollback target
```

The public deployment comes from `apps/web/`. Archived code and dated reports remain for provenance, not as instructions for the current product. Internal resource identifiers may retain earlier names to preserve URLs, sessions and stored data.

## Product principles

1. Always be clear that Mira is AI and intended for adults.
2. Keep memory visible, correctable and deletable.
3. Do not use guilt, jealousy, exclusivity or dependency pressure.
4. Keep private conversations out of generic logs and analytics.
5. Show failures honestly; do not promise perfect recall or unlimited availability.

## Documentation

- [Current deployment](docs/DEPLOYMENT.md)
- [Current architecture, configuration and capabilities](docs/CURRENT-ARCHITECTURE.md)
- [Current acceptance status and external inputs](docs/READINESS-STATUS.md)
- [September 13 implementation and verification ledger](docs/READINESS-IMPLEMENTATION.md)
- [Remaining-work follow-through and current gates](docs/READINESS-FOLLOWTHROUGH.md)
- [Encrypted backup operations and recovery limitations](docs/ENCRYPTED-BACKUP-OPERATIONS.md)
- [Protected recovery v2 and independent activation requirements](docs/PROTECTED-RECOVERY-V2.md)
- [Launch operations, providers and remaining gates](docs/LAUNCH-OPERATIONS.md)
- [Mira brand guide](docs/brand.md)
- [Security reporting](SECURITY.md)
- [Provider and security review](docs/PROVIDER-AND-SECURITY-REVIEW.md)
- [Latest recorded QA follow-up](audit/2026-09-12-followup/README.md)
