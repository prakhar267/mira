# Mira

**An original adults-only AI companion built around presence, voice, memory, and shared moments.**

Mira is the product direction for this repository. It is an original avatar-led AI companion platform—not a copy of Replika or another product. The public website currently runs as a free adults-only beta; the visual system, copy, prompts, and character artwork are original assets.

## Try the website

With the development server running, open:

- [Mira populated demo](http://127.0.0.1:3001/demo)
- [Mira app](http://127.0.0.1:3001/app?preview=home)
- [Public landing page](http://127.0.0.1:3001/)
- [Ten-step signup](http://127.0.0.1:3001/signup)
- [Operations console](http://127.0.0.1:3001/admin) — local key: `local-admin-key-change-me`

The deterministic demo needs no external credentials. Setting `NEXT_PUBLIC_API_MODE=live` connects the same web experience to the authenticated API, persistent data, media storage, and provider-backed AI/voice paths.

## What is built

| Area | Current implementation |
|---|---|
| Web | Responsive Next.js PWA with credential-backed signup/login/recovery, adult onboarding, API-connected streaming chat, provider TTS/STT, WebRTC realtime voice/video with graceful local fallback, explicit camera-frame analysis, media generation/storage, memories, activities, journal/events, store, settings, privacy, export, deletion, and live aggregate admin controls |
| Mobile | Expo/React Native companion shell with home, chat, companion, memory, activity/reward, camera, and profile surfaces; native release signing and store distribution remain outside this website deployment |
| API | Fastify service with scrypt passwords, signed short access tokens, rotating one-time refresh tokens, recovery/verification challenges, owner-scoped routes, Redis rate limits/jobs, SSE chat, input/output moderation, voice/camera/media, persistent calls and provider usage, export, deletion, readiness, and Prometheus metrics |
| AI | Current OpenAI Responses, Realtime, moderation, embedding, STT, TTS, vision, and image adapters plus deterministic offline adapters; structured context, summary rollups, memory extraction/ranking/contradiction handling, timeout and circuit-breaker utilities |
| Data | Prisma/PostgreSQL + pgvector repository, initial production migration, data-driven seeds, call/usage persistence, immutable wallet, S3-compatible media storage, Redis nudge queue, and an owner-scoped in-memory development repository |
| Shared platform | Strict TypeScript contracts, Zod validation, inherited plan entitlements, feature flags, design tokens, analytics redaction, PWA support, Docker packaging, CI, and Turborepo tasks |

The defining tested loop is:

```text
conversation → candidate memory → user-visible memory → relevant recall
```

Every acceptance flow is usable in deterministic mock mode. The Cloudflare deployment is suitable for a non-sensitive public beta and has live AI, speech, account storage, export, deletion, health reporting, logs, and traces. Paid plans, regulated or highly sensitive data, transactional notifications, and claims of independently audited production security remain outside the beta boundary.

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
pnpm db:migrate
pnpm db:seed
pnpm dev:api
pnpm --filter @companion/worker dev
```

The default web origin is `http://127.0.0.1:3001`; the API defaults to `http://127.0.0.1:4000`.

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
- [Human acceptance audit](docs/HUMAN_ACCEPTANCE_AUDIT_2026-09-01.md)

The remaining lowercase historical documents describe the retained Saathkind beta and are not the target Mira architecture. Some architecture filenames still use the former internal codename, Luma.
