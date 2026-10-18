---
"oracular": minor
---

**Cross-episode attribution.** `IntentConfig.attribution` is how long a closed episode's signals wait for the outcome before they take a miss. Until now a signal earned a hit only when the outcome arrived in the same episode, so for an intent that builds over days the sessions that built it took misses and the session where the user acted got all the credit. With a window set, an episode that ends without the outcome is held instead of counted; when the outcome arrives inside the window, each held episode gets the share `2^(−age / halfLife)` of a hit that its evidence still holds, and the rest of a miss, so every episode still counts exactly once and the contrast that learning rests on is unchanged; when the window passes, the episode is a miss recorded at the moment the window ended. Reads settle what has expired in what they show and store nothing. Off unless set: every state and estimate without `attribution` is exactly what it was.

**State version 3.** `IntentState.pending` lists the episodes waiting, at most 32 per intent (past that the oldest is a miss at once). `deserialize` upgrades version 1 and 2 states on its own, adding an empty list and changing no number; oracular 0.5.x cannot read a version 3 state, so the rollback advice stays: catch and start from `createState(config)`. `PendingEpisode` is exported as a type; the config JSON Schema gains `attribution`.

`oracular tune` counts each episode's own verdict, with the window off while counting, keeps it on for the half-life grid, and keeps whatever `attribution` you set in the printed config.
