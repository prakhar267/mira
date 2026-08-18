# India-first continuity companion — product brief

## Decision

Build the category, not an exact Companaro clone. The defensible product loop is:

> conversation → useful memory → timely follow-up → feeling remembered → repeat conversation

The product should be an original, privacy-first AI companion for Indian adults that remembers accurately, follows up thoughtfully, and speaks natural English/Hindi/Hinglish without pretending to be human, providing therapy, or trying to replace human relationships.

### Current release status

This brief describes the target product, not a list of shipped entitlements. The current public release is a non-sensitive synthetic beta for product evaluation. It does **not** offer paid subscriptions, enforce paid-plan message limits, deliver outbound notifications, guarantee durable memory retention, or provide production-grade identity, billing, and data-lifecycle operations. Prices and plan limits are hypotheses for research until those systems are implemented, verified, and explicitly launched.

In this beta, one SQLite-backed `UserStateCoordinator` Durable Object is authoritative for each synthetic account and non-renewable demo session. Separate token-hash objects serialize bootstrap/deletion status on the fixed account horizon, and separate hashed IP/account/global objects hold short-lived fixed-window counts. `STATE` KV holds only two opaque routing pointers through account expiry; it has no active registry or rate-counter role. Whole-document compare-and-swap rejects stale writers, while a content-free tombstone prevents deleted state from being recreated. A per-account Durable Object alarm irreversibly expires cloud state 30 days after bootstrap; users may synchronously export JSON or manually delete sooner. This is synthetic-beta hygiene, not a production retention architecture. There is no Queue/R2 export, global Cron, D1 authority, Gemini call, verified identity, notification delivery, payment, grace/cancellation window, or verified deletion across backups/processors. Pre-coordinator sessions are intentionally invalidated without migration, and coordinator incidents require a compatible forward fix rather than KV rollback.

