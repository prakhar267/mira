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

The first main-branch run after PR #12 failed one Firefox test despite the PR
run passing: the trace shows `/sw.js` intercepting the synthetic
`/__qa/avatar-loader.js` module, which exists only in Playwright's route. The
transport diagnostic now explicitly blocks service workers, matching the
other HTTP-mocked suites, and asserts that no controller owns it. Application
service-worker behavior is unchanged; the separate real-avatar performance
suite still loads the actual bundled application. No test retry, timeout or
integrity assertion was relaxed. This harness correction must pass CI before
promotion; the failed run is not a release artifact.

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

## First live promotion in this pass

PRs #12/#13 promoted source `d33da5d0174b581871deb421d44fedd1e0293f71`,
Cloudflare version `5b47c488-c5d4-4b4a-a376-25ff437e5ccf`, from the exact
successful main CI artifact (335 verified files). Read-only production smoke:
5/5 passed. Both final CI runs passed; the earlier failed artifact was not
promoted.

The six-turn actual-provider call diagnostic completed: clean English/Hindi/
Hinglish in voice mode, then the same clips with synthetic noise in video mode.
All six had expected transcript anchors, reply language and native audio
playback; automatic listening resumed. All eight requested audio tracks were
stopped and the synthetic demo session was revoked. End-of-clip to browser
playback was 7.686 / 5.316 / 5.389 / 4.414 / 5.361 / 5.488 seconds (median
5.375s). These are small-sample event proxies, not independently measured
audible latency. The 5s P95 aspiration is **not met**. Output was muted.

A separate 12-turn production conversation test completed all requests,
with P50 2.263s/P95 3.376s (chat HTTP only). Eleven passed the heuristic checks;
the final translated draft lost its purpose. Human inspection of the fictional
outputs also found awkward Hindi advice and gendered second-person phrasing,
so 11/12 is **not** an 11/12 naturalness score. The test account was deleted
and its stale cookie rejected. No transcript storage or saved memory was used.

### Draft continuity correction

The live failure exposed conflicting turn-local cues: a relationship correction
was told to acknowledge the fact, and a later translation was told only to
respect ownership, losing the earlier drafting task. The focus builder now
tracks a bounded chain of user-requested draft corrections/rewrites. It keeps
the message addressed to the recipient, applies corrections within that draft,
and does not substitute advice or a biography recap. An unrelated user turn or
explicit cancellation ends the chain; an assistant message cannot start it.
Regression tests cover Hindi corrections, English rewrites, cancellation,
unrelated topics, assistant-origin text and inflected Hinglish requests.

This is a targeted continuity fix, not a claim to have eliminated every
grammar/gender assumption or the remaining speech latency. Its post-promotion
result belongs in the accompanying release comment, separate from the
preceding measurements and source version.
