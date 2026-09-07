# Mira — Product Hunt launch kit

## Submission fields

- Product name: `Mira`
- Website: `https://luma-companion.prakhargupta267.workers.dev`
- Pricing: `Free`
- Status: `Free public beta`
- Tagline (43/60 characters): `An AI companion that remembers what matters`
- Description (under 260 characters): `Mira is an adults-only AI companion for natural English and Hinglish conversation, hands-free voice, expressive avatar calls, and memory you can inspect, correct, pause, or forget. Launching as a free public beta—no payment required.`
- Suggested topics: `Artificial Intelligence`, `Chatbots`, `Lifestyle`
- Suggested shoutouts: `Cloudflare`, `Next.js`, `Inworld AI`

Use the direct website URL above. Do not add tracking parameters or a shortened redirect to the Product Hunt website field.

## First maker comment

Hi Product Hunt — I’m Prakhar, the maker of Mira.

I started this because most AI conversations still reset emotionally, even when the model remembers a few facts. I wanted to explore a companion that feels continuous across text, hands-free voice, avatar calls, activities, and the small moments you come back to.

Mira’s memory is deliberately visible. You can inspect what she remembers, correct it, pin it, pause memory, or forget something. She is clearly disclosed as AI, is for adults only, and is not therapy or emergency support.

This is a free public beta, so please avoid sensitive information. I would especially love feedback on three things: whether English/Hinglish conversation feels natural, whether voice-call pacing feels comfortable, and whether the memory controls are understandable.

Thanks for meeting Mira — I’ll be here throughout launch day answering every question.

## Gallery order

1. `artifacts/product-hunt/gallery-01-conversation.png` — real English/Hinglish chat screen
2. `artifacts/product-hunt/gallery-02-moments.png` — real shared-moments screen
3. `artifacts/product-hunt/gallery-03-memory.png` — real inspectable-memory screen

All gallery images are 1270 × 760. The square thumbnail is `artifacts/product-hunt/mira-product-hunt-thumbnail-240.png` (240 × 240). The social card is `artifacts/product-hunt/mira-product-hunt-social-1200x630.png`.

## Demo video

- Upload source: `artifacts/product-demo/mira-clueso-product-demo.mp4`
- Runtime: about 91 seconds
- Format: 1920 × 1080 H.264 video with AAC audio
- Narration: Indian English female voice
- Current limitation: the free Clueso export contains its watermark.

Product Hunt accepts a full public or unlisted YouTube URL rather than a direct MP4 upload. Upload the file as unlisted, verify playback while signed out, then paste the full YouTube URL into the launch draft.

## Launch-day sequence

1. Open the website in a signed-out desktop window and a real phone; complete text, voice, avatar-call, memory, export, and account-deletion flows.
2. Run `pnpm check` and `pnpm --filter @companion/web smoke:production` against the live URL.
3. Confirm Cloudflare Worker errors, latency, and request volume are visible in Observability.
4. Upload the demo video to YouTube as unlisted and test its full URL.
5. Create the Product Hunt draft from a personal account, add Prakhar Gupta as maker, add the three gallery images and thumbnail, and paste the maker comment.
6. Schedule for 12:01 a.m. Pacific Time and keep the maker available for launch-day replies.
7. Ask for honest feedback only. Do not buy, trade, automate, or incentivize votes.

## Launch boundary

Mira is ready to be described as a free, non-sensitive public beta. Do not describe the current release as independently security-audited, end-to-end encrypted, healthcare-grade, guaranteed private, always available, or payment-enabled. Paid subscriptions, regulated data, transactional notifications, and independent legal/security review remain outside this beta.

## Artwork source prompts

Wide artwork prompt: `Use case: ads/marketing. Asset type: wide launch hero artwork and social-card background for an original AI companion product named Mira. Preserve the same original adult companion identity from the reference: warm brown skin, short tousled auburn bob, freckles, expressive gentle eyes, cream oversized T-shirt, relaxed friendly presence. Place her in the same sunlit creative loft with plants, books, warm wood, coral and sage accents. Refine into premium cinematic editorial 3D illustration with natural depth, believable lighting, polished Product Hunt launch quality. Composition: 16:9 landscape, Mira positioned on the right third looking warmly toward the viewer, generous clean darker negative space on the left for later typography, subtle abstract memory threads and soft glowing conversation shapes integrated into the atmosphere but no legible UI. Mature, welcoming, emotionally intelligent, tasteful and nonsexual. No text, no words, no logo, no watermark, no border, no copied franchise or celebrity likeness.`

Thumbnail prompt: `Use case: Product Hunt launch thumbnail. Asset type: square premium app/product artwork. Preserve the same original adult AI companion Mira from the reference: warm brown skin, short tousled auburn bob, freckles, expressive gentle eyes, cream shirt, friendly warm presence. Close-up head-and-shoulders portrait centered in a softly lit creative loft, coral-to-deep-plum circular glow behind her, elegant cinematic 3D illustration, polished and instantly readable at 240 by 240 pixels. Make her face occupy about 62 percent of the frame and keep the outer edges uncluttered. Adult, welcoming, tasteful, nonsexual. No text, no letter, no logo, no watermark, no border, no franchise or celebrity likeness.`
