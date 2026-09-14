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
