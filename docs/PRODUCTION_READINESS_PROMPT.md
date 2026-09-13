# Mira: repository assessment and production-readiness implementation prompt

Prepared 13 September 2026 against commit `5487e4e` (`docs: rename repository identity to Mira`). This is an engineering review and implementation brief, not a production security certification. Only this document was added; product code and deployed services were not changed.

## What this repository actually contains

Mira is an adults-only AI companion focused on English, Hindi and Hinglish conversation, voice, an animated avatar, and user-controlled memory. It includes onboarding, account access, chat, memory management, activities, journaling, customization, support and an operator dashboard.

The repository is a pnpm/Turborepo TypeScript monorepo. The active application is `apps/web`, using Next.js/React and a separate vinext/Vite build for Cloudflare Workers. Its production API consists of the route handlers under `apps/web/app/api`, not `apps/api`.

The active request flow is:

```text
Browser: /app (account) or /demo (browser demo)
  → apps/web/app/api route handlers
    → Cloudflare Workers AI: Llama chat; Whisper transcription fallback
    → Inworld: transcription and Priya speech generation
    → MiraStore: SQLite Durable Object for accounts, sessions, state,
      limits, metrics, support, recovery tokens and billing records
    → Legacy LUMA_ACCOUNTS KV: migration input and deletion cleanup
```

`packages/*` contains shared contracts, configuration, AI/context/memory logic, UI and optional platform services. `apps/api` is an optional Fastify backend with a separate PostgreSQL/Redis/S3 architecture. `apps/worker` belongs to that optional platform; `apps/mobile` is an Expo shell. `app/` is an archived prototype. None of those is the public web deployment or a safe replacement for it.

The current code has useful foundations: secure cookie attributes, account authentication, atomic account-deletion fences, signed billing webhooks, provider deadlines, capacity caps, a shared call controller, consent-aware analytics, support tooling, and substantial local regression coverage. Preserve these protections.

## Verification performed for this review

- `pnpm lint`: passed; web ran fresh, 11 other tasks were cached.
- `pnpm typecheck`: passed; web ran fresh, 11 other tasks were cached.
- `pnpm test`: passed; 112 web tests across 21 files ran fresh. Other workspace test/build tasks used cached results. The prior audit records 208 workspace tests; that is not a claim that all 208 were freshly executed here.
- `pnpm --filter @companion/web build:vinext`: passed. Warnings included ignored Next.js `webpack` configuration and client chunks exceeding 500 kB after minification. The runtime implications and initial-route payload need measurement.
- Read active API routes, account/storage code, client orchestration, prompts, call controller, UI feature paths, deployment workflows and previous release evidence.
- Did not deploy, call live AI services, create real accounts, send email, activate billing, inspect secret values, or perform real-device/browser acceptance. Fresh provider performance, vulnerability-audit results and current external configuration were not established.

## Most important findings

Priorities below describe release work, not proof that someone has exploited the application. Code paths are confirmed by inspection; concurrency and scale consequences still need reproducible regression tests.

