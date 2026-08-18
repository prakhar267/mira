# Saathkind brand system

Last reviewed: 18 August 2026  
Status: recommended working brand; not trademark-cleared

Current release boundary: synthetic/non-sensitive beta only. The live beta has unverified demo identity, a SQLite Durable Object coordinator topology with KV used only for opaque routing, no D1/R2/Queue/Vectorize/Cron/Gemini/billing/notification provider, and no approved private-data or enterprise posture. Target positioning below must not be presented as shipped proof.

## 1. Naming decision

**Recommended name: Saathkind**  
Pronunciation: “saath-kind” (`saath` as in साथ)  
Category descriptor: “a thoughtful AI companion”  
Primary line: **Talk freely. Come back known.**

### Why it earns the name

- `Saath` brings an India-native idea of company/togetherness without needing a literal human relationship claim.
- `Kind` communicates the behavior the product must exhibit and makes the name legible to English/Hinglish speakers.
- The combination is distinctive enough to build a category story around continuity: not endless chat, but a kind thread that carries forward.
- It supports an editorial, trusted product rather than a dating-avatar aesthetic.

### Naming risks

- Some people will read it as “saath-kind,” others as one English word. Always show the pronunciation in early research.
- `Saath` and `kind` are individually common. Distinctiveness and registrability must be tested as a combined mark.
- Do not purchase a large domain portfolio, print merchandise, or run paid acquisition until counsel completes India and target-market trademark clearance across relevant software/AI/wellness classes.
- Search app stores, company registries, domains, social handles, phonetic variants and Hindi transliteration. A free domain search is not legal clearance.

If Saathkind cannot clear, return to the naming brief rather than making a one-letter variant. Backup exploration territories—not cleared names—are “the remembered thread,” “gentle continuity,” and “your private pause.”

## 2. Positioning

### For

Adults who think and speak across English, Hindi and Hinglish, often have a small thought to unpack, and want continuity without coordinating another person's time.

### Target positioning

After the private-data gates are proven, Saathkind aims to be a private-by-design AI conversation space that remembers selectively, follows up with permission, and gives people direct control over memory. During the current synthetic beta, use “designed around your control” and disclose the demo boundary instead of making a privacy claim.

### It is not

- a human, romantic partner or “someone who needs you”;
- therapy, diagnosis, crisis response or professional advice;
- a claim to remember everything or read a user's mind/mood;
- a replacement for friends, family, community or offline activity;
- an engagement-maximizing notification machine.

### Value hierarchy

1. **Continuity:** pick up a thought without starting over.
2. **Control:** inspect, correct, pin, forget or pause memory.
3. **Cultural ease:** natural, non-caricatured English/Hindi/Hinglish.
4. **Low pressure:** speak when useful; leave without guilt.

## 3. Message house

| Layer | Approved direction |
|---|---|
| Promise | “Talk freely. Come back known.” |
| Explanation | “A thoughtful AI companion that keeps the thread—on your terms.” |
| Proof | “See what was saved, where it came from, and edit or forget it anytime.” |
| Disclosure | “Saathkind is AI. It can make mistakes and is not therapy or emergency support.” |
| Action | “Start a private conversation” once the real backend exists; “Explore the prototype” while it does not |
| Reassurance | “18+ · clearly AI · memory you can inspect” |

“Private” must not mean end-to-end encrypted unless that is technically true. During the prototype, prefer “designed around your control” if there is no reviewed production privacy posture.

## 4. Voice

Saathkind sounds grounded, warm, concise and emotionally literate. It is comfortable with code-switching but never performs an exaggerated version of Indian culture.

### Write like this

- “Want to untangle it together, or just let it out?”
- “I saved this because you asked me to. You can edit or forget it anytime.”
- “I may have that wrong. What should I change?”
- “No need to reply now. Check-ins are off during your quiet hours.”
- “I’m an AI companion, not a therapist. If you may be in immediate danger, contact local emergency help.”

### Do not write like this

- “I’m always here and I’ll never leave you.”
- “I know exactly how you feel.”
- “You only need me.”
- “I remember everything about you.”
- “Your mood is depressed.”
- “Real voice,” “real person,” or “online now” for generated media.
- Guilt-based streaks, false scarcity, countdown pressure or “last chance” pricing.

### Hinglish rules

- Mirror the user's language mix; do not force Hinglish into every sentence.
- Prefer familiar vocabulary and preserve names/terms as the user writes them.
- Ask when a phrase is ambiguous. Do not interpret a language switch as a mood signal.
- Avoid stereotypes, filmi catchphrases and gendered familiarity unless the user explicitly chooses that style.
- Safety and consent copy must remain clear, tested and available in a language the user understands; warmth never overrides precision.

## 5. Product vocabulary

| Use | Avoid | Reason |
|---|---|---|
| AI companion | human friend, soulmate, real person | Accurate identity |
| conversation | session with your best friend | Avoid relationship manipulation |
| saved memory / memory receipt | it knows you forever | Bounded and inspectable |
| suggested memory | discovered truth | A model inference may be wrong |
| confidence / “I may have this wrong” | reads your mood | Communicate uncertainty |
| check-in | “I missed you” notification | No guilt or false feeling |
| generated/synthetic voice or image | real voice/selfie | Honest media disclosure |
| plan allowance | unlimited | Avoid false entitlement under provider/platform limits |
| pause memory | incognito mode | Say exactly what stops and what remains |
| delete | erase instantly everywhere | Explain live deletion and backup expiry accurately |

