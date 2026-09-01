# Luma

**An original adults-only AI companion built around presence, voice, memory, and shared moments.**

Luma is the product direction for this repository. It is a production-oriented, fully testable mock implementation of an avatar-led AI companion platform—not a copy of Replika or another product. Luma, the visual system, copy, prompts, and generated artwork are original prototype assets.

## Try the website

With the development server running, open:

- [Luma populated demo](http://127.0.0.1:3000/demo)
- [Luma app](http://127.0.0.1:3000/app?preview=home)
- [Public landing page](http://127.0.0.1:3000/)
- [Ten-step signup](http://127.0.0.1:3000/signup)
- [Operations console](http://127.0.0.1:3000/admin) — local key: `local-admin-key-change-me`

The deterministic mock runtime needs no external AI, voice, billing, or media credentials.

## What is built

| Area | Current implementation |
|---|---|
| Web | Responsive Next.js PWA with public pages, auth recovery, adult onboarding and first meeting, avatar-led home, streaming social chat, realtime voice/video simulations, Moments, album, dates, memory, media, activities, journal/events, wardrobe/room store, billing test mode, settings, privacy, export, deletion, and protected admin flows |
| Mobile | Expo/React Native client with functional home, chat, companion, memory, activity/reward, and profile surfaces |
| API | Fastify service with auth/OAuth-ready mocks, rate limiting, SSE chat, summaries, memory, journal/events/nudges, immutable wallet, store/inventory, subscriptions/webhooks, entitlements, voice/camera/media, telemetry/admin, export, and deletion routes |
| AI | Provider contracts and deterministic adapters, structured context, summary rollups, memory extraction/ranking/contradiction handling, quiet-hours nudges, safety routing, timeout/retry/fallback, and circuit breaker |
| Data | Comprehensive Prisma/PostgreSQL + pgvector schema, data-driven seeds, immutable ledger, and an authorization-aware in-memory repository for credential-free development |
| Shared platform | Strict TypeScript contracts, Zod validation, inherited plan entitlements, feature flags, design tokens, analytics redaction, PWA support, Docker packaging, CI, and Turborepo tasks |

The defining tested loop is:

```text
conversation → candidate memory → user-visible memory → relevant recall
```

Every acceptance flow is usable in deterministic mock mode. This is not yet a public production service: real identity, database/queue/storage adapters, AI/voice/media credentials, payment processing, notification delivery, legal approval, and independent safety/security review remain deployment gates rather than missing UX.

## Run locally

Prerequisites: Node.js 22+ and pnpm 11.

```bash
pnpm install
pnpm db:generate
pnpm dev:web
```

Optional API and local infrastructure:

```bash
docker compose up -d
pnpm dev:api
```

The default web origin is `http://127.0.0.1:3000`; the API defaults to `http://127.0.0.1:4000`.

## Validate

```bash
pnpm check
```

That command runs linting, strict type checks, automated tests, and the production build across the workspace.

## Repository map

```text
apps/web/           Next.js public site and companion experience
apps/mobile/        Expo/React Native companion shell
apps/api/           Fastify HTTP and SSE API
packages/ai/        Context, memory, provider, and safety systems
packages/db/        Prisma schema, repository contract, mock store, seeds
packages/shared/    Domain types and request schemas
packages/config/    Brand, environment, feature flags, plans
packages/ui/        Accessible primitives and visual tokens
packages/analytics/ Privacy-conscious event contracts
design/             Selected original visual and generated assets
docs/               Architecture and launch-boundary documentation
app/                Legacy Saathkind implementation retained for rollback only
```

## Product principles

1. Be explicit that the companion is AI and the product is for adults.
2. Remember fewer things correctly; make memories inspectable, editable, pinnable, and deletable.
3. Never use jealousy, guilt, streak pressure, exclusivity, or dependency-maximizing copy.
4. Keep private conversation content out of generic logs and analytics.
5. Treat billing and entitlements as server-authoritative in production.
6. Let chat continue when memory extraction or optional media systems fail.

## Documentation

- [Build plan](docs/BUILD_PLAN.md)
- [Architecture](docs/architecture.md)
- [AI system](docs/AI_SYSTEM.md)
- [Memory system](docs/MEMORY_SYSTEM.md)
- [Voice system](docs/VOICE_SYSTEM.md)
- [Safety](docs/SAFETY.md)
- [Database](docs/DATABASE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Privacy](docs/PRIVACY.md)
- [Analytics](docs/ANALYTICS.md)
- [Design QA](design-qa.md)
- [Companion-depth before/after audit](audit/luma-companion-depth-2026-09-01/AUDIT.md)

The remaining lowercase historical documents describe the retained Saathkind beta and are not the target Luma architecture.
