# What oracular can and cannot learn

oracular learns from one user's own history, on one device, one episode at a time. That is what keeps it private, and it also bounds what it can learn. This page says where the boundary is, with numbers computed from the engine itself (every table below is generated and checked by the test suite).

## Repeating outcomes: learned per user

When the outcome can happen many times for the same user (a checkout, a help article read, getting unstuck), every episode is a trial. Signals seen in episodes that ended with the outcome get hits, the others get misses, and each signal's weight moves toward what this user's history supports ([Episodes & learning](/guide/concepts/episodes-and-learning) has the formula).

A user who checks out about once in two sessions, one a day for a month. `cart.added` is seen in three sessions out of five and is followed by a checkout in two of those three; `product.viewed` is seen every other session whatever happens. Both start at weight 2:

<!-- generated:repeating-outcome-table -->
| sessions | `cart.added` hits / misses | effective | `product.viewed` hits / misses | effective |
| -------- | -------------------------- | --------- | ------------------------------ | --------- |
| 5 | 2 / 1 | 1.99 | 1 / 2 | 1.70 |
| 10 | 4 / 2 | 1.95 | 2 / 3 | 1.40 |
| 20 | 8 / 4 | 1.99 | 4 / 6 | 0.95 |
| 30 | 12 / 6 | 2.02 | 6 / 9 | 0.63 |
<!-- /generated:repeating-outcome-table -->

The weight you guessed right holds; the signal that predicts nothing for this user fades from 2 to 0.63 within a month. That is the learner doing its job, and it needs many episodes on both sides of the contrast: a few sessions move nothing.

## Once-per-user outcomes: your priors do the work

An upgrade or a cancellation happens once per user, if at all. Before it, every episode is a miss for every signal seen in it; after it, the intent resets, pauses for its cooldown, and has nothing left to predict. There is at most one hit to learn from, so per-user learning cannot confirm your weights. What fires the reveal is the evidence gate: your weights against your prior, with [decay](/guide/concepts/decay) pulling the evidence back down.

What learning does do before the outcome is erode the weights a little, because sessions without the upgrade make every signal look weaker. How much depends on how often the signal appeared, through the smoothing of the rates. The quickstart `pricing.viewed` (weight 3) after ten sessions without an upgrade, the signal seen in some of them, and after one upgrade in an eleventh session together with the signal:

<!-- generated:once-per-user-table -->
| sessions with `pricing.viewed` | effective weight, no upgrade yet | after one upgrade |
| ----------------------------- | -------------------------------- | ----------------- |
| 1 of 10 | 2.88 | 2.96 |
| 3 of 10 | 2.58 | 2.70 |
| 5 of 10 | 2.40 | 2.52 |
| 7 of 10 | 2.02 | 2.46 |
| 9 of 10 | 2.39 | 2.50 |
| 10 of 10 | 3.00 | 3.00 |
<!-- /generated:once-per-user-table -->

A signal seen in every session keeps exactly its weight (there is no session without it to compare against). Any other drops a little, by an amount that does not even rise steadily with how often the signal was seen (seven sessions out of ten end lowest here), and one upgrade restores only part of it. Read these intents as "the weights you wrote, slightly discounted", and choose the weights from data across users: run in [shadow mode](/guide/shadow-mode) and replay the log.

## Signals add: no order, no interactions

Each signal adds its weight, independently of the others. That keeps the model explainable (contributions sum to the evidence) and cheap, and it has two consequences. Two signals that always fire together count twice, and the order of signals in a session makes no difference:

<!-- generated:independence-table -->
| signals in each session | p after one session | sessions to the reveal, one a day |
| ----------------------- | ------------------- | --------------------------------- |
| `a` alone, weight 2 | 0.208 | 13 |
| `a` then `b`, weight 2 each, always together | 0.321 | 5 |
| `b` then `a` | 0.321 | 5 |
<!-- /generated:independence-table -->

It bites when:

- **Signals are redundant.** `pricing.viewed` and `pricing.plan.toggled` on the same page are one piece of evidence configured as two, and the gate opens on less than you meant: here 5 sessions instead of 13. Give correlated signals a shared, smaller weight, or keep only one. Repeats of the *same* signal within an episode are discounted ([saturation](/guide/concepts/signals-and-weights#repeats-within-an-episode)); different names are not.
- **Order carries the meaning.** "added to cart, then emptied it" and "emptied the cart, then added to it" are the same evidence. If the sequence matters, emit an event for it (`cart.abandoned`) from your app.
- **The combination means more than the parts.** "hit the limit *and* viewed pricing" is not stronger than the sum of the two. Emit a combined event when you know a combination is the signal.

## Credit stays inside the episode

A signal earns a hit only when the outcome arrives in the same episode. When interest builds over days, the sessions that built it get misses, and the session where the user finally acts gets the credit:

<!-- generated:attribution-table -->
| signal | seen on | hits | misses |
| ------ | ------- | ---- | ------ |
| pricing.viewed | Monday | 0 | 1 |
| limit.hit | Monday | 0 | 1 |
| export.clicked | Tuesday | 1 | 0 |
<!-- /generated:attribution-table -->

Monday's pricing visit is recorded as a session that did *not* lead to an upgrade. For intents measured in minutes or one session this is exactly right. For intents that build over days, set `attribution`: a session that ends without the outcome then waits for it, and an outcome inside the window gives the session the share `2^(−age / halfLife)` of a hit that its evidence still holds. The same two sessions with `attribution` of two weeks:

<!-- generated:attribution-on-table -->
| signal | seen on | hits | misses |
| ------ | ------- | ---- | ------ |
| pricing.viewed | Monday | 0.906 | 0.094 |
| limit.hit | Monday | 0.906 | 0.094 |
| export.clicked | Tuesday | 1 | 0 |
<!-- /generated:attribution-on-table -->

Monday's signals earn 0.906 of a hit, the fraction of their weight still standing on Tuesday with a one-week half-life, and 0.094 of a miss, so each session still counts once. [Episodes & learning](/guide/concepts/episodes-and-learning#credit-across-episodes) has the rules and a table over longer gaps. The window is off unless set, and the right one depends on the intent's horizon; `tune` on a shadow log can show whether one is justified.

## What it never sees

- **Other users.** Nothing is pooled across users or devices, by design. A population view (which weights work across your users) comes from your own shadow logs and `replay`, not from the engine.
- **Event properties.** `props` are accepted and ignored. Put the context that matters in the event name ([Signals & weights](/guide/concepts/signals-and-weights#context-in-the-name)).
- **Anything you do not emit.** The engine sees event names and the times you pass in, nothing else.
- **Episode boundaries you do not draw.** Without `endEpisode` or `episodeTimeout`, nothing is ever a miss, and repeats within the one endless episode are not discounted (saturation is on by default only with `episodeTimeout`). Learning depends on episodes ending.

## In short

| oracular can | oracular cannot |
| ------------ | --------------- |
| learn per user which signals precede an outcome that repeats | learn weights for an outcome that happens once per user |
| discount a signal repeated within one session | learn from other users |
| forget, with decay, what is no longer recent | tell two different but redundant signals apart |
| explain every estimate signal by signal | see order, sequences or combinations of signals |
| credit recent sessions for a later outcome, with `attribution` | learn anything about a session it never saw end |
| run with no data leaving the device | pool anything across devices |
