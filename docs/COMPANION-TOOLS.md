# Optional companion tools

Implemented in `apps/web` on 24 September 2026. This describes the source changes; deployment and physical-device notification/audio acceptance are separate from automated tests.

## Where to find them

| Feature | Location | Behavior |
| --- | --- | --- |
| Reminders | Moments → Journal, plans & reminders → Reminders (also You → Manage reminders) | Connect a browser, then choose a daily check-in or a confirmed saved plan. |
| Voice library | Wardrobe → Voice | Search provider system voices, play a preview, and select a voice. Priya remains the default. |
| Conversation search | Chat → Search conversations | Search saved messages, filter by conversation, speaker and starting date, then read messages surrounding a match. |
| Weekly reflection | Moments → Journal, plans & reminders → Weekly reflection | Select journal entries, generate a draft, then optionally save or download it. |

## Reminders

Reminders require an account and start off. Notification permission is requested only after the user clicks Enable. A connected device alone does not schedule anything. Users can choose a time zone, overnight quiet hours, and a saved-plan lead time of 0, 5, 15, 30 or 60 minutes, or one day. Equal quiet-hour times disable quiet hours. The next delivery is displayed before leaving settings. Edit, pause, delete, remove-device and disconnect-all controls are available.

The existing SQLite Durable Object alarm schedules Web Push delivery, using persistent VAPID keys and AES128GCM payload encryption. No external notification SaaS credential or new global Cron is required. Only known browser push-service HTTPS endpoints are accepted, redirects are not followed, and delivery rechecks rule/account/device ownership before dispatch. Notifications contain generic copy, never journal text, conversations or plan names. Clicking opens Reminders.

Time zones follow IANA daylight-saving rules. Missing spring-forward times move to the first available later minute; repeated hours do not cause a second check-in. Quiet-hour deliveries and retries move to the end of quiet hours. A plan cannot be scheduled after its event; at-time deliveries permit the scheduler's first minute. Old deliveries more than 30 minutes late are skipped. A delivery failure is retried at most three times, skipping devices already accepted for that occurrence. Browser notification tags also reduce duplicates; exactly-once delivery cannot be promised after a crash between provider acceptance and receipt persistence.

Changing a plan date reschedules its reminder; unrelated state saves preserve retry progress. Deleting or cancelling the plan removes the rule. Disconnecting the final device pauses all rules; reconnecting does not silently resume them. Expired push subscriptions are removed. Each account supports five devices, one daily rule and up to 100 plan rules. Rules, device metadata and acceptance status are available in account export; delivery endpoints and encryption keys are excluded. Account deletion removes subscriptions, schedules and receipts.

Delivery depends on browser support, device permissions, network access and the operating system. On iOS/iPadOS, users must add Mira to the Home Screen and enable notifications from the installed app. Provider acceptance does not prove the notification appeared. The browser push service (Google, Mozilla, Apple or Microsoft) transports the encrypted generic payload. Rule/subscription tables are intentionally absent from application snapshot recovery: a fresh store requires notification opt-in again. Reminders use no AI and remain independent of AI-processing consent.

## Voice choices

The server loads Inworld's system-voice catalog using the existing server key, caches it for one hour, and excludes private, cloned and community voices. Provider preview clips are cached for one day. Preview playback stops when the selection, consent or view changes; object URLs and pending requests are cleaned up.

Selection persists in account or browser state and is honored by spoken chat replies, voice calls and avatar calls, in both streamed and buffered speech. Existing `mira-natural-01` preferences migrate to Priya. Priya can still be used when the catalog is unavailable; a removed non-default voice gives an actionable error. Samples are provider previews, not a guarantee of quality in every language. Preview availability depends on Inworld; synthesis retains existing capacity limits and AI-processing consent. No billing or unlimited-use promise is added.

Provider contracts: [List voices](https://docs.inworld.ai/api-reference/voiceAPI/voiceservice/list-voices), [Get voice preview](https://docs.inworld.ai/api-reference/voiceAPI/voiceservice/get-voice-preview).

## Conversation search

Account search reads the authenticated user's retained transcript store, including messages older than the initial 200-message chat window. The existing beta retention bound remains 2,000 messages / 8 MB per account. Browser demo search reads browser state. Search performs Unicode normalization, case-insensitive literal substring matching, and descending date/ID pagination with 25 matches per page. It supports English, Hindi and Hinglish without sending queries to an AI provider.

Filters cover all/current conversations, speaker and a UTC starting date. Results display the speaker, date, highlighted match and up to 12 messages either side for account context. Opening context does not switch or alter the active conversation. Deleted, unsaved, failed and in-progress messages are excluded from matching. Search and context routes enforce account ownership and return no-store responses; changing a query aborts stale requests.

## Weekly reflections

Nothing is selected automatically. Users choose a 7-day, 30-day or all-entry range, then 1–14 entries totaling at most 24,000 characters. English, Hindi and Hinglish output is available. The account route reads canonical entries by the selected IDs, rejecting missing entries and ignoring client-supplied replacements. Demo mode supplies only selected browser entries.

The existing Cloudflare Gemma model receives only those entries, with instructions to distinguish facts from tentative patterns and offer one optional next step. It receives no other memories or conversations. Consent, capacity, rate limits, a provider deadline and output checks apply. The server rechecks source entries and consent before generation and before returning the result. Changing sources or cancelling suppresses an unfinished result. Four requests per five minutes is an additional route limit, not an entitlement beyond the shared AI allowance.

Drafts are labeled AI-generated and unsaved. Users may discard, download plain text or save up to 30 reflections. Saving uses the usual account synchronization and conflict handling. A reflection does not add chat messages or memories. Deleting a source entry removes its saved reflections and related rolling application snapshots; external provider retention is unchanged. Old accounts initialize an empty reflection list without replacing existing journals or preferences.

## Verification

New tests cover timezone/DST/quiet-hour scheduling, retry receipts, event rescheduling, unsubscribe/deletion fencing, endpoint validation, Unicode search and pagination, canonical selected journal content, legacy-state migration and voice filtering. Real workerd tests exercise authenticated search isolation, consent enforcement, voice preview/synthesis, persistent push subscriptions and alarm delivery through an isolated mock provider.

Playwright tests exercise all four controls in Chromium, Firefox and WebKit, including a narrow mobile search layout, preview cleanup/selection persistence, reflection retry and source deletion, explicit notification opt-in and disconnect-all. Synthetic provider and browser-media fixtures do not certify physical device receipt or acoustic quality. No real notifications or inference requests were sent by these tests.

Recorded local results: 718 unit tests, 55 workerd integration tests, and 12 new feature browser scenarios across Chromium, Firefox and WebKit passed. The account-lifecycle and streamed-audio regression scenarios also passed in all three engines (12 additional scenarios). New panels passed automated WCAG checks; mobile reflection/reminder layouts also assert the app's scroll width, not just the clipped document width. The active vinext/Cloudflare artifact built successfully during browser verification. Earlier parallel test/build runs exposed test timeouts and shared generated-type files; final unit verification used two workers, and final type generation ran after the build.
