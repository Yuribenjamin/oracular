---
"oracular": minor
---

**Presets.** `oracular/presets` exports `presets`, four plain `IntentConfig` objects to spread into your config and override: `willBuy`, tuned by `oracular tune` on a public e-commerce clickstream of 2.7 million events (one shop, May to September 2015, 4.8% of sessions ending with an order; prior 0.048, strength 4, `cart.added` 2.3, half-life one hour, 181,080 sessions behind it), and `upgrade`, `stuck` and `churn`, the documentation's running examples, hand-written and labelled so. `presetSources` carries each preset's provenance as data, and the types `PresetName` and `PresetSource` are exported from the main entry.
