---
"oracular": minor
---

**A repeated outcome counts once.** An outcome rewards the signals seen since the episode started or since the intent's outcome last arrived, and counts the episode toward the base rate. A second outcome event with no signal seen since the first (a duplicate event, or two outcomes back to back) counted another hit episode, so a session with two outcome events inflated the base rate; it now counts nothing, and only `lastOutcomeAt` and the reset of the evidence happen again. Signals seen after an outcome in the same episode are unchanged: they earn a hit if another outcome follows them, and stay neutral at the close, since what they would predict is a second outcome in the same session, which is not what the weight is for. `tune` counts the same way. The state format is unchanged.
