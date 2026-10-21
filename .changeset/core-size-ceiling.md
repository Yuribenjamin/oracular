---
"oracular": patch
---

**Size.** The whole `oracular` entry goes from 7.72 kB to 8.09 kB minified and gzipped with the clock rule and its state version, the quickstart import (`createState`, `observe`, `shouldReveal`, `markRevealed`) from 4.63 kB to 4.85 kB. That crosses the 7.9 kB ceiling the stability page set in 0.8, so the ceiling moves as it did then, to the shipped size plus about 10%: 8.9 kB, with the quickstart budget at 5 kB.
