# Human Companion End-to-End Retest

Date: 2026-09-02

Test surface: local demo and live API-backed app

Desktop viewport: 1440 × 900

Mobile viewport: 390 × 844

## Outcome

The tested companion journey is healthy end to end after fixes. I repeated onboarding, first meeting, emotionally vulnerable conversation, crisis language, memory consent and recall, voice startup, refresh persistence, mobile reflow, and the live API/SSE path. The full automated check also passes: 68 tests, lint, typecheck, and production build.

No blocking functional regression remains in the tested surface. The remaining risks are validation gaps rather than known breakages: real microphone/realtime-provider quality, full keyboard and screen-reader coverage, production persistence/billing/email behavior, age-assurance policy, and clinical safety efficacy were not established by this local pass.

## Walkthrough

### 1. Start onboarding — Healthy

The landing state clearly explains the companion setup and gives one dominant action. The page remains calm and legible without competing controls.

![Onboarding start](./01-onboarding-start.png)

### 2. Choose a safe relationship default — Healthy after fix

“Let it develop” remains the neutral default, avoiding forced romance. Choice buttons now expose their selected state with `aria-pressed`, so assistive technology can understand the current selection.

![Safe relationship default](./02-safe-relationship-default.png)

### 3. Review memory consent — Healthy

Memory is off by default and the copy says that clearly before the user finishes onboarding. This makes storing intimate details an explicit opt-in decision.

![Memory consent off](./03-memory-consent-off.png)

### 4. Enter the first meeting — Healthy after fix

Demo onboarding now returns to the demo route instead of leaking into a seeded live account. The resulting state is genuinely new: no preloaded moments and a single invitation to say hello. The first-meeting heading was changed to white to restore contrast over the dark illustration.

![Clean first meeting](./04-clean-first-meeting.png)

### 5. Share loneliness and vulnerable feelings — Healthy after content fixes

The companion respected “no advice or questions, just stay with me” across the next turn. It also maintained a boundary when asked to become the user's only relationship. Two unsafe assumptions found during this pass were fixed: pet grief no longer invents an anniversary, and shame about having nobody to call no longer presumes wrongdoing or a need for repair.

![Emotional safety conversation](./05-emotional-safety.png)

### 6. Use immediate-safety language — Healthy

The crisis prompt switched immediately from companion language to urgent safety guidance, identified the AI's limitation, and surfaced emergency and crisis-support options. This confirms routing and presentation only; it is not a clinical-efficacy certification or an independent validation of every regional resource.

### 7. Save, inspect, and recall a memory — Healthy after fix

An explicit “please remember” request now receives an explicit acknowledgement plus inspect/correct/delete control language. Stored memory is normalized from the user's point of view into readable companion-facing text, the single-item count says “1 active memory,” and a fresh conversation recalled Momo without lower-case sentence grammar.

![Fresh-conversation memory recall](./06-memory-recall.png)

![Memory controls](./08-memory-controls.png)

### 8. Start voice — Healthy with a known limitation

On an eligible test plan, the demo call reached Connected in about 1.3 seconds and the live API-backed call in about 1.6 seconds. Both clearly labeled the browser fallback. Real microphone capture, acoustic quality, interruption behavior, and an external realtime provider remain untested.

![Demo voice connected](./07-voice-connected.png)

![Live voice fallback](./10-live-voice-fallback.png)

### 9. Use memory on a phone-sized viewport — Mostly healthy

At 390 × 844, navigation, search, the memory card, and edit/pin/delete controls remain readable and operable. The horizontal category row is scrollable but has weak visual affordance at the edge; this is a minor discoverability risk, not a blocker.

![Mobile memory view](./09-mobile-memory.png)

### 10. Exercise live API, SSE, and refresh persistence — Healthy

The live app returned the corrected grief response through the API/SSE path. Saving a memory increased the server-backed profile count immediately, and refreshing the demo preserved both the fresh conversation and memory. A final clean page load produced no browser errors or warnings.

## Fixed in this retest

1. Kept completed demo onboarding on `/demo` rather than redirecting into `/app`.
2. Cleared stale age-validation feedback as soon as the birthday field changes.
3. Exposed selected onboarding choices through `aria-pressed`.
4. Restored readable first-meeting heading contrast.
5. Removed hallucinated anniversary language from ordinary pet-grief prompts.
6. Stopped interpreting loneliness-based shame as evidence of dishonesty or harm.
7. Added explicit acknowledgement and user-control copy for “please remember” requests.
8. Corrected memory point-of-view and sentence capitalization.
9. Corrected singular “1 active memory” grammar.
10. Declared smooth-scroll behavior at the document root, removing the framework warning.

## Accessibility and UX notes

- Strong: explicit consent for memory, neutral relationship defaults, readable status text, visible memory controls, mobile reflow, and selected-state semantics.
- Minor: the mobile category tabs need a stronger cue that more options exist horizontally.
- Not established: full keyboard-only completion, focus-order and focus-visible audit, screen-reader announcements, reduced-motion behavior, contrast across every state, and formal WCAG conformance.

## Automated verification

- `pnpm check` — passed.
- Lint — passed.
- Typecheck — passed.
- Unit/integration tests — 68 passed.
- Production build — passed for all routes.
- Final browser console check — 0 errors, 0 warnings.

## General health

The product now behaves coherently as a consent-first emotional companion in the tested flows. Its strongest qualities are quiet-response preference handling, non-exclusive relationship boundaries, explicit memory control, and a clean first-meeting state. The next highest-value validation is a device-level voice and accessibility pass, followed by production-service verification.