| Priority | Finding and impact | Starting points |
| --- | --- | --- |
| P0 | Chat, speech, transcription and reranking routes do not require an account or a server-issued demo session. They do not enforce stored consent, age declaration or paid access. Anonymous access is intentional for the beta, but UI controls cannot enforce account policy or protect future paid features. | `apps/web/app/api/companion-*/route.ts`, `lib/edge-security.ts`, `lib/capacity.ts` |
| P0 | Account state accepts almost any object, overwrites the complete document and has no revision check. Two tabs or delayed requests can overwrite each other's work. Subscription is correctly replaced server-side, but most other fields remain client-controlled. | `app/api/account/state/route.ts`, `lib/account-server.ts`, `lib/account-client.ts`, `components/CompanionApp.tsx` |
| P0 | State and daily snapshot writes are separate operations. Account creation, initial state and session creation are also separate. Partial failures can leave incomplete accounts or inconsistent snapshots. | `lib/account-server.ts`, `app/api/account/signup/route.ts`, `lib/store-engine.ts` |
| P0 | Deleting one memory sets `status: "deleted"` while retaining its content and normalized content. That object remains in saved state and exports. Retrieval excludes it, but erasure semantics are incomplete. | `components/CompanionApp.tsx` (`deleteMemory`), `app/api/account/export/route.ts` |
| P0 | The chat route replaces all non-safe safety categories, including medical support, with one generic Hinglish refusal. It checks the latest input using narrow patterns; the response-style validator is not a complete output safety layer. Browser-side safety shortcuts mean the two paths can disagree. | `app/api/companion-chat/route.ts`, `packages/ai/src/safety.ts`, `lib/free-chat.ts` |
| P1 | `accountMode` explicitly excludes `liveMode`, and many feature handlers branch only on `liveMode`. Signed-in image generation can select an existing picture and say “I took this for you”; upload handling can imply image understanding without calling a vision provider. Other optional features need the same capability audit. | `components/CompanionApp.tsx` (`uploadImage`, `generateImage`, `reflectOnJournal`, `addFutureEvent`) |
| P1 | The real reply adapter catches service failures and returns an error sentence as successful companion text. The call controller's tested rejection/retry behavior may therefore be bypassed. The adapter also updates application state before the controller can reject a late result after hang-up. | `components/CompanionApp.tsx` (`generateDemoReply`, `replyDuringCall`), `lib/call-session.ts` |
| P1 | Every storage request addresses one Durable Object. Its request-wide concurrency block includes legacy network reads, scans and deletion cleanup, so slow migration work can hold up unrelated users. Health-only load evidence does not measure this mixed workload. | `lib/cloud-store.ts`, `worker.ts`, `lib/store-engine.ts` |
| P1 | Reranking has an IP rate limit but no shared inference budget or provider deadline. Other AI services have daily caps. Request counts also omit important cost differences between short and long requests. | `app/api/companion-memory/route.ts`, `lib/capacity.ts` |
| P1 | The active prompt ignores several supplied personality/relationship/response-length settings. The chat composer allows 8,000 characters, while the server silently truncates each message to 2,000. | `lib/free-chat.ts`, `app/api/companion-chat/route.ts`, `components/ChatView.tsx` |
| P1 | Web tests mostly exercise utilities and mocked adapters in Node. There is no checked-in Playwright browser suite or active Worker route integration suite. Fresh builds alone do not validate authentication, storage binding behavior or physical calls. | `apps/web/vitest.config.ts`, `apps/web/lib/*.test.ts`, `.github/workflows/ci.yml` |
| P1 | Recovery email is best-effort post-response work, verification is unavailable, and sensitive account operations lack recent reauthentication. Current docs record unresolved real email, alerting, commercial and human acceptance gates. | `app/api/account/forgot-password/route.ts`, `components/AuthRecovery.tsx`, `docs/LAUNCH-OPERATIONS.md` |
| P2 | `CompanionApp.tsx` is 2,418 lines; global CSS is 2,434 lines. Current and historical architectures/configuration coexist. Some documents describe obsolete APIs and compare-and-swap behavior absent from the active state route. | `components/CompanionApp.tsx`, `app/globals.css`, `.env.example`, `docs/architecture.md`, `docs/data-retention.md` |

## Copyable implementation prompt

Copy everything between START PROMPT and END PROMPT into the coding agent working in this repository.

---

**START PROMPT**

You are acting as the senior engineer responsible for making Mira dependable enough for a controlled production release. Inspect this repository, implement the necessary changes in reviewable phases, and verify actual behavior. Do not stop at a generic audit or a checklist.

### Objective and scope

Improve the existing adults-only AI companion while preserving its Mira identity, English/Hindi/Hinglish conversation, Priya voice, animated avatar, visible AI disclosure and user control over memory. Prioritize reliable conversations, data integrity, privacy controls and clear failure recovery. Keep free-beta hardening separate from readiness to accept payments.

The active production target is `apps/web` on Cloudflare through `build:vinext`. `apps/api`, `apps/worker` and `apps/mobile` are optional workspaces; `app/` is archived. Do not accidentally implement the fix only in a non-serving backend. Read applicable `AGENTS.md` files and inspect current git status before editing. Preserve unrelated work.

Use `README.md`, `docs/DEPLOYMENT.md`, `docs/LAUNCH-OPERATIONS.md` and active code to establish the runtime. Treat dated audits as historical evidence. Consult `docs/PRODUCTION_READINESS_PROMPT.md` for review leads, then verify each against the current commit.

Keep the existing stack unless a specific requirement justifies a change. Do not introduce microservices, a new database, a different auth vendor or an agent framework merely to look production-ready. Document material architecture decisions and migration consequences.

