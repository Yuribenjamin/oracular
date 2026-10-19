---
"oracular": patch
---

**A load then a save writes the same string.** `deserialize` rebuilt the open episode's per-intent records in the order the config lists intents, while `observe` writes them in the order the intents were first touched in that episode. The content was identical, and the order of keys in a serialized state is not API, but an app that skips a save when the string has not changed, a common persistence pattern, wrote once spuriously after every load. `deserialize` now keeps the stored order and drops only intents the config no longer declares, so `serialize(deserialize(json))` is `json` on the first pass. The property-based tests pin it.
