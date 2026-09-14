# Mira inference boundary — 13 September 2026

This describes the active `apps/web/app/api/companion-*` routes. It is an implementation contract, not a claim that hosted providers, human audio quality, or universal safety have been verified. No provider/model substitution is part of this change: chat remains Cloudflare Llama 3.3 70B; speech remains Inworld Priya; STT remains Inworld with Cloudflare Whisper fallback.

## Session and consent contract

- The server-only `MIRA_INFERENCE_DISABLED=true` switch returns `503 INFERENCE_DISABLED` before account, budget or provider work on all four inference APIs and capabilities. Local compiled browser/artifact helpers force it; it is not enabled on production by this change. Account privacy/recovery/storage routes remain available.
- Account-cookie presence always selects account authentication. An expired/revoked account cannot fall back to a demo cookie. Identity comes from `requireAccount`, never request profile fields.
- Account inference requires an existing server-owned account policy record with current `termsVersion: "2026-09-13"`, an adult declaration timestamp, and active processing consent in both policy and validated state. Old consent is not silently promoted: legacy accounts must explicitly confirm the current disclosures through `/api/account/policy`.
- Demo inference requires a cryptographically random opaque `__Host-mira_demo` HttpOnly, Secure, SameSite=Strict cookie. `POST /api/demo/session` accepts exactly `{adultDeclared:true, aiProcessingConsent:true, memoryConsent:boolean, policyVersion:"2026-09-13"}`. It stores a hashed-token lookup with the declaration, policy version and one-hour expiry. Response: `{mode:"demo", expiresAt:<ISO string>, policyVersion, ageAssurance:"self-declared"}`. This is **self-declaration, not verified age**.
- `DELETE /api/demo/session` revokes the stored token and clears the cookie. Neither a localStorage flag nor an Origin header authenticates requests. Same-origin checks additionally protect mutations against browser CSRF.
- Memory retrieval separately requires stored memory consent. Account profile, relationship mode, response preferences and context memories are loaded from owner-scoped validated state. Client memory text may select only matching active canonical owner memories; it cannot inject another account's records. Rerank requests reject IDs that are foreign, forgotten or inactive.
- Consent and selected memory content are rechecked before direct recall, each provider attempt and delivery. Chat and rerank return `409 CONTEXT_CHANGED` if selected memory is paused, deleted or corrected during the request. IDs and owner-scoped canonical content are checked for reranking. Client cancellation remains necessary to stop local playback immediately. Upstream compute that has already started cannot always be recalled.

## Capabilities

`GET /api/capabilities` returns `{runtime:"cloudflare",mode,policyVersion,ageAssurance,expiresAt?,capabilities,voice}`. An unauthorized caller receives disabled capabilities plus a stable `reason`; it does not receive another account's data. Chat/transcription/speech availability also depends on configured bindings/keys, not a client subscription value. Runtime health or remaining external provider quota is not guaranteed by configuration presence.

For an authorized, configured free-beta session, chat, transcription, Priya speech, voice calls and avatar video calls are enabled. Memory retrieval depends on memory consent. Image upload, image generation, image understanding, generated journal reflection, scheduled notifications, billing and voice customization are explicitly unavailable. Camera preview is not image understanding. Payments remain disabled; this is not paid entitlement enforcement for a future paid launch.

## Explicit request limits

The reader consumes a byte-limited stream and cancels it when the limit is crossed, including missing/false Content-Length. JSON depth is limited to 12. Payloads have explicit allowed keys, types, enums, finite numeric ranges and list bounds; unknown identity/role fields are rejected.

| Route | Limits |
| --- | --- |
| Chat | 120,000 body bytes; at most 48 user/assistant messages; at most 8,000 characters per message; last role must be user; profile names 80; background 8,000; eight memory strings of 2,000 characters |
| Speech | 5,000 body bytes; 500 speech characters; longer text must be segmented by the client rather than silently clipped by the route |
| Transcription | 4,005,000 body bytes; 4,000,000 base64 characters; supported audio MIME; structurally valid base64; optional duration hint 1–60,000 ms |
| Memory reranking | 180,000 body bytes; query 8,000 characters; at most 80 candidates of 2,000 characters; result limit 1–8 |
| Demo declaration | 1,000 body bytes; only the four explicit declaration fields |