Preserve Worker names, bindings, existing sessions, Durable Object migrations and deletion guarantees. Never restore archived/KV-authoritative code as a rollback. Do not use real conversations as fixtures or put messages, audio, tokens or secrets in logs, screenshots, reports or analytics.

Proceed with local code, tests and documentation. Prepare external integrations behind disabled flags when credentials or decisions are unavailable, and continue independent work. Do not infer permission for live deployment, purchases, merchant changes or messages to real recipients. Report the exact external step that remains; do not mark it complete because configuration fields exist.

### Phase 1 — establish a trustworthy baseline

1. Map routes, storage, provider calls, consent checks and feature availability for browser demo, Cloudflare account and optional Fastify modes. Produce a capability matrix identifying working, unavailable and simulated behavior.
2. Record the commit, runtime/package-manager versions and baseline checks. Use the lockfile. Add an isolated local Worker/staging configuration with distinct synthetic storage and mock provider adapters; it must not default to production bindings or consume live inference.
3. Create a prioritized tracker with finding, affected files, proposed change, regression case, acceptance condition and status. Distinguish confirmed bugs from risks needing experiments.
4. Pin one supported Node version across development and CI. The review environment used Node 23 while CI uses 24; eliminate accidental reliance on that mismatch.

Acceptance: a new developer can install, run and test the active Cloudflare-shaped application with synthetic data, using documented commands and no production credentials.

### Phase 2 — enforce access and policy at the server boundary

1. Add a shared authorization layer for chat, speech, transcription and memory retrieval. Account requests must derive identity, consent, capability and subscription from authoritative server records. Reject stale/revoked sessions and cross-account references before provider work.
2. Preserve a useful public demo through a server-issued, expiring, limited demo session. Record its policy/18+ declaration and consent version. Treat self-declaration accurately; it does not establish verified age. Do not treat Origin headers or localStorage as authentication.
3. Apply separate demo, account, IP and service budgets, concurrency limits and abuse controls. Reserve capacity for legitimate account traffic. Add reranking to shared budgets and deadlines. Account for provider attempts, tokens, speech duration/characters and actual failure/cancellation behavior where measurable.
4. Validate all public payloads using explicit schemas with string, array, numeric and nesting bounds. Read bodies with a byte-limited stream; checking size only after `request.text()` has already allocated the full body is insufficient. Handle absent or misleading Content-Length.
5. Keep structured errors with status, stable error code, request ID and accurate retry metadata. Daily exhaustion must not advertise a one-minute retry. Avoid raw provider errors in logs or UI.
6. Resolve the input-size mismatch: reject oversize text clearly or support the documented limit; never silently remove most of the user's message.

Acceptance: tests show that absent/expired demo sessions, revoked accounts, withdrawn processing consent, invalid payloads and denied capabilities cannot call a provider. Demo abuse cannot exhaust reserved account capacity. Direct API requests cannot bypass restrictions implemented in the UI.

### Phase 3 — protect account state, memory and deletion

1. Replace unvalidated whole-state writes with a versioned schema and server-owned identifiers, policy evidence, entitlements and any economically meaningful balances. Validate persisted data when reading and migrating it as well as when accepting input.
2. Add optimistic concurrency with revision/ETag checks and atomic compare-and-swap, or implement bounded domain commands. Return a conflict that the client can resolve. Serialize/coalesce autosaves and expose saving, saved, offline, conflict and failed states. Preserve unsaved work without silently persisting private content locally against the user's preference.
3. Make account bootstrap and state-plus-snapshot operations atomic or recoverable and idempotent. A transient failure must not permanently strand a registered email with no usable profile. Avoid snapshots on every UI state change.
4. Remove message/media growth from an unbounded account JSON blob. Paginate conversations and separate high-volume records. The current upload path accepts an 8 MB image even though the whole state has a 2 MB limit and may duplicate its data URL. Either provide validated, private media storage with deletion support or disable those uploads in the active account mode.
5. Implement server-owned memory create/edit/forget operations. Forget must immediately exclude a memory from context and erase its sensitive fields from active state and exports. Define handling of source messages, derived summaries, caches and existing backups. Do not equate hiding a row with erasure or promise that forgetting a memory also deletes its source transcript.
6. Prevent late writes, stale tabs, retries and restores from recreating forgotten or deleted data. Preserve the existing account-deletion tombstones and legacy cleanup retries. Add a minimal deletion/suppression record with an explicit retention policy; avoid retaining the deleted content in that record.
7. Make memory consent and history-storage behavior explicit for each runtime. Keep paused memories inspectable and deletable. If account history cannot be disabled, say so clearly; if adding that choice, enforce it on the server and in snapshots. Stop in-flight optional processing when consent is withdrawn.
8. Keep account export complete, owner-scoped and free of credentials/internal secrets. Add recent reauthentication for sensitive export, deletion and identity changes without repeating it during ordinary chat.