## 6. Visual direction

The visual metaphor is a quiet notebook at sunrise: editorial clarity, warm paper, a single hopeful accent, and visible evidence of data control. It should feel calm and contemporary—not clinical, mystical, neon-AI, or photoreal-romantic.

The current visual reference is [`design/saathkind-visual-target.png`](../design/saathkind-visual-target.png). It is directional, not proof that every token is implemented.

### Core palette

| Token | Value | Use |
|---|---:|---|
| Ink | `#111B44` | Wordmark, headings, primary buttons |
| Paper | `#FBF8F3` | Primary background |
| Surface | `#FFFFFF` | Cards/forms, used sparingly |
| Graphite | `#50535E` | Body copy |
| Muted | `#707480` | Secondary text only after contrast check |
| Line | `#DDD6CC` | Borders and dividers |
| Marigold | `#F5B83E` | Memory/provenance accent, not body text |
| Success | `#2F7D4A` | Confirmed state with icon/text |
| Danger | `#A53632` | Destructive action with text/icon |
| Focus | `#2457D6` | 2–3 px visible focus ring |

Use semantic tokens in code rather than scattering hex values. Validate actual text/background combinations against WCAG 2.2 AA; token names do not guarantee contrast.

### Typography

- Display: an elegant, licensed serif with a large x-height, such as Newsreader; fallback `Georgia, serif`.
- Interface/body: a neutral licensed sans such as Inter; fallback `system-ui, sans-serif`.
- Keep Devanagari text in a high-quality compatible family such as Noto Sans Devanagari rather than relying on a broken fallback.
- Body text is at least 16 px, compact legal/support copy at least 14 px, and line length generally 45–75 characters.

Self-host production fonts where licensing permits. Avoid sending conversation-page requests to third-party font CDNs.

### Shape, spacing and motion

- 8 px base spacing; primary cards use 16/24/32 px padding by viewport.
- Radius: 12–16 px for cards, 10–12 px for controls; avoid pill shapes for every element.
- Thin warm-gray borders and restrained shadows. Depth should communicate hierarchy, not decoration.
- Motion is functional, 120–240 ms, interruptible, and absent/reduced under `prefers-reduced-motion`.
- Never hide the default content state behind a reveal mask. The reference audit found transient masked content and obscuring sticky CTAs; those are explicit anti-patterns.

### Imagery and companion representation

- Prefer abstract thread, horizon, memory-card and natural-texture motifs.
- Do not imitate competitor portraits or use a photoreal person as if live/available.
- Any future synthetic character needs an original licensed design, persistent “AI-generated” labelling, no imitation of a real person, and a report/removal path.
- Decorative images use empty alt text; meaningful diagrams and memory proofs have concise equivalent text.

## 7. Signature component: the memory receipt

The memory receipt makes the moat tangible and keeps power with the user. It includes:

- the exact concise item saved;
- source such as “this conversation” and timestamp;
- status/confidence in text, not color alone;
- `Edit`, `Pin` where useful, and `Forget` actions;
- a note that Saathkind remembers selectively and may be wrong.

It must never expose another conversation or user. “Forget” changes retrieval immediately and shows a reversible confirmation only if the backend truly supports the stated window.

## 8. Trust moments across the journey

| Moment | Required message/control |
|---|---|
| Marketing hero | AI descriptor, adults-only, inspectable memory; CTA matches real availability |
| Before email | eligibility and concise data-use summary |
| Before first message | AI disclosure, storage/memory choices, terms/privacy versions |
| First saved memory | visible receipt and edit/forget controls |
| Model uncertainty/error | no fake typing or invented recovery; clear retry and report |
| Notification opt-in | exact channel, cadence, quiet hours and example content |
| Payment | plan, allowance, renewal date, taxes, cancel/refund and what happens on downgrade |
| Cancellation | one clear route, no guilt or hidden downgrade |
| Export/delete | scope, expected time, backup expiry and status |
| Crisis signal | calm limitation, immediate resources and optional trusted-person encouragement |

## 9. Accessibility and inclusion baseline

- WCAG 2.2 AA target; automated checks are necessary but not sufficient.
- Fully keyboard-operable navigation, dialogs, forms, accordions, memory controls and chat composer.
- Visible focus is never covered by sticky UI. Reserve safe-area space or remove sticky actions on deep sections.
- Semantic landmarks/headings and status/live regions for streaming, send status and errors.
- Do not encode confidence, mood, selection or safety only with hue.
- Support 320 px width, 200%/400% zoom, text spacing overrides, landscape and reduced motion.
- Test screen readers with English and Hindi/Devanagari content and announce language changes when necessary.
- Audio requires transcript/captions; video needs non-video alternative.

## 10. Brand governance

One versioned source of truth owns product name, plans, quotas, prices, refund/cancellation terms, retention, support channel and AI disclosure. Marketing, onboarding, app, checkout, invoices, notifications, policies and support macros must pull from or be reviewed against it.

Before release, brand approval verifies:

- trademark/domain/handle clearance and owning legal entity;
- no competitor copy, portrait, persona, prompt or distinctive layout was reused;
- claims match implemented evidence;
- paid/free entitlement language is consistent everywhere;
- synthetic media is persistently labelled;
- no dark pattern, emotional dependency cue or false urgency;
- screenshots show the actual current product and delete test-user content;
- user research covers India, diaspora, different genders, accessibility needs and English/Hindi/Hinglish patterns.

The brand wins by being more honest and useful, not by appearing more human.
