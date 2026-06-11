---
name: plov-website-checkpoint
description: Resume point for the plov landing — trigger phrase "Plov Website"
metadata:
  type: project
---

**Code phrase to resume: "Plov Website"** — when the user says it, reload this checkpoint and continue the adras/atlas redesign of the my-site plov landing.

Project: `c:\Users\Admin\Desktop\Python_Coding_Learning\my-site` (React + Vite + motion, no Tailwind, inline styles + CSS vars). See [[design-direction-adras-atlas]] and [[user-prefers-no-magic-mcp]] (don't call Magic MCP).

**Done so far:**
1. `CONCEPT.md` written at project root (adras/atlas ikat concept, palette, rules).
2. `src/index.css` — added ikat palette tokens (`--ikat-crimson/orange/saffron/emerald/turquoise/violet/magenta`), deepened dark base to plum-charcoal.
3. `src/App.jsx` — replaced `SuzaniBackground` with `IkatBackground`: vertical bleeding ikat bands + feather/warp texture, infinite `hue-rotate` cycle (34s) = "living fabric", scroll parallax, cursor glow, vignette; respects prefers-reduced-motion. Wired into `App()`.

**Remaining steps (do in order, show each block):**
3. Realistic rice rain `RiceRain` — rice, julienned carrot, meat chunks, cumin, raisin, chickpea; distinct shapes/colors/speed/rotation/sway; ~30-40 particles. (was in_progress when paused)
4. Hero — adras/atlas style with shimmering ikat accents.
5. 4 plov cards (Праздничный, Ташкентский, Чайханский, Шавля) — ikat style, hover color-shift.
6. Order modal/form (имя, телефон, выбор плова) — ikat style, no real submit.

**Explicit next request from user:** add proper ADRAS and ATLAS pattern motifs (real ikat ornament shapes), not just smooth bands.

Note: `SuzaniDivider` still uses old gold-stripe colors — restyle to ikat during section passes.