Acceptance: two simultaneous clients cannot silently lose each other's writes; retries do not duplicate messages; partial signup can recover; forgotten content is absent from active records and ordinary exports; deleted accounts stay inaccessible after delayed saves, legacy migration and an isolated restore exercise.

### Phase 4 — complete the actual product paths

1. Replace ambiguous `accountMode`/`liveMode` branching with explicit runtime adapters and a server-backed capability contract. Keep browser demo, Cloudflare accounts and optional Fastify behavior distinguishable throughout the UI.
2. Audit every visible control: text, voice notes, calls, image upload/generation, journal reflections, future reminders, memory, customization and subscription. Implement the active path or show a precise unavailable state. Preselected artwork must be labeled as artwork; it must not be presented as a newly generated image. Never imply that an unseen image was understood.
3. Consolidate production context/prompt construction. Use supported personality, relationship and response-preference controls consistently across text and calls. Remove or clearly disable settings with no effect. Preserve the current Priya voice while being explicit about any unsupported voice/persona customization.
4. Improve multilingual continuity: names, pronouns, corrections, dates, language switches and “listen without advice” requests. A short reply should still answer the concrete message. Validate meaning and script appropriately without brittle rejection of correct grammar.
5. Treat backstory, memories and conversation text as untrusted data rather than application instructions. Maintain clear boundaries around safety and policy. Do not expose hidden instructions or other users' data.
6. Where useful, deliver genuine incremental text streaming with cancellation. The active browser flow currently animates a completed reply token by token; do not label this transport behavior as evidence of low time-to-first-token.

Acceptance: the capability matrix matches the interface and network behavior. Changing a supported setting produces a testable effect. Signed-in functionality never silently falls into a canned demo path.

### Phase 5 — make safety behavior consistent and context-sensitive

1. Centralize safety decisions across account/demo chat, calls, memory extraction and generated output. Preserve category-specific behavior rather than replacing self-harm support, threats and ordinary medical questions with the same refusal.
2. Respond in the user's language with appropriate supportive boundaries. Use current, verified locale resources only where relevant. Do not convert a request for help into a dismissive “I cannot help” response.
3. Cover obfuscated and code-switched English, Hindi and Hinglish inputs, recent multi-turn context, prohibited exploitation, threats, dependency pressure, false human/sentience claims and inappropriate professional advice. Test benign near-matches to avoid excessive blocking.
4. Add output checks or a justified moderation strategy appropriate to the actual product and providers. Style/grammar validation alone must not be described as output safety moderation. Do not add a processor without documenting its data flow, cost and consent implications.
5. Keep safety, account deletion and privacy controls available independent of subscription or engagement level. Review published safety claims against working implementations.

Acceptance: a curated regression suite covers each safety category and language with positive and negative cases. Failures retain reproducible examples using synthetic data. Automated passing results are not advertised as universal safety certification.

### Phase 6 — finish conversation and call reliability

1. Keep the shared `CallSession` controller, but test it with the real UI adapters. Propagate typed failures from `generateDemoReply`; do not store an outage sentence as a successful assistant answer. Preserve the failed turn and offer an explicit retry without duplicating it.
2. Pass cancellation and turn/session identity through reply, transcription and speech adapters. Hang-up, mute, navigation, new conversation and consent withdrawal must fence both playback and application-state side effects. Stop mic/camera tracks, audio nodes, timers and abandoned requests.
3. Prevent rapid sends and overlapping voice/text actions from duplicating turns. Bound voice-note duration and bytes; cancel pending permission/recording callbacks safely on unmount. Preserve existing call regression cases.
4. Separate silence detection, transcription, generation, TTS and playback timing. Measure end-of-speech to audible response, including endpointing delay; the current roundtrip metric starts after that delay. Report P50/P95/P99 and error rates by stage.
5. Validate current Priya playback, interruption controls, headphone talk-over, denied/revoked permissions, backgrounding, poor network, echo, speaker mode and long calls. Provide understandable fallback controls.
6. Run automated Chromium/Firefox/WebKit checks and document physical Android/iPhone/desktop acceptance using `docs/REAL-DEVICE-CALL-QA.md`. Synthetic audio and browser mocks cannot sign off acoustic quality. Use only consenting adult testers and explicitly authorized recordings.

