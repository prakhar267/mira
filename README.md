# Saathkind

**Talk freely. Come back known.**

Saathkind is an India-first, adults-only AI companion concept built around one useful promise: it keeps the thread of a conversation, lets people inspect or remove what is remembered, and follows up only with permission. It is not a person, therapist, crisis service, or substitute for human relationships.

This repository is a clean-room product, brand, and frontend prototype inspired by a category—not a copy of Companaro. Do not reuse a competitor's name, copy, prompts, personas, images, voice, source, or distinctive visual assets.

## Delivery status

Status is intentionally explicit so a polished screen is never mistaken for a production system.

| Capability | Status | Notes |
|---|---|---|
| Responsive React experience | **Implemented prototype** | Lives in `app/src`; review the actual UI for the currently available routes and interactions. |
| Static production build | **Implemented** | Vite emits the client bundle. |
| Integrated asset/API Worker | **Implemented and locally verified** | `app/cloudflare/index.ts` serves the SPA and `/api/v1`; the original Sites packaging worker remains for that handoff path. |
| CI build and packaging checks | **Implemented by this repository** | `.github/workflows/ci.yml` runs on pushes and pull requests after the repository is published. |
| Cloudflare integrated deployment | **Live beta; CI handoff prepared** | The visitor-facing entry point is `saathkind.pages.dev`; its Pages Function calls the `saathkind` Worker through a same-account service binding. The Worker remains available at `saathkind.prakhargupta267.workers.dev`. `.github/workflows/deploy.yml` rebuilds, tests, deploys both layers, and smoke-tests after protected approval once repository secrets are configured. |
| Authentication, age gate, consent ledger | **Demo implementation only** | Adult confirmation, purpose consent history, opaque hashed sessions, logout and tenant scoping exist. Identity is not verified; production auth and recent re-auth remain launch blockers. |
| Account state | **Synthetic beta only** | One SQLite-backed `UserStateCoordinator` Durable Object is authoritative for each demo account. It stores one bounded account document, serializes compare-and-swap writes, and irreversibly tombstones it 30 days after bootstrap through a per-account alarm. This is a beta safety mitigation, not the production semantic data architecture. |
| Durable Object metadata | **Implemented for the synthetic beta** | Separate token-hash coordinator objects hold bootstrap/deletion status; separate hashed IP/account/global objects hold short-lived fixed-window counts. Their alarms remove metadata on its fixed horizon. |
| KV | **Opaque routing only** | `STATE` holds the token-hash session pointer and current user-session pointer through the account's fixed expiry. New accounts do not write content, registries, or rate counters to KV. |
| Chat and safety | **Limited deterministic beta path** | A non-certified keyword router covers a reviewed regression corpus of explicit English/Hindi/Hinglish phrases, but can miss or misclassify emergencies; users are told never to rely on it. The ordinary-chat fallback is deterministic. No Gemini credential or external model processing is enabled. |
| Export/deletion | **Synchronous beta controls** | Export returns an authenticated JSON snapshot in the request; it is not a Queue job or R2 archive. Users may delete sooner; otherwise the non-renewable account/session expires and is tombstoned 30 days after bootstrap by its Durable Object alarm. There is no grace window, processor sweep or verified backup erasure. |
| Follow-ups, billing and providers | **Not live** | Follow-ups are planner records only. There is no Cron trigger, notification delivery, D1/R2 authority, payment flow, paid entitlement or provider-backed identity. |
| Admin, alerting, SLOs, support tooling | **Partial** | Protected dependency health exists; no support console, durable audit sink, paging, dashboards or proven SLO operation exists. |
| Voice, live audio/video, passive mood inference | **Future and feature-flagged off** | Not part of the sellable MVP. |

The current build is a product prototype, not yet an enterprise-ready service. The hard gates are tracked in [the go-live checklist](docs/go-live-checklist.md).

## Local development

Prerequisites: Node.js 22 and npm.

```bash
cd app
npm ci
npm run dev
```

Build and verify the deployable artifact and API:

```bash
cd app
npm run build
npm run test:sites
node --test test-api/*.test.mjs
npx --yes wrangler@4.123.0 deploy --config wrangler.jsonc --dry-run
```

The build must contain:

- `app/dist/client/index.html`
- `app/dist/server/index.js`
- `app/dist/.openai/hosting.json`

Environment files and `.dev.vars` are ignored by Git. Values prefixed with `VITE_` are public at build time; never put a provider, payment, session, or Cloudflare API secret in one. The current release requires no Gemini, payment or notification secret.

## Current beta topology and production upgrade