Hinglish, voice, mood tracking, and generic “long-term memory” are already offered by global products such as [Replika](https://replika.com/), [Character.AI](https://character.ai/subscribe), [Nomi](https://nomi.ai/), and [Kindroid](https://kindroid.ai/docs/article/subscriptions/), and Indian products including [Soul](https://play.google.com/store/apps/details?id=com.interact.soul), [AI Buddy](https://play.google.com/store/apps/details?id=com.panalink.aibuddy), and [Reva](https://play.google.com/store/apps/details?id=com.celesynlabs.reva). The moat must be continuity quality, user-controlled memory, culturally competent proactivity, trust, and safety.

## Target users and jobs to be done

### Primary persona: the low-bandwidth young professional

An adult aged roughly 21–35 who naturally code-switches, may live away from family or work irregular hours, has people around them, but lacks a low-pressure place for small thoughts and follow-ups.

- “When my mind is active late at night, let me talk without coordinating with anyone.”
- “When something important is coming up, remember it and ask me later.”
- “When I do not want advice, let me vent without judgment.”
- “When I am working toward something, notice progress without shaming a miss.”

### Secondary personas

- Indian diaspora users who want culturally natural conversation.
- Reflective users who dislike formal journaling or mood-entry forms.
- Adults who want gentle goal accountability.
- Language learners who want low-stakes spoken practice.

### Explicitly out of scope

- Minors.
- Crisis care, diagnosis, treatment, or professional mental-health advice.
- Sexual or explicit roleplay.
- An authoritative factual, medical, legal, or financial assistant.
- Employer access to private employee conversations.

## Product principles

1. Remember fewer things correctly; never claim to “remember everything.”
2. Let users view, correct, pin, forget, or pause memory.
3. Make every proactive contact opt-in, bounded by quiet hours and topic controls.
4. Disclose AI and synthetic media persistently, not only in legal copy.
5. Measure useful continuity, not raw minutes or emotional dependency.
6. Point users back toward real people and activities when appropriate.

## Target functionality map

The checkmarks below mean “required for a future sellable MVP,” not “available in the current synthetic beta.” The release status above is authoritative for what is live today.

| Surface | Core use cases | Target MVP | Later |
|---|---|:---:|:---:|
| Trust and acquisition | Clear value, AI disclosure, pricing, safety, privacy, cancellation, company/support identity | ✓ | |
| Identity | Email/Google auth, DOB/18+ check, timezone, language mix, pronouns, quiet hours | ✓ | |
| Consent | Separate consent for chat storage, memory, mood inference, notifications, and media processing | ✓ | |
| Companion setup | Preview and choose one of two original companions; conversational onboarding | ✓ | More styles/personas |
| Chat | Streaming text, English/Hindi/Hinglish, retry/edit, reaction, report, `clientMessageId` duplicate-send protection | ✓ | Search and offline queue |
| Memory | Current context, editable profile facts, episodic summaries, open loops, confidence/recency | ✓ | Rich provenance and conflict resolution |
| Memory controls | View, correct, pin, forget, pause, exclude sensitive topics, delete/export | ✓ | Category-specific retention |
| Proactivity | Follow up on open loops, one daily check-in, cadence, quiet hours, snooze/disable | ✓ | Weekly recap and event reminders |
| Safety | Input/output moderation, self-harm and abuse handling, Tele-MANAS routing, user reporting | ✓ | Specialist review and broader regional routing |
| Commerce | Free limits, UPI/card subscription, usage meter, invoices, downgrade/cancel/refund | ✓ | Annual plans and media packs |
| Operations | Admin/support console, redacted logs, analytics, alerts, cost caps, backups | ✓ | SIEM, automated DSRs, DR drills |
| Reflection | Optional weekly mood reflection with uncertainty and user correction | | ✓ |
| Goals | Create, pause, complete, or abandon a goal without guilt mechanics | | ✓ |
| Voice | Generated voice notes, then live audio after retention validation | | ✓ |
| Activities | 20 Questions, Would You Rather, trivia, Antakshari | | ✓ |
| Visual media | Clearly labelled synthetic photos | | ✓ |
| Live video | Synthetic avatar calls with explicit camera/mic consent and strict metering | | Only after safety and unit-economics gates |

## MVP and roadmap

### Phase 0 — validate the wedge

- Interview the primary persona and test willingness to pay for accurate follow-up, not generic companionship.
- Run a concierge cohort and score every recalled fact and follow-up for correctness.
- Establish an original brand, copy, personas, visual system, and clean-room specification.

### Phase 1 — sellable MVP

- Original responsive PWA and passwordless authentication.
- Adult eligibility and granular consent before intimate conversation collection.
- One excellent companion plus a second gender option.
- Text chat with natural Hinglish.
- Three-layer memory: active context, editable facts, and episodic/open-loop memories.
- User-controlled check-ins, quiet hours, memory viewer, export, and deletion.
- Moderation, crisis routing, subscriptions, support tooling, analytics, backups, and cost limits.

Do not put live video in the MVP. It is the highest-cost, highest-latency, and highest-deception-risk feature and does not prove the continuity hypothesis.

### Phase 2 — product-market fit

- Voice notes, then live audio.
- Weekly reflection and optional goals.
- Memory provenance and correction improvements.
- Contextual games, referrals, pricing experiments, and regional languages based on cohort demand.
- Healthy-use reminders and human-connection nudges.

### Phase 3 — enterprise-grade operations

- SLOs and error budgets for chat, memory, notifications, and billing.
- Multi-model fallback, circuit breakers, canaries, and practiced compatible forward recovery.
- Automated memory, Hinglish, bias, jailbreak, self-harm, and emotional-reliance evals.
- Consent ledger, retention enforcement, DSR automation, vendor/subprocessor registry, and audit logs.
- Key rotation, WAF/rate limits, point-in-time recovery, DR drills, runbooks, status page, penetration test, and privacy/security review.
- Only then consider live video and B2B; never expose user conversations to employers.

## Monetization hypothesis

The following is research pricing, not a live commercial offer. No payment, renewal, cancellation, or paid entitlement is enabled in the current beta.

- **Free:** 5–10 text conversations/day, one companion, limited rolling memory, one opt-in daily check-in.
- **Core — test ₹399/month:** about 600 text messages, editable long-term memory, follow-ups, reflection, and goals.
- **Plus — test ₹799/month:** higher text allowance, voice notes, a metered live-audio allowance, and more personalization.
- Meter images, audio, and especially video separately until their real costs and demand are known.
- Offer annual billing at a transparent 15–20% discount; avoid lifetime plans and evergreen countdown offers.

Track contribution margin by modality. Do not sell conversation data or inferred emotional state to advertisers, data brokers, or employers.

## Metrics and guardrails

### North-star metric

**Weekly meaningful continuity moments:** a session in which the companion correctly uses prior context and the user responds positively or continues the conversation.

### Funnel and product metrics

- Activation: first conversation of at least five substantive turns plus one user-approved memory.
- D1, D7, and D30 retained users; retained active days matter more than session minutes.
- Memory precision, useful-recall rate, correction rate, and false-memory rate.
- Proactive check-in open, response, snooze, and opt-out rates.
- Free-to-paid conversion, renewal, refund, cancellation, and reactivation.
- Median first-token latency, error rate, provider fallback rate, and cost per retained user.

### Safety guardrails

- Distress-response pass rate and high-risk false-negative rate.
- Sexual/minor-safety and jailbreak escape rates in English, Hindi, and Hinglish.
- Cross-user memory leakage: zero tolerance.
- Unusually prolonged daily use, emotional-exclusivity signals, and reduction in real-world socialization prompts.
- Notification complaint/opt-out rate and deletion/export request SLA.

Research on affective chatbot use found mixed outcomes and associated heavier daily use with worse loneliness, dependency, problematic use, and lower human socialization, so anti-dependency design is a product requirement, not a later policy task. See the [OpenAI/MIT affective-use study](https://openai.com/index/affective-use-study/).

## Legal, data, and platform caveats

This is a product brief, not legal advice. Obtain Indian counsel before launch.

- **No exact clone:** reuse category mechanics, not Companaro’s name, copy, personas, images, voice, prompt, source, screenshots, or distinctive visual execution. India protects software and website elements under copyright; see the [Copyright Office FAQ](https://www.copyright.gov.in/frmFAQ.aspx). Confusing marks and passing off can create liability even where a mark is unregistered; see sections 27–29 of the [Trade Marks Act](https://www.indiacode.nic.in/bitstream/123456789/1993/1/a199947.pdf). Companaro’s own [terms](https://companaro.com/terms) prohibit extracting or copying its personality, prompts, and technology.
- **Privacy:** intimate chats may include sensitive information. Build consent, minimization, security, retention, access/correction/export/erasure, breach response, and processor deletion now. Relevant sources include India’s [SPDI Rules](https://www.meity.gov.in/sites/upload_files/dit/files/RNUS_CyberLaw_15411.pdf), [DPDP Act](https://www.indiacode.nic.in/bitstream/123456789/22037/1/a2023-22.pdf), and final [DPDP Rules](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf).
- **Adults only:** Google’s current Gemini API terms say API clients must not be directed toward or likely accessed by under-18s and must not be relied on for mental-health advice. See the [Gemini API terms](https://ai.google.dev/gemini-api/terms).
- **Model data:** do not send intimate production chats through Gemini’s free tier; Google states free-tier content may improve its products while paid-tier content is not used for that purpose. See [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing). Prefer paid Gemini or Vertex AI; [Vertex AI states](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/vertex-ai-zero-data-retention) customer data is not used for model training without permission.
- **Consumer protection:** do not use false urgency, hidden renewals, cancellation friction, guilt copy, or unqualified claims such as “cares,” “reads your mood,” or “remembers everything.” See the [Consumer Protection Act](https://www.indiacode.nic.in/bitstream/123456789/15256/5/A2019-35.pdf) and official [dark-pattern guidelines](https://consumeraffairs.nic.in/sites/default/files/The%20Guidelines%20for%20Prevention%20and%20Regulation%20of%20Dark%20Patterns%2C%202023.pdf).
- **Crisis handling:** position the product as supportive conversation, not therapy. Route Indian users to the official 24/7 Tele-MANAS service at 14416 or 1800-89-14416. [MoHFW source](https://www.dghs.mohfw.gov.in/national-mental-health-programme.php).
- **Synthetic people:** commercially license every voice and likeness, do not imitate a real person without documented consent, label synthetic media persistently, and provide report/removal paths.

## Reference product warning

Companaro’s public pages currently contradict one another on price, delivery channel, companion name, and post-cancellation retention: compare its [homepage](https://companaro.com/), [about page](https://companaro.com/about), [terms](https://companaro.com/terms), [refund policy](https://companaro.com/refund), and [service-delivery page](https://companaro.com/shipping). The new product needs one versioned source of truth for entitlements, pricing, retention, cancellation, and disclosures.