Acceptance: no stuck mic/camera, duplicate replies, stale post-hang-up state changes or silent failures in the automated scenarios. Real-device results have named devices and measured outcomes, or remain explicitly unverified. Treat P95 under five seconds as a proposed target until measured.

### Phase 7 — harden authentication, recovery and optional billing

1. Preserve secure HttpOnly cookies, hashed tokens and reset invalidation. Add account recovery and email verification as complete lifecycles with expiring one-use tokens, uniform responses, abuse limits and usable error states. Prevent a login timing shortcut from revealing whether an email exists.
2. Make email delivery durable with idempotent jobs/outbox, bounded retries and observable failures. Handle the actual provider acceptance state separately from mailbox delivery. Use a verified sender when authorized; missing credentials must not produce a false “email sent” claim.
3. Review password storage against the actual Workers runtime. Store algorithm/work-factor metadata and design a compatible upgrade path or justify a managed identity option. Do not blindly raise PBKDF2 iterations beyond supported limits or invalidate existing passwords.
4. Keep payments disabled until the correct Mira merchant, price, products, environment, webhook secret and owner decisions are available. Preserve verified-webhook-only entitlement updates.
5. Test concurrent checkout, duplicate/out-of-order events, renewal failure, period-end and immediate cancellation, expired access, refunds, disputes, resubscription and deletion while a subscription exists. Define refund/dispute access policy explicitly. Tie state to verified customer/product/subscription identifiers and reconcile missed events.
6. Add checkout idempotency; an already-active-subscription check alone does not prevent concurrent requests before the first payment webhook arrives. Ensure disabling checkout does not accidentally prevent safe reconciliation or account cleanup for existing subscribers.
7. Ensure protected AI features enforce the resulting entitlement server-side. Accurate billing records are insufficient if the inference routes remain unrestricted.

Acceptance: recovery and billing lifecycle tests run with mocks or a correctly configured test environment. Report real delivery/payment tests separately. Never activate live billing simply to make tests pass.

### Phase 8 — test storage capacity and operational recovery

1. Measure the existing singleton Durable Object under realistic mixed account loads: auth, chat-related state saves, metrics, support listing, expiry cleanup, legacy import and deletion. Include large but valid histories, slow KV and provider failures.
2. Reduce request-wide concurrency blocking and unbounded legacy scans while preserving atomic migration/deletion guarantees. Move retryable cleanup outside the interactive critical path. Add progress markers and bounded batches so pagination does not repeatedly scan all legacy records.
3. Propose partitioning by account/conversation only if measurements justify it. Keep identity uniqueness, session lookup, billing ordering, global budgets and account deletion correct across the chosen boundaries. Supply a migration, rollback-compatibility and reconciliation plan before changing storage authority.
4. Track storage size, rows read/written, write amplification, queue/retry backlog and tombstone growth. App request caps are not provider credits or database quota guarantees. Define a finite beta capacity envelope and degrade gracefully when it is reached.
5. Define RPO/RTO and test a production-shaped synthetic backup/restore in isolation. Existing daily snapshots in the same object and the separate marker-only PITR drill do not prove recovery of account data. Replay deletion/consent suppression before restored data can serve traffic.
6. Add content-minimized observability for account operations and providers, external availability monitoring independent of Cloudflare, delivered alert/recovery tests, release-version correlation and operator access control. Define support/on-call ownership and response hours as owner decisions.

Acceptance: publish observed throughput, latency, errors, storage cost and the tested load mix. Demonstrate an isolated restore with deleted-account suppression. Avoid unsupported “scales to X users” or uptime claims.

### Phase 9 — make the UI maintainable and measurable

