# Luma build plan

Last updated: 31 August 2026

## Direction

Luma replaces the earlier Companion/Noor presentation while retaining its tested platform foundation. The selected visual source is `design/luma-v1/home-source.png`—a moonlit, lavender, avatar-led mobile home with calling as the primary action.

## Architecture

```text
apps/web        Next.js PWA and desktop/mobile web experience
apps/mobile     Expo native experience
apps/api        Fastify HTTP, SSE, realtime-session, media, billing, and admin APIs
apps/worker     scheduled nudges and provider jobs (production target)
packages/ai     context, conversation, safety, memory, and provider adapters
packages/avatar renderer, expression, gesture, gaze, and lip-sync contracts
packages/voice  voice session and interruption contracts
packages/db     Prisma/PostgreSQL + pgvector schema and repositories
packages/shared shared domain and validation contracts
packages/ui     tokens and accessible primitives
packages/config brand, environment, features, and entitlements
```

## Delivery phases

1. Centralize Luma branding, tokens, typography, motion, five-item navigation, and design documentation.
2. Build the populated `/demo` first: Home, Chat, Voice Call, Video Call, Moments, Album, Companion, Wardrobe, and You.
3. Reshape onboarding into a visual first meeting with adult eligibility and explicit romance/flirt controls.
4. Add environment switching, virtual dates, call activities, companion tap reactions, generated selfie flow, and relationship progression.
5. Extend shared types, Prisma entities, provider contracts, and mock services for moments, calls, photos, memory graph, and avatar state.
6. Update Expo screens and preserve native permission, haptic, notification, and Reanimated integration points.
7. Validate the full 50-step acceptance journey in mock mode, then run lint, typecheck, tests, production build, interaction QA, and source-to-browser visual QA.

## Production gates

Mock completion is not public-production readiness. Launch still requires verified identity and age assurance; real Postgres/Redis/object storage; provider credentials; WebRTC signaling; payment processing; push/email delivery; multilingual safety evaluation; incident response; encryption/key rotation; audited deletion and backup restore; observability, cost controls, load testing, penetration review, legal approval, and native-store review.

## Quality bar

Home must render intentionally before heavy avatar assets finish. Every primary control works in mock mode. No page exposes provider or developer errors. Mobile is tested at 390 × 844, common Android sizes, a large iPhone, tablet, and desktop. Final handoff requires `design-qa.md` to say `final result: passed`.
