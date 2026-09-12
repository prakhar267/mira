# Mira launch hardening — results, 12 September 2026

**Outcome: substantial beta hardening deployed; not an unconditional Product Hunt/commercial launch approval.** No paid plan, provider credits, domain purchase or spending-limit increase was enabled.

- Live: https://luma-companion.prakhargupta267.workers.dev/demo
- Source release: `1f033ab97be7e230e435a63d023e0ac732365ef2`, pushed to GitHub `main`.
- Deployed Worker: `e36706ab-ead1-4219-bd9f-b55c80c3ed60`.
- The final conversation evaluation started and ended on that same Worker version. Earlier evaluation files are retained as development evidence, not presented as final acceptance tests.

## Results

| Check | Observed result | What it does not prove |
| --- | --- | --- |
| Workspace lint, typecheck, tests | Passed all tasks; 75 web tests, 171 tests across packages with test cases | Independent security assessment |
| Next production build + Cloudflare build/deploy | Passed; no ENOSPC failure | Permanent disk-capacity solution |
| Live production smoke | 19/19 passed | Physical microphone or subjective sound quality |
| Live account lifecycle | 10/10 passed after rollback; create, sync, export, erase, revoked-session and late-save rejection | Removal from every platform/provider recovery copy |
| Final conversation evaluation | **62/64** heuristic checks passed; first 40 cases improved from 35/40 to 39/40 | Human conversation quality or a “10/10” score |
| Reply API latency | Median **1,954 ms**, P95 **6,201 ms** | End-of-speech to audible reply latency |
| Long conversation | 24 turns; final four cross-language recall/correction checks passed | Unlimited context or long physical calls |
| Synthetic speech | 6/6 TTS-to-STT checks passed: English, Hindi, Hinglish, clean/noisy | Indian accent diversity, echo handling or real microphone accuracy |
| Bounded app/database load | 50/50 requests, concurrency 5; median 105 ms, P95 182 ms | Product Hunt load capacity or AI-provider stress testing |
| Browser support form | Submit → visible ticket receipt → authenticated inbox → resolve → reread passed | Operator email delivery or staffed support |
| Production rollback drill | Same-source SQLite-compatible rollback passed; database remained reachable | Disaster recovery or an incompatible schema rollback |
| GitHub CI and deploy | Workflow files replaced and pushed; both jobs refused to start | Successful GitHub automation or working scheduled alerts |

Two final conversation requests returned 503 after roughly 8.2 seconds: a monotonous-day Hinglish message and an English travel-date correction. The later recall checks preserved Sunday correctly, but that does not erase the failed reply. No successful reply matched the canned-misunderstanding detector; this narrow measurement must not be described as a zero human-misunderstanding rate. Latency and provider reliability remain release risks.

The Hinglish synthetic transcript contains phonetic spelling such as “ophis” and “kaaphee.” The speech check measures recognizable content anchors, not word-error rate or perceived naturalness. The actual Priya voice remains unchanged.

## Status against all ten requested work areas

1. **Conversation quality — improved, still needs acceptance.** Added 64-turn English/Hindi/Hinglish coverage, rough transcription, correction handling, a 24-turn scenario, 48-message context, day check-ins and telemetry. Removed the saved-memory shortcut that ignored current conversation. Provider failures are now reported as service failures rather than fabricated misunderstandings. Streamed inference limits unnecessary spoken paragraphs; one bounded same-provider style repair is allowed. Two live failures remain.
2. **Microphone/video QA — not signed off.** Tested the real production speech APIs with generated audio and noise, improved transcription fallback timing and mouth/audio gating. Real accents, hardware echo, cameras, interruptions and long calls still require consenting testers. Full-duplex automatic barge-in is not implemented; the visible tap-to-interrupt control is the current behavior. In-browser call testing stopped at the new Terms/18+ gate awaiting action-time confirmation. No claim of physical microphone testing is made.
3. **Old demo data — implemented.** Schema-v2 envelope, safe legacy migration, visible old-history notice and an explicit export/reset choice. Old user history is preserved until reset, not silently erased.
4. **GitHub — code fixed, account blocked.** Replaced the disabled legacy deployment workflow with Mira deployment and health workflows. Latest CI and deploy runs had zero executed steps because GitHub reported failed account payments/spending limits. Scoped Cloudflare deployment secrets are also not configured in GitHub. No account charges were changed. See `github-actions.json`.
5. **Disk — builds unblocked, headroom still low.** Removed only rebuildable project caches; both builds passed. About 2.1 GiB free after cleanup. Sources, recordings and personal files were not deleted. Larger owner-approved storage cleanup remains advisable.
6. **Provider reliability — mitigations live, no SLA.** Removed anonymous LLM7 from production after reviewing its downstream-access terms. Chat uses Cloudflare Llama 3.3 70B; Priya TTS and primary STT remain Inworld. Added time budgets, circuit breakers, honest failure states and shared daily caps. No paid/independent failover or real provider-credit alert integration is configured.
7. **KV scaling — redesigned.** Accounts, state, sessions, support, metrics and rate limits now use a SQLite Durable Object. Legacy KV records migrate on read; deletion tombstones and retry queues prevent resurrection. This removes per-request KV counter writes. A single coordinator is still a bounded beta design, not proof of unlimited throughput.
8. **Operations — substantially implemented, activation gaps remain.** Protected `/admin` operator inbox, ticket status updates, aggregate errors/latency, threshold/capacity warnings, an incident runbook, bounded load test and a real rollback drill. External alert delivery, actual upstream quota alerts, disaster recovery and accepted on-call ownership remain unverified/unconfigured.
9. **Legal/security — engineering controls and review pack delivered.** Hardened erasure/recovery, authoritative billing entitlements, signed webhook checks, opt-in analytics and public disclosures. Provider/legal review checklist and real-device acceptance plan included. Independent legal/security review, stronger age assurance, DPA/retention verification and incident/grievance ownership cannot be claimed complete. Remaining dependency advisories are recorded separately; no high/critical finding was on a web dependency path in the captured scan.
10. **Commercial/launch items — partly implemented.** Dodo checkout, portal and webhook integration plus Resend recovery delivery code are present but disabled until the correct Mira merchant, price, credentials and verified sender are provided. The signed-in Dodo business was a separate DrumToScore business and was left untouched. No Mira domain was selected or purchased. Product analytics is wired and opt-in. Existing videos, samples and older QA assets are committed. A watermark-free illustrative MP4 is available; YouTube upload is awaiting explicit upload-Terms acceptance and was not submitted.

## Files and next approvals

- Operations/configuration: `docs/LAUNCH-OPERATIONS.md`.
- Provider/security review: `docs/PROVIDER-AND-SECURITY-REVIEW.md`.
- Physical call acceptance plan: `docs/REAL-DEVICE-CALL-QA.md`.
- Clean illustrative demo: `artifacts/product-demo/mira-product-demo.mp4`; original Clueso export and watermark preserved separately.
- Operator key: macOS Keychain, service **Mira production operator**, account **prakhar**. Never place it in a URL, public issue or this report.

External completion needs: restore GitHub Actions access; choose an owned domain and approved Mira price/merchant; configure a verified email sender and scoped secrets; approve YouTube upload Terms; assign a real-device test group, independent reviewers and an alert/on-call owner. Maintain the clearly disclosed free-beta position until those gates and the remaining reply failures are resolved.
