# Mira deployment

The public Mira website runs on Cloudflare Workers, built from `apps/web/` with vinext.

- [Website](https://luma-companion.prakhargupta267.workers.dev/)
- [Demo](https://luma-companion.prakhargupta267.workers.dev/demo)
- [Repository](https://github.com/prakhar267/mira)

The existing Worker resource name, `luma-companion`, is intentionally unchanged. Renaming the GitHub repository does not require changing its live URL, account storage or bindings.

## Validate and release

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @companion/web build:vinext
pnpm --filter @companion/web deploy:vinext
pnpm --filter @companion/web smoke:production
```

Deploy uses `apps/web/dist/server/wrangler.json`. Record the exact commit, Worker version and smoke results. Provider-backed checks consume the available inference allowance; a static health check does not prove microphone or audio playback quality.

## Configuration and workflows

The current providers, storage model, limits, secrets, activation gates and incident steps are documented in [launch operations](LAUNCH-OPERATIONS.md). Cloudflare credentials and provider keys belong in server-side secrets, never `NEXT_PUBLIC_` variables, client bundles or committed files.

GitHub workflow definitions:

- [CI](../.github/workflows/ci.yml)
- [Mira Cloudflare deployment](../.github/workflows/mira-deploy.yml)
- [External health checks](../.github/workflows/mira-health.yml)

Running these requires working GitHub Actions access and the scoped Cloudflare production credentials. Repository naming does not resolve account billing/spending-limit blocks. Billing and email delivery need their own approved configuration and end-to-end verification before activation.

## Rollback boundary

Only deploy a version compatible with the current SQLite-backed `MiraStore` storage and deletion guarantees. Do not remove Durable Object migrations or return to KV-authoritative code.

The archived `app/` prototype, optional Fastify/PostgreSQL services and mobile workspace are not the public Mira deployment or a safe rollback target. Follow the [release and rollback procedure](LAUNCH-OPERATIONS.md#release-and-rollback).
