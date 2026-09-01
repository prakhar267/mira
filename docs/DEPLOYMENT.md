# Deployment

The Companion workspace is validated with `pnpm check`; CI builds the Next.js, Fastify, and notification-worker artifacts. The legacy Saathkind Cloudflare workflow remains disabled.

## Container builds

The web and API can be built independently from the repository root:

```bash
docker build -f apps/web/Dockerfile -t companion-web .
docker build -f apps/api/Dockerfile -t companion-api .
docker build -f apps/worker/Dockerfile -t companion-worker .
```

Run local stateful dependencies with `docker compose up -d`, apply migrations with `pnpm --filter @companion/db exec prisma migrate deploy --schema prisma/schema.prisma`, seed catalog data with `pnpm db:seed`, and check API readiness at `GET /ready`. The worker is required for scheduled nudge delivery.

No public domain or hosting target is configured, as requested. Before starting a private production-shaped environment, set:

- `APP_ENV=production`, `AI_MOCK_MODE=false`, and `NEXT_PUBLIC_API_MODE=live`;
- `PERSISTENCE_PROVIDER=postgres`, `QUEUE_PROVIDER=redis`, and `STORAGE_PROVIDER=s3`;
- unique `SESSION_SECRET` and `ADMIN_API_KEY` values;
- `OPENAI_API_KEY` with every selected OpenAI provider;
- `NOTIFICATION_PROVIDER=webhook` and `NOTIFICATION_WEBHOOK_URL`;
- managed PostgreSQL/pgvector, Redis, S3 credentials, and exact `APP_ORIGIN`/`API_ORIGIN` values.

Production startup fails closed if persistence, queue, storage, notification delivery, or required secrets are missing. A hosting decision must still cover:

- web hosting and API/realtime regions;
- database migration sequencing and rollback;
- structured logging, traces, metrics, alerts, and cost budgets;
- health/readiness checks, rate limits, abuse controls, backups, and restore drills;
- provider data-processing terms and deletion support.

Use `.env.example` as the configuration contract. Never place provider or payment secrets in `NEXT_PUBLIC_` variables or client bundles.

Payment is disabled with `BILLING_ENABLED=false`; subscription webhooks return `501` and premium capability gates are open until billing is deliberately implemented. Never put provider, notification, storage, database, or admin credentials in `NEXT_PUBLIC_` variables.
