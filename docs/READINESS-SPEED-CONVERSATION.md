# Faster avatar and longer-conversation follow-through

15 September 2026. This is source/test evidence, not a deployment claim. Use the
accompanying PR release record for promotion and post-release provider results.
Priya, STT providers, infrastructure plans, payment flags and credentials are
unchanged. Physical-device and independent-human gates remain outstanding.

## Avatar

The default model transfer is **1,235,862 bytes**, down from 3,265,180 (62%
smaller); the loading portrait is **13,868 bytes**, down from 542,802. The model
downloads alongside the lazy 3D code only after video-call opening, and hang-up
aborts it. Browsers without native gzip use the 2,920,764-byte raw call profile,
not the 9 MB original. Both routes enforce size and SHA-256, without silent
second downloads.

Geometry bytes, skeleton, morphs, expressions, material values and licence are
unchanged. Textures are at most 1024 pixels per edge, quality-90 WebP with exact
alpha: deliberately **not pixel-identical**. Every image must remain below
5/255 alpha-weighted RGB mean absolute error against its resized original.
The original and previous pixel-identical profile are retained and tested.
Actual rendered mobile screenshots were visually compared.

Three cold Apple M4 Metal runs at 393×851/DPR1, no CPU throttle, call-opening
network shaped to 1.6 Mbps down/0.8 Mbps up/150 ms latency measured animated
readiness at **10,892.6 / 10,875.0 / 10,797.5 ms**. Median **10.88 seconds**,
versus the prior comparable 23.81-second observation: about **54% lower**.
That remains a visible wait on a very slow connection, not instant startup;
the small portrait and call/caption controls remain available meanwhile.

