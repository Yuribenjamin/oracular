---
"oracular": minor
---

**`tune` no longer reports a lift with nothing to compare it to.** A signal seen in every counted episode had its outcome rate compared with a smoothed rate over zero episodes, a made-up 0.5, and the report printed a lift and a 90% interval from it. For such a signal `lift`, `score`, `low` and `high` are now `null` in `--json`, and the text report prints "no contrast" in place of the interval; the weight was already left out as ubiquitous.
