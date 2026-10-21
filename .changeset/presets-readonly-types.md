---
"oracular": patch
---

**Presets are read-only in the types too.** `presets` and `presetSources` are `DeepReadonly<...>`, matching the frozen objects: assigning into a preset is a type error, spreading one is unchanged.
