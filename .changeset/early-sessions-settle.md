---
"oracular": minor
"@oracular/react": patch
---

Add `settleState(state, at)` to close expired sessions, settle expired attribution windows and
decay evidence and learned counts without recording an event. Settlement advances the engine
clock without extending a session or confirming a backwards clock correction. The React store settles restored
state after replaying queued operations and saves changes before loading finishes. Queued tracked
events retain their original timestamps so startup settlement preserves delayed-outcome credit.
