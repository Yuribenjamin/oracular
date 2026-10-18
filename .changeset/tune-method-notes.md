---
"oracular": patch
---

`oracular tune` learned three rules from a public e-commerce clickstream of 2.7 million events. A signal seen in more than 90% of counted episodes is left out of the fitted config, whatever its lift: it cannot tell episodes apart, and the few episodes without it are rarely typical sessions, so the contrast measured on them says little (on that log, `item.viewed` sat in 99% of sessions and the contrast called it strongly negative; dropping it scored better than any weight). The current half-life is kept when the best grid point improves on it by less than 1%, and the grid is printed to four decimals so a flat grid reads as flat. The report says when the fitted intent still does not beat its own base rate. The JSON report gains `share` and `ubiquitous` per signal and `beatsBaseRate` per intent.
