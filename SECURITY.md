# Security policy

Saathkind may process highly personal conversation content. Please report suspected vulnerabilities privately and do not include real user data in a report.

## Supported versions

| Version | Security fixes |
|---|---|
| Live synthetic beta deployment | Best effort; synthetic/non-sensitive testing only |
| `main` prototype | Best effort; not a public service |
| Older deployments and forks | Not supported |

## Reporting a vulnerability

Use GitHub's **Private vulnerability reporting** for this repository. The repository owner must enable it under **Settings → Security → Code security and analysis** before public launch. If that channel is not available, contact the repository owner through an already verified private channel. Do not open a public issue, discussion, or pull request for an undisclosed vulnerability.

Include:

- a concise description and affected URL/component;
- reproducible steps or a minimal proof of concept;
- likely impact and whether user data or another account may be affected;
- relevant request IDs and timestamps with tokens, cookies, prompts, and personal data removed;
- suggested remediation, if known.

Do not send API keys, session cookies, raw conversations, government identifiers, or payment details. If a safe demonstration needs an account, use synthetic test data.

## Response targets

These are operating targets, not a bug-bounty promise:

| Stage | Target |
|---|---:|
| Acknowledge report | 2 business days |
| Initial severity assessment | 5 business days |
| Critical containment | 24 hours from validation |
| High-severity remediation plan | 7 days from validation |
| Coordinated disclosure decision | Agreed case by case |

No monetary bounty is offered unless a separate written program says otherwise.

## Safe-harbor boundaries

Good-faith research should minimize harm, stop after demonstrating impact, preserve confidentiality, and give a reasonable remediation window. The following are out of scope without explicit written authorization:

- accessing, modifying, deleting, or exporting another person's data;
- social engineering, phishing, spam, denial of service, resource exhaustion, or automated high-volume testing;
- testing physical facilities, employees, vendors, or users;
- persistence, lateral movement, destructive payloads, or public disclosure before coordination;
- attacks against third-party services such as Cloudflare, Google, payment, email, or identity providers.

## Deployment and production-readiness status

The repository contains an integrated synthetic/demo Worker with adult confirmation, opaque demo sessions, tenant-scoped APIs, consent controls, deterministic safety routing, memories, synchronous export, and coordinated beta account/session deletion. Account, token-status, and rate-key records use SQLite Durable Objects with fixed alarms; KV holds only opaque routing pointers. No Gemini key/enable flag, D1/R2/Queue/Vectorize binding, billing/notification provider, or Cron Trigger is active. It is not verified production authentication or an approved private-data system. A reviewed production data architecture, encryption/key rotation, complete retention/deletion, durable audit/monitoring, approved providers, incident paging, and independent testing remain required before private user conversations are accepted. See [docs/security.md](docs/security.md) and [docs/go-live-checklist.md](docs/go-live-checklist.md).
