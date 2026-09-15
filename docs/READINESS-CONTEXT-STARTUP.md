# Context, stream completion and avatar startup follow-up

15 September 2026. Source/test evidence, not a deployment claim: use the PR's
promotion record for exact live SHA, measurements and retained failures.

## Implemented

- Shorter, less contradictory ordinary-conversation instructions. User history
  and selected approved memories remain; character backstory flavour is capped
  at 500 characters. Explicit drafting retains its dedicated instructions.
- Stronger speaker ownership, future-tense corrections and second-person trip
  summaries. A narrow guard catches a named relative being assigned the user's
  self-contained habit. It uses the existing single bounded repair allowance,
  not additional retries. References, quotations and requested drafts keep their
  original context. This is not universal semantic/entity verification.
- Plain corrections retain a substantive first complete sentence instead of
  adding a second invented consequence/question. Explicit additional requests,
  quotations and short acknowledgements are not truncated by this rule.
- OpenAI-shaped inference streams finish on `finish_reason: stop`, even if SSE
  stays open. Deadline, cancellation, safety, response-size and capacity controls
  remain. `length` and `tool_calls` are not successful stop markers. Provider
  queues/outages can still time out; their elimination is not claimed.
- Avatar v4 removes unused zero-weight face morphs: 14 of 57 targets remain,
  preserving every bound VRM expression and surviving geometry byte, texture,
  rig and licence. Gzip is **792,437 B** versus 888,738 B; native Brotli is
  **747,746 B** versus 810,708 B. Older derivatives remain available.
- Video-button pointer/focus intent preloads static code only; no model, media,
  WebGL, session or provider request. Save-Data skips the hint. Content-hashed
  JavaScript chunks receive immutable caching.

Priya, speech recognition and the deployed Gemma model are unchanged. A bounded
GLM comparison was rejected for worse language/drafting mistakes. No payments,
new services, secrets or permissions were introduced.

## Evidence and limits

- Unit, Worker, three-browser and optional avatar/performance checks cover the
  changed paths. Final counts and CI are recorded in the PR.
- Fixed direct-provider checks used fictional problematic turns and their old
  history. Ownership regeneration corrected the tested battery habit; schedule
  and trip-summary handling improved. Some replies remained overconfident or
  awkward. These are diagnostics, not production HTTP or human acceptance.
  Retain all outcomes, including bad ones, in release evidence.
- One cold local slow-network baseline was **9,226 ms**. New local samples were
  **9,198 ms** before intent preloading and **8,593 ms** afterward. Local JS is
  uncompressed. These are not live measurements or robust speed percentiles.
- Separately, existing live v3 CDN assets measured **6,213 ms** under the same
  1.6 Mbps / 150 ms shaping. Compare the new live assets against this, not the
  9-second local number. The CDN diagnostic checks exact release identity before
  and after, mocks all browser APIs/providers, and uses no real account or mic.
- New avatar renders with Metal on an Apple M4, 393x851 emulation. Animation-frame
  callback medians were 16.7 ms. Synthetic speaking/listening screenshots were
  inspected; tracks and draw loops stopped after hang-up. This is not perceptual
  lip-sync or physical-phone acceptance. Slow-link startup still takes seconds.

## Release checks

Review and pass CI before merging; promote only the sealed successful **main**
artifact. Record live SHA/version, read-only smoke, six finite real-provider
voice/video fixture turns, fixed 32-turn conversation evaluation including
failures, and new live CDN avatar measurements. Prerecorded synthetic input and
muted native audio verify the pipeline, not physical microphones or sound.

No perfect grammar, zero timeouts, instant avatar or physical acceptance claim
is made. Unrelated owner/human-review gates remain in the
[readiness ledger](READINESS-STATUS.md).
