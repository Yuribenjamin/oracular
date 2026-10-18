---
"oracular": minor
---

`deserialize` now rejects, with a `RangeError`, a stored state whose numbers are each finite but too large to compute with. Before, a contribution or episode count near 1e308 (a corrupted or hand-edited state) loaded and then answered NaN. Config validation now caps signal weights, `priorStrength`, `learning.gain` and `learning.priorEpisodes` at 1e6 in magnitude (`RangeError`), because larger values could overflow the same arithmetic in `createState` too; no real config comes close. A fuzz test over states saved by every published version (0.1.0 to 0.2.1) guards both: corrupt, truncated and tampered input either throws a `SyntaxError`, `TypeError` or `RangeError`, or loads a state whose estimates stay finite.