Cloudflare Pages serves the visitor-facing web app at `saathkind.pages.dev`. Its narrowly scoped advanced-mode Function forwards only `/api` routes to the integrated `saathkind` Worker through a service binding; the Worker remains the sole API and account-state authority. Each synthetic account is mapped to one SQLite-backed Durable Object. That coordinator stores a single account document and authoritative session record, increments a revision on every accepted write, rejects stale revisions, and retains a content-free tombstone after deletion so an older in-flight request cannot recreate the account. Initialization schedules a per-account Durable Object alarm for exactly 30 days after bootstrap; the non-renewable session and cloud account are then irreversibly tombstoned. Separate token-hash coordinator objects serialize bootstrap and deletion status on the same fixed horizon; after deletion they retain only status, expiry, and an opaque receipt. Separate hashed IP/account/global coordinator objects store short-lived fixed-window abuse counts and delete them by alarm. `STATE` KV contains only the two opaque routing pointers for each accepted account through its fixed expiry. There is no active registry or rate-limit KV binding. Export is assembled synchronously and returned as authenticated JSON. Users may export or delete sooner. The active release has no D1, R2, Queue, Vectorize, Cron, Gemini, payment or notification behavior.

The whole-document coordinator is deliberately narrow: it has a 1.8 MB account-state limit, can return a conflict during concurrent writes, has no normalized query model, offers only whole-account 30-day expiry rather than category-specific retention, and has no restore proof. The coordinator cutover intentionally invalidates pre-coordinator synthetic sessions and does not promise data migration. Because the rollout introduces a Durable Object storage migration, recovery is by containment and a compatible forward fix—not by deploying a pre-coordinator Worker or making KV authoritative again.

Private conversations remain gated on a separately reviewed production data architecture, verified identity and recent re-authentication, approved private export delivery, legally approved AI/notification/payment processors where those features are actually enabled, monitoring, restore/deletion evidence, independent security review and legal/safety approval. The repository's inactive D1 migrations, Queue consumer, R2 adapter and Gemini adapter are not part of the current release and are not instructions to enable them.

See [architecture](docs/architecture.md), [security](docs/security.md), [retention](docs/data-retention.md), and [runbooks](docs/runbooks.md) for the detailed design and operational boundaries.

## Cloudflare deployment

The prepared deploy workflow expects these GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`: a narrowly scoped token able to deploy the target Worker, not a Global API Key.
- `CLOUDFLARE_ACCOUNT_ID`: the owning Cloudflare account ID.

Create a protected GitHub environment named `production`, add an approval rule, configure the two deployment secrets above, and set `APP_ORIGIN=https://saathkind.pages.dev`. Then run `Deploy Cloudflare production`. The workflow deploys `app/cloudflare/index.ts`, the `UserStateCoordinator` Durable Object, the built client and the `STATE` routing KV binding from `app/wrangler.jsonc` as the `saathkind` Worker. It then deploys `app/pages/_worker.js` plus the same client bundle to Pages; the Pages Function reaches the Worker only through the configured `BACKEND` service binding. Attach an owned branded domain only after DNS, TLS, redirects and security headers pass the checklist.

Do not add Gemini, payment or notification credentials to this release. Adding any external processor is a separate, reviewed product change with provider terms, data-flow, safety, deletion, budget and incident evidence—not an environment-variable-only activation.

## Repository map

```text
app/                    React/Vite client, integrated Worker, migrations and tests
audit/                  Reference-product evidence and UX audit
design/                 Original Saathkind visual direction
docs/product-brief.md   Product decision, use cases, scope, and caveats
docs/architecture.md    Current and target technical architecture
docs/security.md        Threat model and launch security controls
docs/data-retention.md  Data lifecycle and deletion requirements
docs/runbooks.md        Incident and recovery procedures
docs/go-live-checklist.md
docs/brand.md           Naming, voice, claims, and visual rules
.github/workflows/      CI and protected integrated deployment
```

## Operating principles

1. Adults only; eligibility and consent precede conversation collection.
2. Clearly disclose that Saathkind is AI in acquisition, onboarding, chat, and any future notification or synthetic-media feature.
3. Remember fewer things correctly. Every saved memory needs provenance and view/edit/forget controls.
4. The current planner sends nothing. Any future proactive contact must be opt-in, rate-limited, topic-controlled, and quiet-hours aware.
5. Never sell conversation content or emotional inferences.
6. Do not send private conversation data to any model until a paid, approved provider arrangement and current terms are documented.
7. Roll out to a small invited cohort before accepting open paid signups.

## Important documents

- [Product brief](docs/product-brief.md)
- [Brand system](docs/brand.md)
- [Architecture](docs/architecture.md)
- [Security design](docs/security.md)
- [Data retention](docs/data-retention.md)
- [Operations runbooks](docs/runbooks.md)
- [Go-live checklist](docs/go-live-checklist.md)
- [Vulnerability reporting](SECURITY.md)

## Legal

The repository is proprietary and all rights are reserved; see [LICENSE](LICENSE). Before taking payments, an Indian lawyer must approve the operating entity, terms, privacy notice, consent language, refund/cancellation flow, vendor agreements, and DPDP/SPDI compliance posture. “Saathkind” is a working brand until professional trademark clearance is completed.
