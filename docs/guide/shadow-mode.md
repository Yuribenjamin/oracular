# Shadow mode

Before an intent changes what users see, measure it. In shadow mode your app runs oracular exactly as it would in production and records what the engine decides, but shows nothing. You export the log, replay it offline against the config you shipped or a new one, read precision, recall and calibration, tune, and only then switch the reveal on.

Both production integrations so far built this themselves. From 0.3 the recorder format is part of oracular, so the tooling can rely on it.

## The workflow

1. **Create an install id once.** A random id, generated on first use and stored by your app:

   ```ts
   let installId = localStorage.getItem('oracular.install');
   if (installId === null) {
     installId = crypto.randomUUID();
     localStorage.setItem('oracular.install', installId);
   }
   const recording = { installId, mode: 'shadow' } as const;
   ```

   It exists so that records from one install can be grouped across exports, and for nothing else. It is **not** a fingerprint: never derive it from the device, the browser, the account or anything else about the user, and never join it with other identifiers. oracular never generates it, because the core has no randomness.

2. **Record every event and every episode end.** Right after `observe`, and right after `endEpisode`:

   ```ts
   import { createEndRecord, createRecord, endEpisode, markRevealed, observe, shouldReveal } from 'oracular';

   function track(name: string) {
     const event = { name, at: Date.now() };
     state = observe(state, event);
     log.append(JSON.stringify(createRecord(state, event, recording)));

     if (shouldReveal(state, 'upgrade', event.at)) {
       // Shadow: show nothing, but start the cooldown as if you had, so the
       // recorded decisions match what a live app would do next.
       state = markRevealed(state, 'upgrade', event.at);
     }
   }

   function endSession() {
     const at = Date.now();
     state = endEpisode(state, at);
     log.append(JSON.stringify(createEndRecord(at, recording)));
   }
   ```

   Each record is one line of JSON (NDJSON). Episodes that close through `episodeTimeout` need no record; replay applies the timeout itself.

3. **Store and export the log yourself.** oracular does no I/O, so where the log lives (IndexedDB, a file, an append-only table) and how it leaves the device are your decisions. The log holds event names and timestamps for one install. Treat it as behavioural data: export it only with the user's consent and under your own privacy policy. Cap its size; a rolling window of a few weeks is plenty.

