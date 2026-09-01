# Deployment

The Companion workspace is validated with `pnpm check`; CI builds the Next.js and Fastify artifacts. The legacy Saathkind Cloudflare deployment workflow is intentionally disabled.

## Container builds

The web and API can be built independently from the repository root:

```bash
docker build -f apps/web/Dockerfile -t companion-web .
docker build -f apps/api/Dockerfile -t companion-api .
```

Run local stateful dependencies with `docker compose up -d`, apply Prisma migrations with `pnpm db:migrate`, and check API readiness at `GET /ready`. The credential-free product uses the in-memory repository plus mock Redis and S3 readiness contracts.

No Companion production deployment is configured yet. A deployment decision must cover:

- web hosting and API/realtime regions;
- managed PostgreSQL with pgvector, Redis, and object storage;
- secret management and environment validation;
- database migration sequencing and rollback;
- structured logging, traces, metrics, alerts, and cost budgets;
- health/readiness checks, rate limits, abuse controls, backups, and restore drills;
- provider data-processing terms and deletion support.

Use `.env.example` as the configuration contract. Never place provider or payment secrets in `NEXT_PUBLIC_` variables or client bundles.

Production startup rejects the default session and admin secrets. Webhook secrets, provider keys, storage credentials, database credentials, observability endpoints, and public origins must be injected by the deployment environment.
