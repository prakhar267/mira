# Companion architecture

> Historical optional Fastify/prototype design. Not the active Cloudflare runtime. Use [CURRENT-ARCHITECTURE.md](CURRENT-ARCHITECTURE.md) and [STORAGE-RECOVERY.md](STORAGE-RECOVERY.md) for current code and limitations. Statements below are retained for provenance, not deployment instructions.

## Runtime shape

The workspace is organized as a pnpm/Turborepo monorepo. `apps/web` is the responsive Next.js product, `apps/mobile` is the Expo client shell, and `apps/api` is a Fastify service. Domain contracts live in `packages/shared`; configuration, AI behavior, persistence, UI tokens, and analytics are isolated packages.

```text
web / mobile
    ↓ typed HTTP + SSE contracts
Fastify API
    ├─ context and safety pipeline
    ├─ repository contract
    ├─ voice/media/billing adapters
    └─ privacy-conscious analytics
```

The current browser demo deliberately runs the same deterministic context and memory code client-side so the whole vertical slice works without credentials. The API exposes the server-shaped path for integration tests and later production wiring.

## Boundaries

- UI components do not contain model IDs or provider secrets.
- Provider contracts isolate chat, embeddings, speech, realtime, media, and billing vendors.
- The repository contract isolates mock state from the future Prisma/PostgreSQL adapter.
- Shared Zod schemas validate requests at boundaries.
- Entitlements and feature flags are centralized in configuration.
- Raw conversation content is redacted from generic logs and analytics.

## Mock-complete versus production-connected

The local product implements the complete UX and API surface for identity, chat, memory, summaries, realtime media states, billing reconciliation, notifications, admin telemetry, export, and deletion. Provider-independent tests cover the main contracts. Public production still requires the concrete identity provider, PostgreSQL/Redis/S3 repository adapters, AI/speech/media credentials, payment processor, notification delivery, audited deletion/restore evidence, and operational review. These are explicit deployment adapters and launch gates—not hidden UI placeholders.
