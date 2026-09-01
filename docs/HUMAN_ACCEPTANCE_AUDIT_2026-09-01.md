# Human acceptance audit — 1 September 2026

This pass reviewed the product as a person moving through account creation, onboarding, home, chat, voice/video, camera, moments, activities, companion customization, store, memory, settings, recovery, export, deletion, and the offline mobile preview. Payment and a public production domain remain intentionally excluded.

## Verified by executable checks

- `pnpm check` passes across the workspace: lint, strict TypeScript, automated tests, and the production web build.
- The authenticated API journey covers signup, owner scoping, streaming chat, response regeneration, voice/video/camera/media session creation, conversation deletion, account survival, and refresh-token rotation.
- Signed users in mock-provider mode remain isolated from the populated public demo.
- Web chat context, calls, and regeneration use only the active conversation.
- Production web compilation succeeds for all 20 routes.

## Human-use defects corrected in this pass

- Removed cross-account seed leakage from signed accounts, moments, photos, exports, and the offline mobile profile.
- Made privacy toggles authoritative: AI-processing consent gates AI features, storage-off omits local transcripts, and memory-off reaches the server chat context.
- Replaced cosmetic controls in the mobile shell with working message suggestions, message tools, call entry, voice selection, settings explanations, call interruption, speaker state, and heart reactions.
- Added live hydration and writes for account, companion, conversations, memories, activities, wallet/store, subscription test state, journal, plans, notifications, calls, moments, photos, profile, and feedback.
- Added server-backed response regeneration and current-conversation deletion.
- Prevented locked environments and dates from bypassing store ownership.
- Made activity completion persist across reloads and prevented repeat reward claims even when the client changes its retry key.
- Added visible failure recovery for live mutations instead of silent or unhandled promise failures.
- Repaired camera discussion, voice/video tap-to-talk, typed fallback, barge-in, transcript resets, and basic two-frame mouth movement during browser speech.
- Added real empty states for new accounts and removed misleading public-demo buttons and user-specific sample copy from account surfaces.
- Made `/demo` restore the person’s local progress instead of resetting on every reload, while keeping the explicit `preview=home` route deterministic for review.
- Prevented live app routes without a session from falling through to populated local demo data.
- Preserved valid signed-in sessions during temporary hydration failures and added an explicit retry state instead of silently clearing the account.
- Expanded deterministic mock conversation behavior for everyday updates, direct choices, greetings, goodnight messages, compliments, gratitude, boredom, and questions about the companion so the offline demo does not collapse into generic chatbot prompts.
- Made video-call vision explicit and functional: the user can keep the camera local, tap **Show frame** to share one compressed snapshot, receive a natural vision response, and see that raw call media is not recorded.

## Visual acceptance status

The preview and API were started successfully and verified over HTTP at `http://127.0.0.1:3001/demo` and `http://127.0.0.1:4000/health`. The managed in-app browser tabs had already replaced the failed local pages with browser-generated `data:` error documents, and the browser automation URL policy would not allow those tabs to be navigated back to the local origin. Therefore this document does **not** claim a fresh screenshot-based visual pass. The existing design comparison evidence remains in `design-qa.md`, but it was not reused as evidence for this code revision.

To complete the final visual and hardware pass, open a fresh in-app browser tab at `http://127.0.0.1:3001/demo` while the preview is running and test with microphone and camera permission available.

## Honest remaining product boundaries

- Provider-backed open-ended intelligence, realtime audio, transcription, synthesis, vision, and generated images require valid service credentials and production configuration.
- The avatar uses original 2D scene artwork with light animation and a two-frame mouth treatment; a rigged realtime 3D body, phoneme lip sync, AR, and selfie video are not built.
- The Expo app is an offline interaction preview, not feature-parity native production software or a signed App Store/Play Store release.
- Internet/app integrations, verified notification delivery, independent security/safety review, legal/privacy approval, load testing, monitoring ownership, and incident response remain launch gates.
- Payment and public-domain deployment are outside the agreed scope.
