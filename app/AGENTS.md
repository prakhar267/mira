# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Saathkind design decisions

- Brand: `Saathkind` (pronounced “SAATH-kind”).
- Core line: “Talk freely. Come back known.”
- Product promise: user-controlled continuity; companionship without pretending to be human.
- Visual source of truth: `../design/saathkind-visual-target.png`.
- Hero asset: `public/assets/saathkind-horizon.png`.
- Palette: warm off-white, midnight ink, marigold, river teal, with coral used sparingly.
- The memory receipt and its inspect/edit/forget controls are the hero proof—not a synthetic person.
- Preserve visible AI disclosure, 18+ positioning, memory consent, quiet hours, and non-therapy language.
- Avoid Companaro's lowercase purple/pink trade dress, photoreal companion portraits, romance cues, dark patterns, streak pressure, and unsupported claims such as “remembers everything.”
