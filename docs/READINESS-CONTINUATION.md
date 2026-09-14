# Readiness continuation — 13 September 2026

This continues [the previous delivery](READINESS-FOLLOWTHROUGH.md), starting from commit `4f2ce1d`. Payments remain disabled. Source changes and local checks are not proof of a production release, real acoustic performance or independent review.

## Slow-network asset delivery

The original artwork is retained. Committed build-time WebP derivatives replace only the public landing page's large PNG transfers; no image service, external processor or paid runtime transformation is added. The hero keeps its original 1536×1024 dimensions and framing, with an explicitly prioritized decorative image. The below-fold portrait remains lazy-loaded at 768×768. Conversion uses the pinned Sharp dependency; [its output API](https://sharp.pixelplumbing.com/api-output/#webp) documents the encoder options. The source PNGs are still used by other views.

| Measurement | Previous delivery | This continuation |
| --- | --- | --- |
| Hero encoded bytes | 2,224,077 | 135,378 (94% less) |
| Below-fold portrait encoded bytes | 1,965,219 | 51,992 (97% less) |
| Total observed initial transfer | 2,499,732 bytes | 411,041 bytes (84% less) |
| Initial decoded JavaScript | 320,746 bytes | 320,746 bytes |
| Hero transfer duration, three runs | 11,884 / 11,870 / 11,859 ms | 2,330 / 2,333 / 2,333 ms |
| Largest contentful paint, three runs | 1,280 / 1,240 / 1,228 ms | 1,456 / 1,388 / 1,280 ms |
| Layout shift (CLS) | 0.00613 | 0.00613 |

Conditions: a local compiled Worker, Chromium, 393×851 viewport, cold cache, 4× CPU throttle, 1.6 Mbps throughput and 150 ms network latency. Waits include completed critical-image transfer and decoding. These three observations show less transfer and earlier completed artwork, **not an improved LCP claim**, production P95, physical phone performance or call latency. Text dominated the original LCP and remains fast; prioritizing the image can compete with other resources. [Full measured resource timings](../audit/readiness-2026-09-13-continuation/mobile-emulation.json); [previous measurements](../audit/readiness-2026-09-13-followthrough/mobile-emulation.json).

The new browser regression checks actual hero and lazy portrait decoding in Chromium, Firefox and WebKit, no original PNG request and no companion/3D prefetch on landing. Initial execution exposed a test timing error: scrolling does not synchronously start a native lazy-image request, so immediate `decode()` rejected before a request existed. The test now waits for a loaded natural image before verifying decode; it does not ignore load failures. Browser and performance output directories are distinct so one run no longer deletes the other's evidence. The final mobile render was visually inspected for artwork, readable text and overflow.

Regeneration and regression commands:

```sh
pnpm --filter @companion/web assets:marketing
pnpm --filter @companion/web assets:check
pnpm --filter @companion/web exec playwright test tests/browser/marketing-assets.spec.mjs
pnpm --filter @companion/web exec playwright test --config playwright.performance.config.mjs
```

CI validates committed derivative dimensions, format, metadata exclusion and explicit byte budgets (260 KB hero /100 KB portrait). Production builds use checked-in bytes; they do not recompress at request time. Recheck visual quality and measurements before increasing budgets or changing artwork.

## Call cancellation and long-session lifecycle fixes

The new `call-soak.test.ts` exercises the actual shared controller, reply HTTP adapter, conversation commit fences, speech adapter and microphone adapter. Network/audio/microphone primitives are synthetic and timers are virtual. It reproduced and fixed these playback defects in `speech.ts`:

- A queued `playing` event after cancellation could recreate an animation interval indefinitely. Cleanup now detaches handlers, clears timer references and fences already queued events.
- Cancelling during TTS retry backoff still issued a second request. Cancellation now clears/resolves the pending delay and checks cancellation before and after every attempt.
- Cancellation inside an audio-level callback could clear the audio reference while the interval continued reading it. Callback boundaries now recheck liveness; playback-start cancellation is covered too.
- Playback errors called both error and successful completion callbacks. Failure now cleans up without emitting a success event or accepting later queued events.

