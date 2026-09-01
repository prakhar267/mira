# Luma UI specification

## Selected direction

The source of truth is `design/luma-v1/home-source.png`: a moonlit lavender window nook, a warm stylized-realistic companion, a call-first hero action, and five-item navigation.

## Design principles

1. Luma occupies 55–75% of the primary viewport.
2. Home is a place, never a dashboard.
3. One dominant action and no more than two supporting actions appear above the fold.
4. Interface chrome floats over the environment with strong contrast and generous touch targets.
5. Emotional copy uses a warm editorial serif; controls use a clear humanist sans-serif.
6. Every empty, loading, success, and error state speaks in the product's voice without pretending the AI is human or sentient.

## Tokens

- background: `#120f1b`
- surface: `#1c1726`
- surfaceElevated: `#292137`
- textPrimary: `#fff8f4`
- textSecondary: `#d8cbdc`
- textMuted: `#a598ad`
- accent: `#f39a88`
- accentSoft: `#f3c2bf`
- romanticAccent: `#e88bb0`
- danger: `#e06e76`
- success: `#81c6a6`
- border: `rgba(255,255,255,.14)`
- overlay: `rgba(10,7,16,.66)`
- glassSurface: `rgba(35,27,48,.68)`

Light mode uses moonlit cream surfaces, plum text, peach accent, and lavender shadow. Dark mode is warm plum/indigo rather than pure black.

## Typography

Cormorant Garamond is the emotional display face. Manrope is the UI and conversational face. Mobile body copy is never below 14px; primary controls are at least 48px high.

## Motion

Framer Motion drives page transitions, tap response, call-sheet entry, message appearance, relationship progress, memory-save feedback, and moment-card reveal on web. React Native Reanimated is the target mobile motion runtime. Reduced-motion preferences collapse movement to opacity changes.

## Responsive behavior

At 390 × 844 the selected reference is followed most closely. Tablet preserves an immersive scene with a wider floating command dock. Desktop keeps the character dominant, places the five-item navigation on the left, and moves supporting context into a restrained translucent rail.

## Navigation

The only primary destinations are Home, Chat, Moments, Companion, and You. Memory, activities, dates, album, people, events, notification, privacy, subscription, and settings are reached contextually within those destinations.