All runs recorded real draw submissions and 16.7 ms median animation-callback
intervals during synthetic speaking/listening, then no active microphone
tracks after hang-up. No camera was opened. These are shaped-loopback mobile
emulations, not physical-phone, whole-page cold-load, field-FPS or acoustic
acceptance. Evidence summaries retain the raw local report hashes:
[run 1](../audit/readiness-2026-09-15-speed-conversation/avatar-slow-1.json),
[run 2](../audit/readiness-2026-09-15-speed-conversation/avatar-slow-2.json),
[run 3](../audit/readiness-2026-09-15-speed-conversation/avatar-slow-3.json).
See [reproduction instructions](DEPLOYMENT.md#call-ready-avatar-delivery-and-repeatable-slow-network-lab).

## Conversation diagnosis

Cloudflare showed 500.22/10,000 daily neurons before a bounded 36-request,
single-demo run of fictional inputs with memory off. It stopped at its first
service error on turn 28, revoked the session and did not retry or renew:
**27/28 attempted turns passed heuristics; the run is incomplete**. Chat HTTP
P50 was 1,897 ms and P95 2,876 ms, not end-to-audible call timing.

The complete 24-turn trip retained Arjun, Jaipur, the corrected Sunday
departure and preferences through language switches. Review also exposed
unsupported inferences: a work-related delay became extra relaxation time,
and a first-person camera-battery habit was assigned to the cousin. Some Hindi
words mixed scripts awkwardly. Keyword passes did not prove semantic quality.

The next scenario failed at a short Hinglish recall question. Production did
not expose its raw candidate, so that exact rejected draft is unknown. Local
reproduction found a concrete defect: **“Riya Delhi gayi thi.”** was rejected
because it lacked the old filler-word markers. The validator now recognizes
inflected Hindi in input and output. Voice and video route tests verify this
reply succeeds with one provider attempt, without repair; English-only output
still fails when Hinglish is requested. “Keep it short in English/Hinglish”
also selects the requested language correctly.

The shared prompt now preserves first-person ownership, distinguishes
corrections from unstated consequences and requests complete Hindi spelling.
No canned trip-specific answers were added. Evaluation now requires all
requested fact groups (person **and** city), records per-language latency and
distinguishes bounded style/context error codes.

[Retained pre-fix report](../audit/readiness-2026-09-15-speed-conversation/conversation-before.json).
Post-release testing must use the verified new SHA. This report does not
certify the changed prompt or the full 76-turn dataset. It tests supplied
current-conversation context, not saved-memory persistence, STT/TTS or a real
microphone. Fluent-human and acoustic acceptance remain separate.

## Live release findings and follow-up

PR9 was merged as `c6d86d3486812105c30a4b977930e552fda376d6` and
promoted from successful main CI34886066930, with every artifact hash checked
before/after deployment. Live version `f232eb78-614d-4ad6-87af-9e9ac91f308b`
passed 5/5 read-only production checks, including the 1,235,862-byte avatar.
The avatar improvement is live; this does **not** certify conversation quality.

Cloudflare showed about 1.75k/10k daily neurons before the subsequent bounded
QA runs. Two ordinary synthetic accounts, with memory/transcript storage off,
were deleted after use and their stale sessions rejected. No mail, payment,
quota increase, credential change or fallback provider was activated.

- First run stopped at turn2 with HTTP503 `SERVICE_UNAVAILABLE` after8,436ms;
  the provider circuit recorded a failure. The old response does not expose
  the cause, so this is consistent with the8s deadline, not proof of a global
  Cloudflare outage. [Original report](../audit/readiness-2026-09-15-speed-conversation/conversation-release-attempt-1.json).
- One bounded diagnostic follow-up, after checking the circuit, passed that
  same turn but stopped at turn19 with `INVALID_REPLY`.18/19 attempts passed
  the old heuristics; P50 2,832ms, P95 5,839ms. **Incomplete, not a passing76-turn
  run.** [Original report](../audit/readiness-2026-09-15-speed-conversation/conversation-release-attempt-2.json).
- Manual review found a Hindi opening followed by Roman-Hindi grammar, and a
  requested translation of a good-luck message replaced by speculation about
  the brother's feelings. Those passed the old language/anchor checks and must
  not be counted as semantic successes.

Follow-up source shares one language check between app and evaluator. It
rejects disguised Roman-Hindi answers while retaining English names/technical
terms and valid short inflected Hinglish. Native-script instructions reinforce
Hindi generation and its single existing repair. Prompting preserves the
purpose/addressee of a drafted message during translation or shortening; an
additional intent-anchor group flags the observed drift.

Content-free reason enums now distinguish style repairs/rejections and provider
timeouts. No prompts, generated replies or exception messages enter those logs;
the deadline, one-repair limit and capacity charges are unchanged. Production
verification of this follow-up belongs in its PR release record. Free-provider
latency/availability, fluent-human semantics and physical-call acceptance are
still not guaranteed by these tests.

## Complete 76-turn release evaluation and speaker-context follow-up

PR10 release `bb7a48c714a4be58894d7209ae360d9d404bdb92` came from successful
main CI34890532896. Its 329-file artifact was verified and promoted as version
`9de4991f-1a44-4e87-8e34-b89e94a19939`; read-only production smoke passed 5/5.

The [full live-provider report](../audit/readiness-2026-09-15-speed-conversation/conversation-release-76-turns.json)
completed **76/76 requests with HTTP200**, but **75/76 passed the recorded
heuristics**. P50 was 2,739ms and P95 7,896ms. These are reply-HTTP timings,
not audible-call latency. The ordinary synthetic account had transcript/memory
storage off, requested no mail, and was deleted with stale-session rejection.
The quota dashboard showed about 2.44k/10k neurons before the run; no allowance,
model, voice, credential, payment or provider setting changed.

The failed turn was the Hinglish recall “waise maine kis ke saath chai pi thi?”:
the answer recalled the correct person but switched to English. The input
detector missed those Hindi words. The new regression covers both voice/video
routes and adds these inflected/context markers without rejecting an English
sentence that merely contains the word “chai”. Hindi React explanations and
English translation of a drafted greeting now passed, as did the 24-turn
recall of Arjun, Jaipur, Sunday and the crowd/museum preferences.

**75 keyword/script passes are not 75 semantic successes.** Manual review still
found the work-related delay described as extra leisure time, the user's own
camera-battery habit assigned to Arjun, and Mira narrating the user's offline
trip/relative as her own. Turn-local perspective and correction cues now sit
next to the latest utterance; drafts retain their sender/addressee across
rewrites. No trip-specific response or new model was substituted. Diagnostic
fixture phrases now flag these recurring claims for meaning review; they can
also flag legitimate negation/quotation and are not production rejection rules.
The historical report is retained unchanged. This follow-up requires its own
post-release test; broad semantic or physical-call acceptance is not claimed.
