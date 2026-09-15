# Streaming Priya and grounded multilingual drafts

15 September 2026. This records implementation and bounded tests, **not a claim
that every launch gate is complete**. Deployment identity and post-release
measurements belong in the accompanying GitHub PR release record.

## Speech playback

The selected voice remains Priya, `inworld-tts-2-flash`, with the same generation
settings and the same provider. The call client now requests streaming MP3. The
server decodes Inworld's bounded NDJSON stream and forwards audio progressively;
supported browsers play through native HTMLAudio/MediaSource before EOF.
Browsers without MP3 MediaSource support buffer the **same** response, without
a second provider call. No browser voice substitution was introduced.

Quota and concurrency admission precede HTTP headers. Consent is checked before
generation and at each delivery boundary; provider work/capacity lasts through
the stream. Cancellation, malformed frames, partial failure, backpressure and
deadlines fail closed. There is no automatic replay of partially spoken audio.
Offline audio decoding only drives animation; it is not connected to speakers.

Nine native browser tests across Chromium, Firefox and WebKit cover early
playback, cancellation and partial failure. They use playable MP3 and muted
native audio, not a physical microphone or acoustic loop. Worker tests also
exercise the route with synthetic provider frames and real consent/capacity
storage. These tests do not certify how the voice sounds in a room.

The six-turn pre-change production baseline at `abda0451b2069d06f97725729a16b9f3dfd8674b`
used fixed fictional English/Hindi/Hinglish clips in voice mode, then with
synthetic noise in video mode. All six transcriptions, reply-language checks
and native playback completed; all eight microphone tracks stopped and the
temporary demo consent was revoked. Median clip-end-to-playback was **5.911s**,
maximum **7.660s**. This is a browser-event proxy, not measured audible latency.
[Original baseline](../audit/readiness-2026-09-15-streaming-priya/calls-before.json).

## Conversation model and task focus

The existing Cloudflare Workers AI binding now uses
`@cf/google/gemma-4-26b-a4b-it`, with thinking disabled and the same short spoken
response budget. No additional provider, key, payment or infrastructure plan is
enabled. Visible OpenAI-shaped stream deltas are supported; reasoning metadata
is never delivered. Existing safety, context/consent rechecks, deadlines and the
single bounded style repair remain in place.

Draft requests use a compact task-specific prompt instead of competing with
companion small talk. Corrections and translations retain the recipient,
purpose and user-as-sender perspective. Unrelated turns/cancellation end that
mode. A narrow offline-travel summary normalization keeps Mira from joining
the user's trip; authored first-person drafts and quotes are preserved.

A sequential 32-turn direct-provider candidate trial covered a corrected
message draft, imperfect Hinglish transcription and a 24-turn trip across all
three languages. Median generation time was **0.954s**, P95 **3.925s**, maximum
**6.893s**. This used 180 tokens rather than the production voice limit of 144,
did not traverse production authorization/HTTP, and is not a call-latency or
statistical superiority claim. It preceded the perspective normalization.
[Unedited fictional outputs](../audit/readiness-2026-09-15-streaming-priya/gemma-candidate-32.json).

The candidate preserved the corrected Sunday departure, Arjun, Jaipur and
crowd preferences. The final summary incorrectly said “We are leaving”; that
specific ownership defect now has regression coverage. Other outputs still
included generic reassurance, an unnecessary battery assumption and a claim
that resting would prevent tiredness. **32 completed turns are not 32 semantic
successes.** Independent fluent-human review and broader field testing remain.

## Avatar transport

A lossless Brotli transport is **810,708 bytes**, versus **888,738 bytes** for
the existing mesh-gzip transport (8.78% smaller). Both decode to the exact same
v3 model, whose SHA-256 is verified before rendering. Geometry, expressions,
textures, appearance and licence are unchanged by this release.

Native Brotli decompression is feature-detected: tested Firefox/WebKit use the
smaller asset; tested Chromium 153 does not support it and retains gzip. No
extra decoder, silent second download or forced unsupported format is used.
All six native avatar delivery/integrity tests pass across the three engines.
Deterministic generation checks verify both formats and the same decoded model.

The Apple M4 Metal / 393×851 / 1.6Mbps / 150ms cold-call lab observation was
**9.261s**, essentially unchanged for Chromium's gzip path. This release does
**not** claim sub-second avatar startup or physical-phone performance. The small
loading portrait, call controls and captions remain usable during loading.

## Open acceptance gates

Actual phones/laptops, different accents, real room noise, acoustic echo,
audible interruptions, lip-sync and long calls still require a consenting human
using real devices. Follow [the real-device checklist](REAL-DEVICE-CALL-QA.md).
The separately reported backup custody, sender/mailbox verification, incident
owner, independent human reviews and unapproved GitHub deployment-token scope
are not silently closed by these code changes. Payments remain disabled.

Provider references:
[Inworld streaming](https://docs.inworld.ai/docs/tts/best-practices/generating-speech),
[Cloudflare Gemma 4](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/),
[Gemma thinking control](https://ai.google.dev/gemma/docs/capabilities/thinking).