4. **Replay it** against the config you are evaluating ([below](#replay)) and adjust weights, half-life and threshold until the numbers support acting.

5. **Go live** by switching `mode` to `'live'` and showing the reveal where you called `markRevealed`. Keep recording: the log then shows what shipped. But replay's precision on a live period is no longer an honest measurement, because the reveal itself causes outcomes.

## Replay

`npx oracular replay` reads one or more logs and a config, replays every install's events through the engine under that config, and reports per intent and per threshold:

```sh
npx oracular replay shadow-week-1.ndjson shadow-week-2.ndjson --config oracular.config.json
```

The config can be a `.json` file, or a `.js`, `.mjs` or `.cjs` module whose default (or `config`) export is the config. A `.json` file may carry a top-level `$schema` key pointing at the [published schema](https://yuribenjamin.github.io/oracular/config.schema.json) for editor completion; replay drops it before handing the config to the engine. On the fixture log in the repository, restricted to one intent and three thresholds:

```sh
npx oracular replay tests/fixtures/replay/shadow.ndjson --config tests/fixtures/replay/config.json \
  --intent upgrade --thresholds 0.3,0.5,0.7
```

<!-- replay:example -->
```text
oracular replay: 3 installs, 59 records (59 shadow, 0 live), 2023-11-15 07:15 UTC to 2023-11-27 07:15 UTC
Scored: shadow periods only. Durations assume `at` is in milliseconds.

upgrade: outcome upgrade.completed, window 7d (the intent's reveal cooldown), 3 installs

| threshold | reveals | per user | precision | recall      | median lead time |
| --------- | ------- | -------- | --------- | ----------- | ---------------- |
| 0.3       | 2       | 0.67     | 50.0%     | 100.0% of 1 | 4d               |
| 0.5 *     | 1       | 0.33     | 100.0%    | 100.0% of 1 | 1d               |
| 0.7       | 0       | 0.00     | –         | 0.0% of 1   | –                |
* the threshold your config resolves for this intent.

Reliability: p after every event except the outcome, against "the outcome follows within 7d".
| p       | points | mean p | observed |
| ------- | ------ | ------ | -------- |
| 0.0–0.1 | 10     | 0.050  | 0.0%     |
| 0.2–0.3 | 2      | 0.269  | 50.0%    |
| 0.3–0.4 | 2      | 0.344  | 50.0%    |
| 0.4–0.5 | 10     | 0.476  | 80.0%    |
| 0.5–0.6 | 5      | 0.565  | 40.0%    |
| 0.6–0.7 | 6      | 0.640  | 100.0%   |
Brier score 0.166 over 35 points (always predicting the base rate of 51.4%: 0.250). Lower is better. 15 points too close to the end of the log are not scored.
```
<!-- /replay:example -->

That output is checked by the test suite against the command itself. What the columns mean:

- **Replay.** Each install starts from `createState(config)` at its first record; anything it learned before the log began is not known. For every threshold the replay follows the policy of the guide above: whenever `shouldReveal` is true after an event, that is a reveal, and `markRevealed` starts the cooldown. `end` records call `endEpisode`; `episodeTimeout` closes idle episodes as on the device.
- **Window.** How long after a reveal an outcome still counts for it: the intent's reveal cooldown unless you pass `--window` (`3d`, `12h`, `90m`; durations with a unit assume `at` is in milliseconds). An intent with a cooldown of 0 has no default window, so replay asks for one.
- **Precision.** Reveals followed by the intent's outcome within the window, out of all reveals.
- **Recall.** Outcomes preceded by a reveal within the window, out of all outcomes.
- **Median lead time.** For the correct reveals, the time from the reveal to the outcome: how much notice the reveal gives.
- **Per user.** Reveals divided by installs: how often a user would see it.
- **Reliability.** After every event (except the outcome itself), the engine's p against whether the outcome followed within the window, in ten bins. A calibrated intent has *observed* close to *mean p* in every row. The **Brier score** is the mean of (p − outcome)²; it is compared with always predicting the base rate, which a useful intent must beat.
- **Censoring.** A reveal or point whose window runs past the end of the log cannot be judged yet, so it is left out and counted, never scored as a miss. The start of a log is not censored: every install begins from `createState(config)`, so an outcome within the first window of an install's records usually counts as a miss. Replay cannot tell a new install from a log that began after the user's history did, so read recall over the first days of a log with that in mind.

The `*` marks the threshold your config resolves for the intent. `--json` prints the same report as JSON for your own tooling.

### Shadow and live

Replay's numbers mean something only where reveals were not shown. Once a reveal is live it causes outcomes (the user upgrades because you offered), and precision measures your offer, not the engine. So:

- A log with both modes gets a **warning**, and only shadow periods are scored: a reveal, point or outcome whose window touches a live record of the same install is left out.
- A log with nothing but live records is **refused** (exit code 1).
- `--include-live` scores everything, with a warning that live periods overstate the engine.

Exit codes: 0 when the report is printed, 1 for unreadable input or nothing to score, 2 for a usage error.

## The record format

Version 1, the `v` field of every record and the exported [`RECORD_VERSION`](/api/variables/RECORD_VERSION). One JSON object per line. Two kinds:

**`event`**, written by [`createRecord(state, event, options)`](/api/functions/createRecord):

```json
{"v":1,"kind":"event","installId":"a3f0c2e1-…","mode":"shadow","event":{"name":"pricing.viewed","at":1700000000000},"decisions":{"upgrade":{"p":0.269,"lower":0.117,"shouldReveal":false,"suppressedUntil":null,"top":[{"signal":"pricing.viewed","impact":0.219}],"weights":{"pricing.viewed":3,"limit.hit":2,"export.clicked":1}}}}
```

Numbers are shortened here; records carry full precision.

| field | meaning |
| ----- | ------- |
| `v` | format version, 1 |
| `kind` | `"event"` |
| `installId` | the app's random install id |
| `mode` | `"shadow"` while reveals are computed but not shown, `"live"` once they are shown |
| `event.name`, `event.at` | the observed event. `props` are never recorded |
| `decisions` | one entry per declared intent: what the engine decided right after the event |
| `decisions[i].p`, `.lower` | the Beta mean and its lower confidence bound, as [`predict`](/api/functions/predict) |
| `decisions[i].shouldReveal` | what [`shouldReveal`](/api/functions/shouldReveal) returned with the state's own reveal options |
| `decisions[i].suppressedUntil` | when the running cooldown ends, or null |
| `decisions[i].top` | the signals holding evidence, largest impact first, at most `options.top` (default 3) |
| `decisions[i].weights` | the effective weight of every declared signal |

**`end`**, written by [`createEndRecord(at, options)`](/api/functions/createEndRecord) whenever the app calls `endEpisode`:

```json
{"v":1,"kind":"end","installId":"a3f0c2e1-…","mode":"shadow","at":1700000600000}
```

The **event** is the input: replay recomputes everything from `event.name`, `event.at` and the `end` records, under whatever config you give it. The **decisions** are a record of what shipped, so you can compare it with what a new config would have done. They are never read as input.

Compatibility: a new optional field does not change `v`, readers ignore fields they do not know and skip records of a `kind` they do not know, and anything that a version 1 reader could misread bumps `v`.

## Reference

- [`createRecord`](/api/functions/createRecord), [`createEndRecord`](/api/functions/createEndRecord), [`RECORD_VERSION`](/api/variables/RECORD_VERSION), [`EventRecord`](/api/interfaces/EventRecord), [`EndRecord`](/api/interfaces/EndRecord), [`RecordedDecision`](/api/interfaces/RecordedDecision), [`RecordOptions`](/api/interfaces/RecordOptions).
