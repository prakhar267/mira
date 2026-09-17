# Call reliability follow-up

Scope: reported weak replies, an 8.3-second provider timeout, isolated place-name recognition, and 5.55-second slow-network avatar startup. Priya and the underlying avatar character are unchanged.

## Changes

- More explicit fact/quantity grounding; one charged repair for an invented extra-time benefit on a correction, retaining the original history. Explicit past anecdotes do not lead to redundant/current-progress questions.
- Chat opts out of Cloudflare's provider capacity queue (`rejectIfBusy`, documented September 17). Busy capacity is a typed, retryable error, not a fabricated reply. Existing deadline, consent, capacity and cancellation fences remain. Content-free stage/first-text timing helps distinguish a future queue/header stall from generation latency. This does **not** promise that a free provider will never time out.
- Voice and video carry at most 12 plain-word vocabulary hints from accepted user speech in that call. No saved memory or assistant guesses are imported. Default STT remains automatic; valid English/Hindi/Hinglish is never changed to a preferred name. An unsupported-script detection gets one charged Hindi re-decode, with a bounded deadline and no third provider attempt. Unresolved unsupported text is not silently treated as English.
- Adaptive lossless avatar packing reconstructs the **identical** call-v4 GLB (`063b3fe2ca59185e2bc734e0c884e912abbcab8b65a116a89c6d70cb5b1af6b4`). Gzip transport drops from 792,437 to 757,456 bytes; the precomputed Brotli representation is 698,754 bytes. HTTP Brotli makes the smaller encoding usable even without JavaScript Brotli support. Actual CDN transfer/startup must be measured after release; encoding size alone is not a startup claim.

## Baseline and test limitations

`baseline-short-calls.json` reproduces the problem on production commit `2ebc877ef6eac626c70bfe14b8f626fce191c259`: the native voice UI correctly transcribed a full Hindi sentence containing Pune, then transcribed the isolated city clip as Thai `คุณ`. It stopped at that semantic failure (1 of 2 completed turns passed; video and negative control were not run). The owned demo session was revoked.

The three MP3 fixtures in `audio/` are prior synthetic Priya outputs (“Pune”, “पुणे” and “one”), not recordings of a human. `live-call-audio-qa.mjs --short-names` feeds them through native MediaRecorder after a full contextual Hindi clip in voice and video calls, with an exact-match negative control (eight planned turns). The normal mode separately covers English/Hindi/Hinglish and synthetic noise.

These tests do not establish physical microphone/accent diversity, subjective sound quality, lip-sync acceptance or phone performance. No review or availability guarantee is implied. Final CI/deployment/live evidence is linked on the release PR after verification.