All applicable limits must hold simultaneously; an array of individually valid maximum-length items can still exceed the body-byte limit. Rejections use 413 rather than silently deleting input. A client duration hint is **not verification of decoded audio duration**; compressed-audio decoding/inspection remains a further hardening opportunity. Audio is still bounded by bytes, per-attempt accounting and provider deadline.

## Atomic reservation and cancellation semantics

Existing IP/minute limits remain, and demo issuance is limited to six per IP/hour. Every actual provider attempt, including chat repair and STT fallback, first requests an atomic Durable Object reservation. Reranking is included.

- Service daily attempt default: 600 (existing chat/speech/transcription environment overrides retained; rerank currently 600).
- Demo aggregate share: at most 40% of service attempts **and cost units**, leaving at least 60% headroom unavailable to demos. Accounts share the service total and cannot be guaranteed individual availability.
- Principal daily attempts: demo 40 per service/session; account 180 per service/account. Principal and global estimated-unit ceilings also apply.
- Concurrent leases per service: global 12, all demos 4, each demo 1, each account 2. Lease expiry is 40 seconds.
- Estimated units: chat input/output tokens using character estimates, speech characters, compressed-audio seconds estimated from bytes, rerank query/context character-derived tokens. These are conservative application budgets, **not actual provider billing or quota measurements**. Non-Latin token counts and variable audio bitrates can differ substantially.
- Failed provider attempts retain their attempt/unit charge. Normal completion/failure releases concurrency. Abort/timeout keeps the lease until expiry, since a Workers AI binding might continue upstream work after the browser goes away. This prevents immediate cancellation from multiplying unconstrained upstream calls. No charge refund is claimed.
- Chat provider deadline is bounded by the request's approximately 8.5-second generation budget, including at most one repair; rerank 3 seconds; TTS 10 seconds; STT primary 4 seconds and fallback 2.5 seconds. These are server deadlines, not measured end-to-audible latency promises.

Errors retain a safe human message, HTTP status, stable `code`, `requestId` and optional `retryAfterSeconds`. Daily capacity rejection advertises seconds until the UTC reset, not the previous misleading one-minute retry. Logs contain operation metadata, not messages, audio, credentials or raw provider exception text.

## Conversation and safety

The production prompt now uses supported response length, advice style, question frequency, listening-first, relationship style and personality settings. Call replies remain short for speech. Names, backstory and memories are JSON-labeled untrusted context, never instruction authority. The prompt anchors the latest language, pronoun continuity, corrections, current UTC date, AI identity and non-exclusive relationships.

The shared `companion-safety` module gives distinct English, Hindi and Hinglish responses for self-harm, threats, sexual exploitation, medical boundaries and dependency pressure. It handles curated obfuscations, code-switching, a limited recent-turn continuation rule and benign near-matches. It does not introduce another data processor. Output checks are separate from grammar/style and reject selected unsafe instructions, professional overreach, false human identity, dependency pressure and instruction-disclosure patterns. Sensitive safety content is excluded from optional memory reranking/context extraction.

**Limitations:** these are deterministic, testable defense-in-depth rules plus provider prompting, not a full semantic classifier or independent safety certification. Novel euphemisms, implicit intent, long-range context, negation and multilingual edge cases need adversarial human evaluation. Locale-specific crisis numbers were deliberately not introduced without fresh verification; urgent responses point to local emergency help and trusted people. Do not advertise perfect understanding, universal moderation or that passing synthetic tests proves safe human conversation.

## Reproducible checks

### Incremental text delivery

The active text client negotiates `Accept: application/x-ndjson` with `/api/companion-chat`. Voice/video continue using the existing JSON response and complete-text Priya playback. No model, voice, external processor, or provider allowance changed.

Text transport emits newline-delimited `delta`, `done`, or terminal `error` events. A `delta` contains new checked text; `done` includes the final reply and model. **HTTP 200 and EOF do not mean success:** only a valid `done` permits the client to commit an assistant message. Post-header errors retain `status`, `code`, `requestId` and optional `retryAfterSeconds` inside the terminal event because an HTTP status/header cannot change after streaming starts. Interrupted/malformed/inconsistent streams fail closed. Existing JSON callers remain supported.

