---
"oracular": minor
---

**Choosing the comparison.** `learning.lift` chooses how a signal's outcome rate is compared with its baseline: absolute difference, relative lift, risk ratio, log lift, odds ratio, normalized difference or association-rule lift. Every choice becomes a signed score in [−1, 1], with no association at zero, before it changes a weight. A risk ratio of 1 learns zero, 3 gives a score of 0.5 and 1/3 gives −0.5; `gain` caps the learned magnitude at `gain × |initial weight|` whichever comparison is set. `oracular tune` uses the same score for weights and intervals, and reports the raw measure alongside it when the two differ. Nothing moves unless the option is set: normalized difference remains the default, with exactly the same arithmetic.

**Rollback.** A stored config that sets `lift` is read by 0.9 and later; a 0.8 reader throws a `TypeError` on the unknown key, so remove `learning.lift` from the saved config before rolling a deploy back. Passing an older config to `deserialize` alone does not avoid that check. The state version is unchanged. Existing learned counts are kept; evidence already accumulated under another comparison is not rebuilt and continues to decay or reset on outcome.
