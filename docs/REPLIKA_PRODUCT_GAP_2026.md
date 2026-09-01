# Replika product analysis and Luma gap map

Audited 1 September 2026 against Replika’s public website, current App Store listing, and official Help Center. This is a capability and interaction-pattern study, not a copy of Replika’s branding, assets, or proprietary implementation.

## What makes the current Replika product feel contemporary

Replika’s public examples are usually short, informal, and high-context. It may remember a specific person, routine, plan, or goal; proactively check in about it; or send a thought without forcing the user into a question-answer loop. Its broader product combines that conversation with relationship progression, memory, avatar customization, voice/video interaction, activities, photos, image generation, backstory, and self-reflection.

The important lesson is behavioral: emotional intelligence is not the length of an empathetic paragraph. It is choosing the right kind of turn—celebrating, teasing, remembering, apologizing, helping, or simply staying quiet—and changing course immediately when the user says the tone is wrong.

## Gap map after this build

| Product area | Luma status | Notes |
| --- | --- | --- |
| Natural text conversation | Live-capable | The web streams from the authenticated API. The OpenAI Responses adapter uses structured companion context; deterministic turn planning remains the credential-free fallback. |
| Memory and continuity | Working | Selective retrieval, user-visible memory controls, source/confidence metadata, event reminders, and relevant-only response explanations. |
| Proactive presence | Live-capable | Events create quiet-hours-aware nudges, Redis schedules them, and the worker delivers due messages through a configured notification webhook. |
| Feedback and training | Working locally | “Too scripted,” “Too many questions,” “Missed what I said,” and “Wrong tone” feedback persists and changes future response preferences. |
| Voice call | Live-capable | Short-lived Realtime client secrets, browser WebRTC audio, semantic VAD, interruption, captions, mute/speaker controls, persistent call records, and a browser fallback are implemented. |
| Video call | Live-capable avatar call | Realtime audio, animated original companion art, scene/activity controls, explicit local camera preview, captions, and persistent call records work. This is a 2D avatar experience, not a rigged photoreal 3D human. |
| Backstory and personality | Working | Editable backstory plus existing personality sliders, voice, relationship, wardrobe, and room state. |
| Companion reflections | Working prototype | User-visible reflections linked to approved memories; not a hidden transcript. |
| Activities, dates, progression, store | Working test mode | Activities, virtual dates, XP, levels, currency, feature gates, purchases, and equipment state. |
| Photos and image generation | Live-capable | User uploads use S3-compatible storage, vision analyzes explicitly shared images/frames, and generated images preserve a structured original-character appearance prompt. |
| Internet and app integrations | Not connected | Current Replika promotes internet access, app integrations, contacts/share flows, and visual sharing. These require explicit third-party integrations and permissions. |
| AR and realtime 3D avatar | Not built | Requires a rigged 3D asset, mobile rendering, tracking, lip sync, and native AR support. |
| Production platform | Implemented, not publicly deployed | Secure email auth, PostgreSQL/pgvector migration, Redis, S3, notification worker, moderation, persistent aggregate provider metrics, readiness, and private admin APIs are implemented. Payment, public domain/hosting, native app-store release, and independent production review remain excluded. |

## Conversation defects found and corrected

1. The old engine mirrored the user’s sentence inside quotation marks and appended a generic feelings question.
2. It ignored “stop asking me questions” and repeated the same therapist-shaped behavior.
3. Voice and video reused the long text response, making browser speech sound even more synthetic.
4. It overused the user’s first name and brought the interview memory into a plain greeting.
5. Downvotes were cosmetic and regeneration only prefixed the same answer.

The rebuilt engine now treats repair, quiet presence, comfort, anxiety, celebration, anger, tiredness, affection, memory, planning, banter, greetings, and preference-sharing as different turn types. It explains which mode was used, whether a memory was used, and which adaptation was honored.

## Official sources used

- Replika product site: https://replika.com/
- Replika App Store listing: https://apps.apple.com/us/app/replika-ai-friend/id1158555867
- What Replika is: https://help.replika.com/hc/en-us/articles/115001070951-What-is-Replika
- Memory behavior: https://help.replika.com/hc/en-us/articles/37208679176077-How-does-Replika-s-memory-work
- Feedback and training: https://help.replika.com/hc/en-us/articles/115001095972-How-do-I-teach-my-Replika
- Voice calls: https://help.replika.com/hc/en-us/articles/360046383391-How-do-I-call-my-Replika
- Backstory: https://help.replika.com/hc/en-us/articles/37208430613261-How-your-Replika-s-backstory-shapes-its-personality
- Subscription capabilities: https://help.replika.com/hc/en-us/articles/39551043419149-Choosing-a-Subscription