The stream does not forward raw model tokens. It accumulates output, checks the raw prefix with the existing output guard, holds one complete sentence as lookahead, and releases a style-valid, separately checked complete-sentence prefix. Reasoning markup and overlength candidates remain buffered. At most eight partial frames are released per turn, followed by a fully checked final result. Safety-category user inputs use their deterministic support response without provider work. If subsequent output or full-reply validation fails, the client removes its transient draft and offers retry of the same user turn, without retaining an incomplete assistant success. Repair is permitted only before any prefix has been emitted.

This is **genuine incremental network delivery**, not playback of an already completed answer. It intentionally does not optimize raw token-first latency: one-sentence answers, unsafe/uncertain drafts and buffered candidates may wait until generation finishes. The existing bounded deterministic guard is not universal semantic moderation; lookahead reduces partial-context risk but cannot prove every response safe. Content already delivered to the network or seen by a user cannot be recalled if a later chunk fails or consent changes.

Frames are pull-driven with zero application prefetch buffering. Before every partial frame and final result, the route rechecks session, processing consent and the selected owner-scoped memory context. A queued application frame is rejected if consent is withdrawn, the account is deleted, or selected memory is paused/deleted/corrected. Provider abort/deadline also invalidates a pending prefix under backpressure. Already-started upstream compute is subject to the existing lease-expiry policy; cancellation does not promise a provider refund.

The provider SSE reader limits total transport to 512,000 bytes, an unterminated/pending frame to 64,000 characters and collected reply text to 4,000 characters. Empty or keepalive frames cannot bypass the transport cap. The response stream has a 15-second total delivery lifetime, including waiting to emit terminal success/error to a client that stops reading. Deadline/abort races also fence pending authorization reads; timed-out streams close without a success marker.

The UI holds partial text outside `DemoState`: it is absent from autosave, export, history and memory extraction. Navigation, new conversation, withdrawal and cancellation remove it. Calls do not consume partial text for TTS. Network-stage tests use the real route, a local TCP HTTP server, the real client parser and a deliberately unfinished synthetic upstream. Separate browser fixtures cover actual transient UI display, final-only saving, retry without duplicate user turns and navigation cleanup. Neither fixture establishes production provider latency or acoustic quality.

`tests/worker/chat-streaming.test.mjs` additionally exercises streamed success/error and voice/video JSON through real Worker route, policy, capacity and SQLite boundaries with the existing synthetic provider binding. Its scheduler regression uses an actual execution context and `waitOnExecutionContext` to drain post-response work. The synthetic framework shim now implements request-scoped `after` with real `ctx.waitUntil`; throwing and abandoning the fallback task previously caused a test-runtime import/read hang after demo creation. This is a harness correction, not a production storage change.

```sh
pnpm --filter @companion/web exec vitest run --config vitest.config.ts lib/chat-streaming.test.ts lib/chat-stream-protocol.test.ts lib/chat-stream.test.ts lib/conversation-turn.test.ts lib/inference-routes.test.ts
pnpm --filter @companion/web test:browser tests/browser/companion-flows.spec.mjs
```

Focused local suites cover streaming byte limits/depth/UTF-8, current/expired/revoked sessions, policy withdrawal, ownership, malformed/oversize payloads, active-route denial before providers, reranker reservations/deadlines, post-generation consent fencing, safe output replacement, multilingual curated safety, prompt preferences, estimated-budget charging and isolated test-provider restrictions.

```sh
pnpm --filter @companion/web exec vitest run lib/edge-security.test.ts lib/inference-payloads.test.ts lib/companion-safety.test.ts lib/free-chat.test.ts lib/companion-prompt.test.ts lib/inference-policy.test.ts lib/inference-routes.test.ts lib/capacity.test.ts lib/provider-resilience.test.ts lib/provider-fetch.test.ts
```

The provider adapter accepts a mock service binding only when `MIRA_LOCAL_TEST=synthetic-only` and `SITE_ORIGIN` is localhost/127.0.0.1. A test marker without the binding fails closed, and a test binding under a public origin fails closed. Production configuration must never contain these test bindings. The root Worker integration suite exercises the same active routes against isolated synthetic storage, not the public deployment.
