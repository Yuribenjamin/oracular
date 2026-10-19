---
"oracular": minor
---

Add `learning.lift` to `createState(config)` with absolute difference, relative lift, risk ratio, log lift, odds ratio, normalized difference and association-rule lift. Omitting it preserves the current normalized difference and existing saved states. CLI tuning uses the selected formula too. Ratio formulas retain their raw values (neutral at 1), and ratio/log inputs are kept away from floating-point endpoints for finite weights.
