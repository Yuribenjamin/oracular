---
"oracular": patch
---

**`replay` shows the reveals it could not score.** A reveal whose window runs past the end of the log is not scored for precision, since its verdict is not in yet, but an outcome it preceded still counts for recall, so a short log printed `reveals 0` beside `recall 100.0% of 1`, and `--json` showed `reveals: 0, caught: 1, censored: 1`. Both numbers were right and the table did not say why. The text table now shows such reveals in the row (`0 (+1 censored)`) with a footnote that says what recall still counts, and a log shorter than an intent's scoring window, in which every reveal and point is censored, gets a warning on stderr that points at `--window`. The `--json` report is unchanged: `censored` was already there. Found by the second production integration on a one-minute log with the default one-hour window.
