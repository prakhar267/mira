# Luma companion parity status

Last verified: 1 September 2026

Luma follows the capability model of a modern AI companion while retaining its own name, visual identity, safety language, and interaction design. This document separates what works in the local product from integrations that still need production services.

## Working in the local product

| Capability | Status | What is implemented |
| --- | --- | --- |
| Companion chat | Working local engine | Adaptive turn planning, boundary repair, question-fatigue detection, short multi-beat replies, selective memory, real response explanations, regeneration, reply/edit actions, and spoken playback. |
| Text and voice messages | Working | Text composer, real browser speech transcription for voice notes when supported, typed fallback, photo upload, and generated prototype images. |
| Voice calls | Working browser mode | Short call-specific turns, selected browser voice profile, microphone transcription when supported, typed fallback, interruption, captions, mute, speaker, reactions, timer, and call history. |
| Video calls | Working browser mode | Context-aware short conversation, animated companion scene, scene switching, local camera preview, spoken replies, captions, activities, reactions, timer, and call history. |
| Companion presence | Working | Full-screen portrait scenes, event-aware proactive greetings, tap reactions, subtle movement, ambience state, and relationship status. |
| Avatar customization | Working prototype | Wardrobe, accessories, environment selection, personality sliders, editable companion backstory, and voice selection with persistent local state. |
| Memory | Working | User-controlled memory, categories, search, add/edit/delete, pinning, confidence/source display, and memory-aware replies. |
| Relationship | Working | Relationship stage, level, progress, affection/playfulness/romance controls, and explicit adult-mode consent. |
| Feedback training | Working locally | Downvote reasons update response length, advice style, and future question frequency. Up/down signals persist in the user’s local demo data. |
| Self-reflections | Working prototype | Inspectable companion thoughts linked to approved user memories, clearly separated from hidden transcripts. |
| Activities and dates | Working | Virtual date scenes, relationship cards, games, reflections, journaling, goal planning, XP, coins, and completion tracking. |
| Moments and media | Working prototype | Shared timeline, photos, companion selfies from approved local artwork, image prompts, and saved call/date moments. |
| Plans and store | Working test mode | Free/Plus/Ultra/Platinum feature gates, test-mode upgrades, wallets, purchases, and equipment state. |
| Privacy controls | Working | Local export, local deletion, memory toggle, storage/processing consent, quiet hours, and proactive-call frequency. |
| Responsive app | Working | Desktop and compact/mobile navigation, call layouts, chat composer, safe-area spacing, and non-overlapping controls. |

## Production services still required

These are not honestly reproducible as a fully local mock and need service credentials, infrastructure, platform permissions, or specialized media models:

- A production conversational model and retrieval service for open-ended intelligence beyond the deterministic offline engine.
- Low-latency, full-duplex realtime audio instead of browser speech recognition and speech synthesis.
- Realtime visual understanding of camera frames. The current camera is a private local preview and Luma does not claim to see its contents.
- A rigged realtime 3D avatar, AR placement, lip sync, and generated selfie-video pipeline.
- Live internet browsing, phone contacts, share extensions, and third-party app integrations.
- Production authentication, database storage, moderation operations, billing, push notifications, analytics, and app-store delivery.

## Regression coverage

The compact viewport regression covers Home → Message → adaptive feedback → Voice call → Video call, plus Moments, companion reflections, editable backstory, Photos, Activities, Call history, Profile, and Memory. Automated verification covers lint, TypeScript, unit tests, and the production build.

The focused conversation suite checks explicit no-question boundaries, quiet-company requests, greeting restraint, relevant-only memory use, question fatigue, and concise spoken turns.

## Product reference

Capability comparisons were checked against Replika’s public product and help documentation, including its subscription, memory, voice/video, and AR descriptions. This is a capability reference only; Luma does not copy Replika branding or proprietary assets.
