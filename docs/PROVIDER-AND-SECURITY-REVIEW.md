# Mira provider and security review — 12 September 2026

Engineering review and an approval checklist, **not** an independent penetration test, legal opinion, DPA approval or compliance certification.

## Provider decisions

- **LLM7 removed from live chat.** Its August 2026 terms describe a research-oriented service and require prior written approval for embedded/downstream access. No such approval was available here. The production route now uses the existing Cloudflare AI binding directly, rather than retrying the anonymous gateway. [LLM7 terms, sections 2 and 3A](https://github.com/chigwell/llm7.io/blob/main/TERMS.md).
- **Cloudflare:** application hosting, SQLite Durable Object account storage, Llama chat and fallback Whisper transcription. Review the applicable account agreement and model-specific terms before a commercial launch. Cloudflare describes how Workers AI handles customer data; this is not proof that all application logs, backups or other providers have zero retention. [Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/).
- **Inworld:** Priya TTS and primary transcription remain unchanged. Its public privacy policy describes voice/biometric processing and international transfers; enterprise processing can be governed separately. Account-specific zero-retention and DPA coverage were not confirmed. Do not promise zero retention or no training on the basis of UI labels alone. [Inworld privacy](https://inworld.ai/privacy), [service-specific terms](https://inworld.ai/service-specific-terms).
- **Browser vendor:** optional browser speech recognition may use a browser-managed remote service. Microphone permission is not an agreement that every vendor has identical retention.
- **Resend and Dodo:** integrations are implemented but disabled/unconfigured. No real email delivery or paid subscription is represented as active. Confirm the correct Mira merchant business, acceptable-use approval, price, verified email sender and terms before activation.

The new SQLite coordinator avoids the old per-request KV write design, but is still quota-bound. Cloudflare documents 100,000 Durable Object requests/day, 100,000 SQLite rows written/day and 5 GB total SQL storage on Free. Multiple SQL statements and indexes can consume more than one written row per API call. Free-limit exhaustion causes failures; this is not infinite capacity. [Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## Reviewed engineering controls

- HttpOnly, Secure, SameSite=Strict session cookie; server-side authentication and entitlement checks.
- Shared atomic per-IP and identity throttles; independent daily caps on expensive AI endpoints. No user-agent-based rate-limit bypass.
- Single-use, hashed, expiring recovery tokens; password changes invalidate older sessions. Real delivery configuration required.
- Raw-body Dodo signature verification; transactional event deduplication and event-time ordering. Checkout redirects and browser plan edits cannot grant access.
- Account erasure and deletion tombstones are atomic. Concurrent autosaves cannot resurrect an erased account. Legacy-storage deletion retries through an alarm.
- Operator inbox requires a separate key; no anonymous support-ticket reads. No key in URLs or browser persistent storage.
- Analytics is opt-in, respects Do Not Track, and accepts only allowlisted event names and bounded durations. No transcript/recording fields.
- Versioned local demo migration preserves data with an explicit reset/export choice. The 18+ gate is self-declaration, **not age verification**.

## Residual risks requiring a release decision

1. Effect, deepmerge-ts, esbuild and uuid advisory chains were updated. The two remaining version-based advisories concern legacy mobile tooling's `image-size@1.2.1`, not the deployed web dependency path. A committed pnpm patch rejects non-advancing/truncated ICNS/HEIF/JXL entries; isolated timeout-guarded regressions also verify valid files. Upstream currently has no published fixed version for those two advisories. This local mitigation does not erase audit findings or replace an independent assessment. See `audit/2026-09-12-followup/dependency-audit.json` and `patches/image-size@1.2.1.patch`.
2. A public anonymous beta remains vulnerable to distributed quota exhaustion. IP throttles and app caps reduce impact but are not identity assurance, bot detection or a guarantee of provider capacity.
3. PBKDF2 currently uses the Workers WebCrypto limit of 100,000 iterations. Have the independent assessor evaluate password-hardening and the identity-provider strategy. Existing password records require a migration plan for any algorithm change.
4. Account support identity verification, legal grievance handling, jurisdiction-specific age assurance, statutory retention, export controls and incident notification need owner/counsel decisions.
5. Platform point-in-time recovery copies and upstream provider records are outside the application delete transaction. Obtain written retention/deletion evidence; do not equate active-store erasure with immediate removal from every backup.
6. Scheduled GitHub checks cannot provide independent alerts until GitHub restores Actions execution. The store's existing alarm now runs a content-free 15-minute monitor without requiring an additional cron slot, but cannot independently detect all Cloudflare/platform failures. A staffed owner, approved webhook and verified delivery still need to be confirmed.

## Independent review handoff

Give the reviewer the deployed version, this repository, `docs/LAUNCH-OPERATIONS.md`, synthetic test reports (not real user exports), data-flow descriptions and read-only access. Ask them to assess authentication/session theft, account isolation, CSRF/XSS, abuse/rate limits, billing replay/order handling, recovery enumeration, deletion races, browser storage and third-party data flows. Record findings and retest evidence separately from this engineering checklist.