1. Extract account synchronization, chat orchestration, memory operations and media/call coordination from the 2,418-line `CompanionApp.tsx`. Use typed domain modules and clear effects; preserve behavior with integration tests before refactoring.
2. Lazy-load avatar/Three.js and optional call/media panels where the measured bundle graph warrants it. Measure route-specific JS transfer, avatar asset loading, LCP, INP and layout stability on representative mobile hardware before setting budgets. Do not simply suppress bundle warnings.
3. Add route error/loading boundaries, recoverable empty/offline states, accessible status messages and explicit sync feedback. Keep scroll position when reading older messages; avoid forcing users to the bottom on every update.
4. Verify keyboard navigation, focus restoration, form labels, contrast, reduced motion, zoom, touch targets and screen-reader announcements. Make memory controls and transcripts usable when voice or animation is unavailable.
5. Improve activation around one clear sequence: understand the AI/18+ disclosures, start a useful conversation, inspect a saved memory, and return to correct continuity. Keep progressive disclosure for advanced controls. Avoid streak pressure, guilt, misleading relationship claims or growth metrics based on emotional dependence.

Acceptance: critical flows pass browser accessibility checks and manual keyboard review; performance results have baselines and comparable after measurements. UI controls reflect actual capabilities and persistence state.

### Phase 10 — release gates and documentation

1. Add Worker-runtime integration tests for the active route handlers, SQLite transactions, alarms and legacy migration. Existing Node SQLite utility tests do not exercise the entire Workers binding/runtime. Add browser E2E for signup/login, chat failure/retry, memory edit/forget, conflicting saves, export/delete and call cleanup.
2. Keep existing lint, typecheck, tests and actual Cloudflare-target build in CI. Verify required tests cannot pass silently because no tests were discovered. Make integration/browser tests part of release checks with deterministic fixtures.
3. Add staged promotion of the exact tested artifact, deployed-version checks, smoke-test output retention and a documented compatible rollback/forward-fix decision. A failed post-deploy smoke must produce a clear release failure and actionable response.
4. Review the dependency audit gate. Current `dependency-smoke.mjs` permits findings by the package name `image-size`; narrow exceptions to reviewed advisory IDs, versions and paths with owner, expiry and mitigation tests. Store new audit reports under the current run instead of overwriting historical September 12 evidence.
5. Publish one current architecture/configuration guide. Separate Cloudflare variables from optional Fastify variables; document actual Dodo, Resend, capacity and operator settings. Mark obsolete architecture/privacy documents historical and make public feature/privacy/safety copy match the release.
6. Keep external launch gates visible: domain, merchant approval/pricing, verified sender, external alerts, real-device acceptance, support ownership and independent legal/security/provider-retention review. Recheck old blockers instead of asserting they still exist from a dated audit. Promotional uploads are not technical production-readiness gates.

### Required evidence and final delivery

Maintain a status for every acceptance condition: implemented and verified, implemented but not externally verified, deferred with rationale, or blocked by a named input. Never mark a criterion passed from code inspection alone when it requires a runtime or human test.

Deliver the code, relevant regression/integration tests, architecture/configuration updates, migration and recovery instructions, release checklist and an evidence report. Report commands executed, cached versus fresh results, remaining failures, affected files and material risks.

Run the appropriate checks for each change and these final repository commands:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @companion/web build:vinext
```

Also run the newly documented Worker integration and browser suites. Run provider-backed smoke/evaluation only in an authorized environment with an explicit test budget; retain versioned failure cases. Do not use health-only load tests as proof of inference capacity, synthetic speech as proof of human microphone quality, or configuration presence as proof of delivered email/alerts.

Report readiness separately for a limited free beta and paid general availability. Start with the baseline and the highest-impact access/data-integrity regressions, implement them, then proceed through the dependent phases. Do not begin with a cosmetic redesign or unrelated native-mobile expansion.

**END PROMPT**

---

## Technical references checked

- Cloudflare documents that `blockConcurrencyWhile` blocks other event delivery and recommends keeping its work small. This supports investigating the current request-wide lock around legacy I/O, not removing synchronization without preserving correctness. [Durable Object State](https://developers.cloudflare.com/durable-objects/api/state/).
- Individual Durable Objects have throughput and storage constraints, and workload shape affects throughput. The single-object implementation needs representative measurements before capacity claims. [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/).
- Cloudflare provides Worker-runtime testing examples for Durable Objects, storage and alarms. Use the supported approach compatible with the repository's pinned toolchain. [Testing Durable Objects](https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/).
- Recent reauthentication, generic authentication failures and abuse protections should follow a coherent authentication design. [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).
- Playwright supports browser automation across Chromium, Firefox and WebKit; this provides browser coverage but does not replace physical-device audio acceptance. [Playwright documentation](https://playwright.dev/docs/intro).
