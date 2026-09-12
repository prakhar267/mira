# Mira launch follow-up — 12 September 2026

Scope: implement the remaining launch items 1–7; **leave item 8 (Mac disk cleanup) alone**. No disk cleanup, purchases, paid plan changes, provider-credit purchases, unrelated merchant changes, or other projects' cron deletions were performed.

Live beta: https://luma-companion.prakhargupta267.workers.dev/demo

Source commits: `42e55c0` — call lifecycle, speech validation, operations, billing/recovery hardening, CI and dependency fixes; `7c9d143` — Hindi grammar and language-switch validation; `883b168` — anchor the current language beside the latest utterance in a long mixed-language history. Latest deployed Worker version: `52fcff83-a365-41ee-a502-7413d8c2689b`. This remains a free beta, **not a fully signed-off commercial launch**.

## Implemented and deployed

- One shared voice/video call controller, 22 lifecycle regressions: automatic microphone restart, permission-pending state, hang-up fencing, duplicate/stale callbacks, mute/speaker toggles, preserved failed-reply retry and optional headphone talk-over. Automatic speakerphone barge-in is not certified.
- SSE `[DONE]` ends a generated reply immediately; cancellation acknowledgement cannot hold up a completed response. Browser STT fallback requires high confidence on all paths. Failed speech services are reported honestly rather than replaced with invented conversational replies.
- A false-positive grammar validator could reject a valid answer about a brother after the user mentioned a sister. It now limits first-person checks to Mira's clause instead of matching all user/reply gendered words. Contextual correctness is still an inference/evaluation problem.
- Review also caught a Roman-script Hinglish answer incorrectly allowed as English, plus Hindi ergative `मैंने सोचा था` incorrectly treated as masculine first-person grammar. Both checks were corrected. Language detection now handles short inflected-verb updates such as `Riya bhi trip pe gayi thi` while preserving an English mention of the city Gaya. These have local regressions, and the live affected scenarios are rechecked separately below.
- Conversation evaluation expanded from 64 to 76 turns, including mixed-person references, hesitations, corrections, language switches and a 24-turn continuity scenario. Evaluation scripts record actual latency and individual failures rather than an invented quality score.
- Opt-in call-stage timing events, rolling 15-minute histograms and P95 upper-bound alerts. Monitoring reuses the store's alarm; an actual scheduled result was observed at `2026-09-12T17:44:24.205Z`, `source=durable-object-alarm`, database healthy. New account-wide cron creation was refused at the free five-slot limit; no paid upgrade or deletion of unrelated schedules was attempted.
- A second autonomous alarm at `2026-09-12T17:59:24.217Z` detected `capacity:chat` at **480/600** shared app requests for the UTC day. This is an application budget, not a provider-credit balance. Final checks were kept targeted to preserve beta capacity. Alert state correctly remained `delivery=not-configured` rather than claiming an external notification was sent.
- Private readiness dashboard exposes missing configuration without secrets. Optional HTTPS incident/recovery delivery is implemented and locally tested; no approved external destination is configured.
- Separate synthetic-only SQLite PITR binding and operator-only drill. The real Cloudflare restore returned the earlier synthetic marker while production account health remained good. No real user's database or backup was restored.
- Period-end subscription cancellation preserves verified paid access until expiry; immediate cancellation and invalid/expired access are denied. Duplicate paid checkout is blocked. Password-reset account lookup and delivery occur after a uniform response to reduce enumeration by provider timing/status. Delivery is not a durable queue and is not configured live.
- Dodo integration guidance was applied to test/live gating, verified-webhook entitlements and cancellation handling. No payment activation or test-card purchase was performed against another business.
- Effect, deepmerge-ts, esbuild and uuid updates. Local image-size parser-loop patch plus valid/malformed file regressions. Two version-based high-severity mobile-tooling advisories still appear because upstream has no published fixed version; the mitigation is not independent security approval. No deployed-web path was present in these remaining findings.
- CI validates the dependency patch and retains the real Cloudflare artifact. Automatic deployment includes lockfile, workspace and patch changes. Source is committed and pushed to the existing private GitHub repository.

## Verification evidence

