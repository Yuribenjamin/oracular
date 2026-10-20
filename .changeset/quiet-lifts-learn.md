---
"oracular": minor
---

Add `learning.lift` to `createState(config)` with absolute difference, relative lift, risk ratio, log lift, odds ratio, normalized difference and association-rule lift. Every choice is converted to a signed score in [−1, 1], neutral at zero, before learning or tuning weights and intervals. Ratios use (R − 1)/(R + 1), relative/log lift use x/(1 + |x|), and bounded differences keep their scale. Omitting the selector preserves the existing normalized difference exactly. CLI reports retain raw lift alongside the evidence score when they differ. Existing learned counts are retained; previously accumulated evidence is not rebuilt and continues to decay or reset on outcome.
