# Companion tools verification — 26 September 2026

The full active website and the four new feature groups now pass the 95% code-coverage requirement. Coverage measures executed source paths; it is not a percentage of real-world journeys that work.

## Measured coverage

| Scope                  |         Statements |           Branches |          Functions |              Lines |
| ---------------------- | -----------------: | -----------------: | -----------------: | -----------------: |
| 17 new feature modules |   99.88% (892/893) |   97.81% (762/779) |     100% (199/199) |     100% (835/835) |
| Entire active website  | 97.41% (8710/8941) | 95.10% (6682/7026) | 96.76% (1886/1949) | 99.38% (6348/6387) |
| Entire active website — Linux x64 | 97.40% (8709/8941) | 95.10% (6682/7026) | 96.71% (1885/1949) | 99.37% (6347/6387) |

Both scopes on macOS and Linux now meet the 95% minimum on all four metrics. Every feature module individually meets it; the complete website gate applies to the aggregate of all active production source. These are V8 measurements from component/unit/route tests, including previously untested files. Browser and workerd execution is separately verified and is not added to this report.

The feature run passed 202 tests across 8 files. The full website run passed 1,399 tests across 85 files; feature tests are a subset, not additional tests. The real workerd/SQLite integration suite passed 56 tests across 8 files. The workspace lint, type checking, unit tests and production Next build passed. Committed asset checks passed using official Node 24.18.0. Dependency/parser checks passed subject to the existing, narrowly scoped mobile-tooling advisory exceptions recorded in the dependency policy; those exceptions expire on 27 September 2026.

The production-compiled browser-to-database journey passed in Chromium, Firefox and WebKit (3/3). The separate browser regression suite passed 126/126, including accessibility, account flows, narrow layouts, chat streaming, microphone cleanup, voice playback and all four companion tools. Both suites built the source afresh, ran sequentially and used zero retries. Real avatar-rendering checks and three independent compiled-artifact cold-start checks are also required by CI before it seals a promotable artifact. Exact release identity and post-deploy outcomes are retained in the release evidence.

Reproduce the checks with the repository's pinned Node.js version:

```sh
pnpm --filter @companion/web test:coverage:features
pnpm --filter @companion/web test:coverage --maxWorkers=1
pnpm --filter @companion/web test:worker
pnpm --filter @companion/web typecheck
pnpm --filter @companion/web lint
pnpm --filter @companion/web test:e2e
pnpm --filter @companion/web test:browser
```

Run the build-backed browser commands sequentially because they write the same compiled artifact. Live provider checks are manual and separate from these synthetic checks.

## Coverage contract

`pnpm --filter @companion/web test:coverage:features` enforces at least 95% of statements, branches, functions and lines **in each file**, not just on average. The source list is checked in at `apps/web/tests/feature-coverage-scope.json`: four React panels, five API routes, search/reflection/voice helpers, reminder scheduling/storage/delivery, the service worker and the provider-error translator added during this audit. Unimported files count against coverage. A second check requires every listed file to appear with executable lines, preventing transform failures from silently inflating the percentage. There are no coverage-ignore directives.

The full website report uses `pnpm --filter @companion/web test:coverage`. Its denominator includes all executable `app`, `components`, `lib`, `worker.ts` and `public/sw.js` source, including previously untested UI. Tests, declarations, build scripts and the archived prototype are outside that denominator. Existing application integrations are included here rather than removing their untested lines to inflate the feature report.

Reports are generated under `apps/web/test-results/coverage-features` and `apps/web/test-results/coverage-website`. CI enforces both the per-file feature minimum and the whole-website minimum and retains HTML, JSON and LCOV evidence. No production modules or branches were excluded to obtain this result.

## Verification layers

- Component/unit tests exercise interactions, validation, cancellation, stale responses, permission changes, retries, DST/quiet hours, deletion, owner isolation, encrypted delivery and duplicate suppression.
- `test:worker` executes API handlers and SQLite Durable Objects in real workerd, with synthetic external service bindings.
- `test:browser` runs existing compiled-app acceptance in Chromium, Firefox and WebKit, including mobile layout and accessibility. These use HTTP fixtures; they do not prove browser-to-database integration.
- `test:e2e` adds a continuous journey through the production-compiled app, real HTTPS Secure/HttpOnly sessions, API routes and SQLite. No application API responses are mocked. External AI/push providers and audio/push hardware are simulated; outbound network access is denied. Each journey checks old transcript search, selected-entry reflection/save, voice persistence across reload, reminder opt-in/off, source deletion and QA-account deletion/session invalidation.
- The explicitly invoked `scripts/live-feature-check.mjs --run-live` creates a temporary synthetic QA account against production, with a fixed per-run budget of one reflection, one preset preview and one short synthesis. It is not in CI. The account is deleted afterward; cookies/passwords are never reported. No email or push subscription is created. This verifies API responses, not subjective sound quality or physical notification receipt.

