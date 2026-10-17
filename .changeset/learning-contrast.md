---
"oracular": minor
---

Learning now judges a signal against the sessions in which it did not appear: a signal's smoothed outcome rate is compared with the smoothed outcome rate of the intent's other episodes, instead of the overall base rate (which included the signal's own episodes). Laplace smoothing and the [−1, 1] lift scale are unchanged; the state shape is unchanged. Learned weights move for every user with history, so `explain()` output and some reveal timings change after upgrading.
