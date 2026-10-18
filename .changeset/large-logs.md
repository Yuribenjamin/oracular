---
"oracular": patch
---

`oracular replay` and `oracular tune` read logs of any size. A log of more than about a hundred thousand records made both commands fail with "Maximum call stack size exceeded", because every file's entries were spread into one `push` call. Found by replaying the Retailrocket clickstream (2.7 million events).
