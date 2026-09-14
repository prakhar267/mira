# Avatar performance follow-up — 14 September 2026

This work addresses the measured avatar bottleneck. It does **not** certify physical-device calls, provider conversation quality, audible latency or perceptual lip-sync. Priya, transcription/chat providers, user data, consent and payment configuration are unchanged.

## Implementation

- Lossless buffer repacking reduces the VRM from **10,776,032 to 9,001,324 bytes (16.47%)**. All **898 buffer-view payloads** were compared against the original Git blob and are byte-identical. All remaining JSON data is identical after excluding the necessary buffer offsets/length. Textures, geometry, morphs, bones, expression indices and embedded licensing are not recompressed, simplified or replaced.
- The deterministic compactor is `apps/web/scripts/compact-avatar.mjs`; `assets:avatar` runs it and `assets:check` fails if the committed asset is not compacted. Unit tests check preservation, idempotence, invalid containers and the shipped asset's documented SHA-256. Original bytes remain available in Git history.
- The renderer uses the existing library's [skeleton and morph optimizers](https://pixiv.github.io/three-vrm/docs/classes/three-vrm.VRMUtils.html). The extra MToon inverted-hull outline pass is omitted to reduce duplicate skinned draws and small-size shimmer; the textured surface remains. Anti-aliasing is retained. An earlier no-anti-aliasing experiment was rejected after screenshot review.
- Rendering is capped at 30 updates/second during speech, 20 when idle, and 12 for non-speaking reduced-motion mode. These are **maximum scheduling rates**, not promised FPS. Facial interpolation is elapsed-time-based; a stopped utterance cannot keep a stale open-mouth target.
- The backing framebuffer is limited to approximately 600,000 pixels before bounded adaptive downscaling. Sustained slow callbacks can reduce its scale to 0.75; isolated spikes/background stalls do not. Resolution never oscillates upward/downward during one call.
- Hidden tabs stop requesting animation frames and reset timing when resumed. A lost WebGL context or failed load displays the existing portrait fallback. Hang-up removes listeners, cancels animation and disposes skeleton resources as well as geometry/materials/textures.
- Eight consecutive rendering callbacks slower than 180 ms trigger a clearly labelled portrait mode for the rest of that call. This prevents sustained GPU stalls from monopolizing call controls. A new call retries animation. One isolated OS/shader stall does not trigger it. Background transitions clear the observation window. Timings above 250 ms are **not** discarded as outliers indefinitely.
- Reduced-motion changes are observed during the call. Decorative head, neck, eye and breathing offsets are suppressed while speech expressions remain available.

## Verification scope

The performance suite uses the actual compiled Worker application, VRM and WebGL renderer, with synthetic audio/microphone fixtures and blocked external provider requests. It checks three cold mobile-emulated app sessions, actual avatar drawing/load, microphone cleanup, deterministic visibility transitions and **actual WebGL context loss**. The visibility transition is a test event, not a physical phone backgrounding result.

```sh
pnpm --filter @companion/web exec vitest run --config vitest.config.ts lib/avatar-render-policy.test.ts lib/avatar-asset.test.ts
pnpm --filter @companion/web assets:check
pnpm --filter @companion/web exec playwright test --config playwright.performance.config.mjs tests/performance/app-interaction-avatar.spec.mjs
```

CI now runs this real-avatar suite in addition to the existing three-browser acceptance suite and retains the JSON measurements in its test artifact. The checks assert rendering/lifecycle behavior; they do not silently turn a slow measurement into a speed pass. App/high-load timings use SwiftShader software WebGL, 4× CPU throttle, 393×851/DPR 1 and unshaped loopback networking. Lifecycle checks use the same software renderer without added CPU throttle. A scheduling-fault test verifies actual drawing before injected stalls, explicit performance fallback, stopped drawing and usable hang-up. High-load reports identify animated versus portrait mode; callback cadence in portrait mode is **not** animated-avatar FPS. Do not compare these with physical GPU FPS, field INP, or production provider latency. Earlier baseline measurements remain in `audit/readiness-2026-09-14-handoff/performance-lab.json`.

The first PR #6 run passed three scenarios but failed a new assertion that the unthrottled software GPU must remain animated for four seconds. It legitimately entered performance portrait mode instead. That hardware-capability assumption was removed, not the production safeguard: the fault test now injects stalls immediately after actual drawing, and the separate high-load scenario still records observed cadence and rendering mode. Sustained animation on a capable physical GPU remains an external acceptance item.

The first optimization's PR CI passed functionality but measured approximately 383 ms software-renderer callback intervals and slow controls. A heavily contended Mac run also timed out. These results motivated the explicit sustained-stall fallback; they were not erased or labelled smooth. See [PR #5 evidence](https://github.com/prakhar267/mira/pull/5#issuecomment-5663161715).

## Still external

The 9 MB file remains large for a cold mobile network. Real Android/iPhone/laptop tests, network transfer measurements, fluent multilingual review and acoustic acceptance are still required. Do not advertise universal smoothness or a guaranteed response time from this work.

Separately, the verified Cloudflare account ID has been configured in GitHub's `production` environment. The scoped API token is **not** configured. The browser dashboard required sign-in at this check; personal Wrangler OAuth was not copied to GitHub. Recovery sender, independent backup destination/key custody, incident destination/ownership and independent reviews still need approved inputs. No provider calls, real-recipient emails, paid services or production-data exports were used for these changes.
