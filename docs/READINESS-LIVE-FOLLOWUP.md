# Readiness follow-up — 14 September 2026

Payments and paid infrastructure remain excluded. This document separates new
engineering evidence from operational or independent human acceptance.

## Actual-provider multilingual evaluation

The signed-in Cloudflare dashboard showed **152.24 / 10,000 daily neurons**
used before this bounded run. No plan, quota or billing setting was changed.

The consent-aware evaluator ran **12 chat HTTP requests, with no client
inference retries**, using the checked-in `daily-smalltalk`,
`rough-transcription`, and `clarification-and-switch` scenarios. The limited
synthetic demo session was revoked afterward. All 12 responses were HTTP 200
and passed the language/context-anchor/generic-misunderstanding heuristics.
Six requests selected voice delivery and six video delivery; these are text
inputs through the shared call reply API, **not microphone or playback tests**.

- Evaluated deployed source: `86b7638b441467cd9fc59e1ae148dc1d1b8577f3`.
- Cloudflare version: `0f1ae8f7-4a52-4864-8761-f5b1f4a82dbf`, unchanged across the run.
- Small-sample chat HTTP P50 **2,862 ms**, P95 **6,853 ms**.
- Generic-misunderstanding heuristic flags: **0/12**.
- Full content-free report: `audit/readiness-2026-09-14-live/conversation-eval.json`.

This is actual-provider regression evidence, not fluent-human semantic scoring,
full 76-turn coverage, acoustic latency, accent/noise acceptance or an uptime
promise. The app's normal upstream repair attempts can consume more than one
provider attempt per HTTP request; the report does not pretend to know credits.

## Smaller avatar delivery

The canonical 9,001,324-byte VRM is preserved. A gzip-compressed GLB derivative
now transfers **3,265,180 bytes (63.73% less)**. All 18 material images are
lossless WebP with identical decoded RGBA pixels, not reduced-resolution or
AI-redrawn artwork. Geometry, rig, expressions and embedded licensing remain
unchanged. The unused embedded thumbnail becomes a reference to the original
PNG; the visible fallback uses a pixel-identical **542,802-byte WebP** instead
of the 1,243,889-byte PNG. Source and derivative hashes are in the licence notice.

The client checks compressed and decompressed hashes and strict byte bounds,
uses native gzip decompression, and aborts its download when the call ends.
An older browser without `DecompressionStream` can load the original VRM. A
failed derivative does not start an additional 9MB download: the explicit
portrait fallback remains. The expensive asset is still requested only after
opening a video call. No decoder package, inference model or paid service was
added. The existing Three.js loader supports `EXT_texture_webp`.

Tests compare every geometry view and every decoded image pixel, validate
corruption/truncation/oversize/cancellation, and decode all material textures in
Chromium, Firefox and WebKit. The existing actual-renderer lifecycle suite is
retained. A new test is not a passing test until its run is recorded.

Local Apple M4 / Metal, synthetic-media observations: cold ready time was
**958.8 ms** on an unshaped connection and **23,957.9 ms** at 1.6 Mbps / 150 ms
(previous baseline **56,082 ms**). The slow run still needs improvement before
slow-network acceptance. These are mobile-sized desktop lab runs, not phones
or audible speech/lip-sync tests. Those timings used the original 3,257,335-byte
macOS-compressed packaging; the final official-Node packaging is 7,845 bytes
larger with the exact same decoded GLB. Final-package timings belong in the
release evidence, not silently substituted into these earlier measurements.

The first Linux CI asset check exposed host-specific gzip headers. The builder
now sets the RFC 1952 OS byte to 255 (unknown), rather than macOS 19 / Linux 3;
this does not change decoded content. Further diagnosis reproduced Linux's
exact 3,265,180-byte output/hash on the Mac using the official Node 24.18.0
binary: Homebrew used zlib 1.2.12, official Node uses 1.3.1-e00f703. The builder
now requires that official compressor, and the asset is regenerated with it.
Strict generated-byte equality, pixel equality and release checks remain.

## Rechecked external gates

Cloudflare is now signed in. R2 redirects to an activation screen requiring a
recurring, usage-billed subscription, with charges beyond included usage. It
was **not activated**. No independently retained archive/authority, approved
key custody/retention or maintenance window has been established. Enabling the
dormant protected-recovery flags without these would fail account access
closed, and a real authority handoff permanently fences the old writer. That
is not a safe substitute for an isolated recovery drill.

A proposed **90-day Workers Scripts Write** account token is prepared in the
Cloudflare form for Mira's GitHub production environment. The dashboard offers
account-wide Workers scope, not a single-Worker selector. **It has not been
created or stored** while action-time access confirmation is outstanding.
No personal Wrangler OAuth was transferred. GitHub already has the verified
account ID and a main-only production deployment policy.

Verified Mira sender credentials, an approved alert destination, accepted
incident response ownership, physical-device acceptance and independent human
security/legal/privacy/accessibility sign-off are still absent. Cloudflare
sign-in does not supply these. Unrelated product domains, mail credentials or
recipient records are not repurposed.

The existing Resend usage tab redirected to sign-in when opening Domains; its
cached quota display is not proof of current sender authorization. No email
credentials were created, no unrelated domain was reused and no mail was sent.

Source commits, CI success and production deployment are separate events. The
release/promotion record must identify the exact main artifact before claiming
the smaller avatar is live.
