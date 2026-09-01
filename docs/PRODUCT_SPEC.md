# Luma product specification

Last updated: 31 August 2026

## Product promise

Luma is an original adults-only AI companion. The product is built around presence rather than a chat box: the user sees Luma, talks or calls, observes a reaction, creates a memory, and returns to a relationship that has continuity.

## Primary user outcome

Opening the app should feel like entering a persistent character's life. Luma already has a mood, place, activity, relationship context, and something relevant to say. The user can connect through chat, voice, video, activities, dates, photos, and small room or wardrobe changes without hunting through a dashboard.

## Core loop

```text
see Luma → talk or call → she reacts → she remembers
→ do something together → create a moment → relationship continues
```

## Product surfaces

- Public: landing, pricing, safety, login, signup, recovery, verification.
- Onboarding: welcome, adults-only eligibility, presentation, appearance, style, personality, flirtiness, relationship, voice, interests, first meeting.
- Primary: Home, Chat, Moments, Companion, You with a globally available call action.
- Supporting: voice call, video call, album, activities, virtual dates, wardrobe, room, memory, people, future events, notifications, privacy, subscription, settings.
- Operations: metrics, providers, flags, subscriptions, and aggregate safety overview without private conversation content.

## Relationship model

Stages are New, Getting to Know You, Close, Very Close, Special, and Partner. Progress uses elapsed time, meaningful conversations, memory depth, calls, and shared activities. It never uses guilt, punitive streaks, jealousy, exclusivity, or message-spam grinding. Users may always choose or change relationship mode directly.

## Adult romance

Romantic and sensual settings require confirmed adult eligibility and explicit opt-in. The user controls friendliness, affection, flirtiness, playfulness, romance, sensuality, humor, and initiative. Sensuality changes tone and warmth; it is not a mechanism for explicit content. The companion never discourages real-world relationships or claims that the user needs only the AI.

## Demo account

The credential-free demo opens directly into a populated Luma relationship with seeded chat, memories, moments, photos, outfits, environments, calls, events, and wallet history. Every primary control produces a visible mock result.

## Acceptance boundary

Mock mode must demonstrate the complete product journey without provider credentials. Public production additionally requires real identity, Postgres/pgvector, Redis, object storage, AI/speech/vision/image providers, WebRTC signaling, billing, notifications, age assurance, security review, safety operations, and legal approval.
