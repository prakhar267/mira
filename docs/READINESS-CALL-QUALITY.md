# Conversation, speech delivery and avatar follow-up

15 September 2026. Source/test evidence; check the accompanying PR's promotion
record and `/api/health` for the deployed source. Payments, plans, credentials,
Priya and speech-recognition providers are unchanged.

## Conversation and reply delivery

The shared chat/voice/video prompt emphasizes grounded replies, corrections
without invented consequences, speaker ownership and avoiding questions the
user already answered. Explicitly fictional examples illustrate the rules;
they do not add facts to memory. Drafts use the user's voice, not Mira's.
Spoken turns prefer one short sentence (at most two/about 35 words), with a
144-token upper bound and temperature 0.45. Safety, consent/context rechecks,
finite capacity limits and provider deadlines remain enforced.

Two concrete defects are fixed: streamed drafts wait for closing quotation
marks, and delivery removes only paired outer wrappers rather than stripping
an internal draft's closing quote. Hindi speech clipping now recognizes `।`
as a sentence ending. Both have regression tests.

Eight fixed fictional cases were sent to the actual Cloudflare model for each
diagnostic variant. Baseline median: 2,249 ms (max 3,625); selected grounded
variant: 1,189.5 ms (max 2,046). This is **sequential, small, non-randomized
direct-model testing**, not deployed HTTP or end-to-audible latency. It cannot
establish a production P95 improvement. Known schedule/ownership assumptions
were absent in the final eight diagnostics; formal Hinglish wording and some
generic phrasing remain imperfect. This is not a 10/10 quality claim.

A same-Cloudflare Qwen alternative was rejected after ownership errors and
62.64/22.26-second outliers; it was **never enabled in production**. Mira keeps
Llama 3.3 70B. No new downstream provider or payment plan is introduced. The
[redacted comparison](../audit/readiness-2026-09-15-call-quality/provider-comparison.json)
retains every batch. The normal evaluation dataset now has 80 turns, including
the reported correction/ownership failures.

## Avatar

Default transport: **888,738 bytes**, versus 1,235,862 (**28.1% smaller**).
The original/v2 assets remain unchanged. Textures, indices, skin weights,
joints, rig and expression bindings are byte-identical to v2. Only render
position/normal/UV attributes, including morph deltas, retain 14 fraction bits.
Every changed component has absolute error below 0.000062: under 0.062 mm per
position coordinate, or 0.064 texel for 1024-pixel UVs. Non-render bytes must
remain identical. This derivative is deliberately not geometry-identical.

A small local MIT-licensed meshoptimizer decoder loads alongside the avatar,
only after call opening. Exact size and SHA-256 checks cover compressed input
and reconstructed GLB. Malformed blocks, trailing data and canceled calls fail
closed; there is no silent second download. No-WASM/no-gzip browsers use the
verified v3 gzip/raw profile. Chromium, Firefox and WebKit all reconstruct the
expected GLB through the actual loader in isolated browser tests.

Slow-network measurements use the same Apple M4 Metal/393×851/DPR1/1.6 Mbps/
150 ms call-opening lab as the prior 10.88-second median. Three runs measured
9,242.5 / 9,263.7 / 9,268.9 ms: median **9.26 seconds**, about **14.8% faster**.
Each had real draw submissions, 16.7 ms median animation-callback intervals and
zero active microphone tracks after hang-up. Speaking/listening screenshots
were visually inspected. These remain a visible slow-network wait, not instant
startup or physical-phone/whole-page timings. Retained evidence:
[run 1](../audit/readiness-2026-09-15-call-quality/avatar-slow-1.json),
[run 2](../audit/readiness-2026-09-15-call-quality/avatar-slow-2.json),
[run 3](../audit/readiness-2026-09-15-call-quality/avatar-slow-3.json).

## Verification and physical acceptance

Local unit tests: 488 passed with four workers. An initial unrestricted run
had one existing backup-recovery test exceed its 5-second limit under load;
the bounded-worker rerun passed without weakening that test. Worker tests:
35 passed. Browser tests: 96 passed across Chromium/Firefox/WebKit. Lint, type
checking and deterministic asset checks passed. CI must rebuild and seal the
final source before promotion.

The opt-in [live-call diagnostic](../apps/web/scripts/live-call-audio-qa.mjs)
feeds six fictional clips through the actual production call UI, native
browser recorder, STT, chat and Priya playback, including language switches
and synthetic noise. It enforces finite request caps, exact release checks and
demo-session revocation. Its result belongs in the promotion record, not
assumed from the script's existence. Input is prerecorded and speaker output
muted: it cannot certify acoustic quality.

Existing synthetic 90-turn/30-minute lifecycle, interruption, echo-isolation,
late-response and cleanup regressions remain. A consenting person still needs
to perform [real-device acceptance](REAL-DEVICE-CALL-QA.md): phone/laptop mic and
speaker, accents, room noise, real echo, audible interruption and lip-sync,
and long calls. Synthetic input does not close that requirement.