| Check | Result | Evidence / scope |
| --- | --- | --- |
| Workspace lint, typecheck, tests | Pass; 208 tests, including 112 web tests | `workspace-checks.json` and individual logs |
| Cloudflare-target build/deploy | Pass | Worker version above; no ENOSPC occurred during these builds |
| Production smoke | 19/19 | `final/production-smoke.json`: includes account lifecycle, security boundaries, language continuity and generated speech |
| Storage lifecycle | 10/10 | CLI run: create/read/write, forged-plan rejection, export, delete, revoked session, late autosave, deleted login, operator gate |
| Synthetic speech | 6/6 | `final/speech-roundtrip.json`, generated Priya clips with clean/pink-noise variants in English, Hindi and Hinglish |
| Bounded app/database health load | 250/250, concurrency 10; P50 102 ms, P95 202 ms | `final/load-smoke.json`; NOT AI load or Product Hunt spike certification |
| Operator/recovery smoke | 8/8 | `final/operations-smoke.json`; real isolated PITR, auth gate and main-store health |
| Full conversation evaluation | 74/76 automated checks; P50 1,423 ms, P95 4,848 ms; additional wrong-language reply caught in manual review | `final/conversation-eval.json` on version `622fbef8`; two 503 failures; NOT a 97% subjective quality score |
| Grammar-only targeted reply recheck | 6/8; long-history English switch still failed | `final/conversation-recheck.json` on `22fd15b6`; previous failures preserved |
| Language-anchor targeted reply recheck | 8/8 basic API/language checks; 1,310–2,690 ms | `final/conversation-recheck-anchored.json`; failed/flagged cases in voice and video delivery; not a full-suite rerun or call-UI test |
| Public landing UI | Rendered; no captured console errors | Live in-app browser DOM + screenshot inspected |
| Live call UI | **Not passed** | Demo stopped at the unchecked Terms/Privacy + 18+ declaration; approval requested, not received |

The first expanded evaluation is retained as `conversation-eval.json`: 74/76 flagged-pass, P50 1,374 ms, P95 3,996 ms. One genuine service/style error exposed the mixed-person grammar guard. The other flag was an invalid test assumption: “don't turn it into advice” had been labelled no-question even though it did not forbid questions. The dataset now explicitly says “No advice and no questions, please.” Initial failures were not deleted or relabelled as passes.

The second full run retained two real failures: `मेरे पास सिर्फ आलू, चावल और दही है` (style rejection, 2,642 ms) and `yaar kal mera presentation hai, nahi sorry parso hai` (inference failure after 8,159 ms). Manual review additionally caught the English turn `Keep the plan simple, we are not trying to see everything` receiving Hinglish. The updated evaluator now flags this; the older raw result is preserved rather than retroactively advertised as clean. No generic-misunderstanding pattern was detected in that sample, but that does not mean every reply was naturally phrased or semantically correct. Reply-generation latency excludes microphone endpointing, transcription and TTS/playback.

The full 19/19 production, 6/6 synthetic speech, 250/250 load and 8/8 PITR reports in `final/` were captured on `622fbef8`, before the final language corrections. Those non-language components were unchanged. A fresh 10/10 storage lifecycle passed on `22fd15b6`, and the latest version receives a separate targeted conversation recheck. No full real-device or complete-dataset rerun is claimed for the latest version.

Final manual review: the failed long-history English switch returned English in both delivery modes (1,310/1,401 ms). However, some Hindi outputs still mix Devanagari with Roman-script Hindi, and some replies include awkward follow-ups or infer the user's grammatical gender. The basic Hindi evaluator checks for Devanagari presence, not complete script purity or fluency. **8/8 is not a claim of perfect multilingual conversation.** These examples remain visible in the JSON for further linguistic/human evaluation.

## Still blocked / not completed

1. **Conversation and acoustic acceptance:** scripted tests are not a universal conversational-quality guarantee. Review final failed turns and latency, then obtain real adult-speaker tests across accents, weak microphones, phones, noise, echo and long calls. No physical human microphone, subjective audio-quality, frame-rate or lip-sync certification was performed. Headphone talk-over remains experimental.
2. **GitHub account and deploy credentials:** GitHub reports that jobs cannot start because recent account payments failed or the spending limit must be increased. Repository secrets were empty. Account billing/access needs owner resolution and scoped Cloudflare production credentials; a manual deploy does not repair Actions billing. This recurred after the source push: https://github.com/prakhar267/saathkind/actions/runs/34709707228
3. **Domain, payments and real email:** choose an owned Mira domain and approved price, authorize the correct Mira merchant, supply its API/webhook/product settings, and verify the email sender. Live readiness reports Dodo and Resend missing; billing stays disabled/test mode. Actual checkout/renewal/refund/cancellation and mailbox delivery cannot be certified without these.
4. **Operations completion:** accepted on-call/support ownership, approved external alert channel, actual incident/recovery delivery, independent platform-outage monitoring, provider-balance alerts, realistic inference load and cross-account disaster recovery remain open. A 250-request health smoke and same-platform alarm do not satisfy those claims.
5. **Independent sign-offs:** penetration/security assessment, counsel review, provider DPA/retention and deletion evidence, jurisdiction-specific age assurance and grievance/incident ownership require accountable external decisions. The checked-in engineering review is not those approvals.
6. **YouTube:** upload dialog was prepared on Prakhar Gupta's channel. No file was submitted because upload accepts YouTube Terms/Community Guidelines, and the action-time approval request was unanswered. The existing watermark-free `artifacts/product-demo/mira-product-demo.mp4` remains available; it is an illustrative walkthrough, not recorded proof of live call quality.

The code and safety/test improvements above are complete; the listed external gates and real-device acceptance are **not**. No claim of “everything fixed,” “10/10,” zero bugs, guaranteed free capacity or production SLA is made.
