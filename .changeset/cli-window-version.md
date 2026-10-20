---
"oracular": patch
---

**Two CLI fixes.** `replay` and `tune` no longer refuse a whole config because one intent has a reveal cooldown of 0: that intent is scored over its half-life, the text report says so, and the `--json` reports gain `windowSource` (`option`, `cooldown` or `halfLife`) next to the existing `windowIsCooldown`. `oracular replay --version` and `oracular tune --version` (or `-v`) print the version, as the help already claimed.