The 15 new regressions include 90 alternating English/Hindi/Hinglish turns **per call mode** across over 30 minutes of virtual time; explicit recovery from transcription/reply failures; automatic listening after silence/playback; 18 mute/retry cycles and 24 headphone interruption cycles per mode; 120 playback completions/cancellations; and 30 microphone-adapter STT completions/failures. They assert unique transcript commits, bounded synthetic resources, released tracks/audio contexts/animation frames/object URLs, and suppression of ignored late HTTP/permission results after hang-up. Priya and provider selection are unchanged.

This is not a real thirty-minute call, a Hindi accent test, a natural-language quality score or evidence of acoustic echo/lip-sync correctness. The [physical-device protocol](REAL-DEVICE-CALL-QA.md) remains unsigned. The new combined focused controller/listening/speech/turn-adapter run passed 51/51; the full fresh active web suite passed 301/301 across 40 files. Required workspace lint/typecheck passed with active web fresh and 11 unrelated workspace tasks cached; the workspace test invocation reused 12 unrelated tasks. Fresh Worker-runtime integration passed 24/24 across five files. The final compiled browser suite passed **90/90**, 30 per engine, zero skips/retries/flakes, in 156 seconds including build/startup. [Scenario and automated/manual-review evidence](../audit/readiness-2026-09-13-continuation/browser-verification.json). The optional Next webpack build also passed (55 static pages). Final exact committed-source artifact verification is recorded with the GitHub handoff.

## Source-loss denial is verified; successful recovery still needs an authority

The new regression captures an authentic snapshot and independent ledger through sequence 1, acknowledges account deletion at sequence 2, and physically deletes the source SQLite file **before obtaining retirement proof**. The actual restore orchestrator cannot reach the source and leaves the target quarantined. Manually importing authentic old ciphertext does not unlock it. [Content-free evidence](../audit/readiness-2026-09-13-continuation/source-loss-denial.json).

This proves refusal to resurrect uncertain deleted data, not successful source-loss disaster recovery. The [recovery guide](ENCRYPTED-BACKUP-OPERATIONS.md#source-loss-admission-design-and-indispensable-activation-decisions) specifies the missing independent authority, pre-acknowledgement suppression writes, bootstrap coverage, writer epochs, fencing and partition/crash behavior. An exported signed head or `latest.json` cannot reveal a deletion acknowledged only by a source that subsequently disappeared. No safe admission flag can replace that evidence.

An owner-approved independently durable authority and archive destination, credentials/key custody, retention and availability tradeoff are required before that live protocol can be integrated. These are not billing features; an approved existing free resource is possible, but none is configured or approved here. Production backup protection remains inactive.

## External release gates remain

GitHub Actions account access, reviewed merge/exact-artifact deployment, real sender/mailbox and alert receipt, physical English/Hindi/Hinglish voice/video acceptance, independent security/legal/provider review, screen-reader acceptance and agreed operational ownership remain separate gates. The current PR is the delivery location; a source push does not update the public site. No real provider, microphone, email/alert recipient, production account migration, source retirement, payment or deployment is exercised by these local tests.

The public health check at 13:48:50 UTC still returned release `52fcff83-a365-41ee-a502-7413d8c2689b`, demo schema 2 and no commit SHA. A fresh read-only Worker secret-name listing contained only `INWORLD_API_KEY` and `MIRA_ADMIN_KEY`; secret values were not read. No sender/alert/backup integration or delivery evidence was established. [Verification ledger](../audit/readiness-2026-09-13-continuation/verification.json). The dependency audit again permitted only the two exact mitigated mobile-tooling exceptions expiring September 27, not a blanket package exception or security sign-off. [Current audit](../audit/readiness-2026-09-13T13-42-58-104Z/dependency-audit.json).