The complete test command also passed in an isolated Linux x64 container with Node 24.18.0, pnpm 11.19.0 and GitHub Actions environment flags: 13 workspace tasks, including all 1,399 website tests, completed in 91 seconds. Both Linux coverage gates passed. A diagnostic run caught a fixture crossing a rate-limit minute boundary; freezing only Date in that fixture removed wall-clock dependence. This changed tests, not production rate limiting.

## Fixes found during verification

- Camera preview attaches after the video element mounts. Closing while permission/session startup is pending stops late-arriving tracks and prevents further camera acquisition.
- Realtime setup failures close acquired media, the data channel, peer and audio attachment; disconnect is idempotent.
- A failed microphone/recorder startup now aborts recognition/transcription and releases the audio graph and owned tracks.
- Withdrawing AI consent clears the visible active voice state.
- A negated request such as “don’t reply in Hindi” no longer selects Hindi; explicit Roman-Hindi language requests remain supported.
- Reminder time-zone suggestions no longer corrupt the field’s accessible name.
- Known Cloudflare quota errors produce `PROVIDER_DAILY_QUOTA`, HTTP 429, a reset-time message and `Retry-After`, instead of a generic 503. Chat and reflection regression tests cover this response.

## Live verification boundary

Before promotion, the live source was `585d43b48b03e2a83a4b0b60ce7576c44c9a3bc5`, Cloudflare version `71f046e9-db1d-4193-9a93-bba9cbabe018`, at <https://luma-companion.prakhargupta267.workers.dev/>. Production account creation, saved search/context, voice catalogue/preview, voice persistence/synthesis, paused reminders, opt-in enforcement and QA-account deletion passed. AI reflection failed; one bounded diagnostic confirmed exhaustion of Cloudflare’s shared free daily allowance of 10,000 neurons.

[Cloudflare documents the allowance and 00:00 UTC reset](https://developers.cloudflare.com/workers-ai/platform/pricing/) (05:30 IST). No paid-plan upgrade was performed. A quota response is not evidence of successful AI generation. The owner-CLI promotion deployed the exact locally tested and sealed artifact from source `a8283276dadb114328b7ad73295ffad01f8b4e0a`, Cloudflare version `96e6f612-f5bb-4ba5-b517-0e3ef35f8115`. All five post-deploy smoke checks passed, including exact release correlation. The live feature check passed search/context, real voice preview/synthesis, voice persistence, optional-reminder settings, opt-in enforcement and account/session cleanup. Reflection returned the corrected HTTP 429 `PROVIDER_DAILY_QUOTA`; successful generation remains unverified. Subsequent commits change verification and documentation only.

Hosted CI is a separate unresolved result. Runs stopped reporting progress during workspace tests and did not provide retrievable logs after cancellation. CI now has bounded concurrency and separate lint, typecheck, test and build stages; the equivalent local macOS and isolated Linux commands pass. No hosted-CI success is claimed. See the [current workflow status](https://github.com/prakhar267/mira/actions/workflows/ci.yml) and retained diagnostic logs.

Physical notification receipt and subjective voice/microphone quality require human device participation. Chrome’s notification permission prompt was requested in the dedicated QA tab, but no permission or device confirmation was received. A later device check found the Mac locked, blocking further native UI testing. The temporary device-test account was deleted and its original session was verified to return HTTP 401. Automated push delivery, cancellation and service-worker tests do not substitute for physical confirmation.

Evidence is retained under ignored `apps/web/test-results/`: `coverage-release.log`, `coverage-website/`, `features-release.log`, `coverage-features/`, `workspace-release.log`, `worker-release.log`, `assets-release.log`, `dependency-release.log`, and the release browser/live logs. Failed exploratory runs are separate from final results. CI retains its own reports and the sealed release artifact.
