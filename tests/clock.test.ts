import {
  createState,
  deserialize,
  type EngineConfig,
  endEpisode,
  markRevealed,
  observe,
  predict,
  serialize,
} from 'oracular';
import { describe, expect, it } from 'vitest';
import { assertInvariants, DAY, HOUR, MINUTE } from './helpers';

const T = 1_700_000_000_000;
const YEAR = 365 * DAY;

/** Two intents on a half-hour session, one of them with an attribution window. */
const config: EngineConfig = {
  episodeTimeout: 30 * MINUTE,
  intents: {
    x: {
      prior: 0.1,
      priorStrength: 10,
      halfLife: HOUR,
      signals: { 'x.fail': 2 },
      outcome: 'x.done',
      reveal: { threshold: 0.5, cooldown: HOUR },
    },
    y: {
      prior: 0.1,
      priorStrength: 10,
      halfLife: HOUR,
      signals: { 'y.tap': 1 },
      outcome: 'y.done',
      attribution: DAY,
    },
  },
};

const ev = (name: string, at: number) => ({ name, at });

function run(events: [string, number][], from = createState(config)) {
  let s = from;
  for (const [name, at] of events) {
    s = observe(s, ev(name, at));
    assertInvariants(s);
  }
  return s;
}

describe('the clock', () => {
  it('starts empty and follows every event at or after it', () => {
    expect(createState(config).clock).toStrictEqual({ at: null, behindAt: null });
    const s = run([
      ['x.fail', T],
      ['y.tap', T + MINUTE],
    ]);
    expect(s.clock).toStrictEqual({ at: T + MINUTE, behindAt: null });
  });

  it('one event stamped behind the clock counts now, is held, and the next forward event is a glitch that moved nothing', () => {
    // Six failures a minute apart, one stamped at the epoch (a phone that woke up in 1970), one
    // more at the right time.
    const before: [string, number][] = [0, 1, 2, 3, 4, 5].map((i) => ['x.fail', T + i * MINUTE]);
    const glitched = run([...before, ['x.fail', 0], ['x.fail', T + 7 * MINUTE]]);
    // The same events with the glitch counted at the clock's time, which is what happened.
    const control = run([...before, ['x.fail', T + 5 * MINUTE], ['x.fail', T + 7 * MINUTE]]);
    expect(glitched.intents).toStrictEqual(control.intents);
    expect(glitched.episode).toStrictEqual(control.episode);
    expect(glitched.clock).toStrictEqual({ at: T + 7 * MINUTE, behindAt: null });
    // Nothing was wiped and no session closed: no miss, the evidence still there.
    expect(glitched.intents.x!.episodes).toStrictEqual({ hits: 0, misses: 0 });
    expect(glitched.intents.x!.contributions['x.fail']!.alpha).toBeGreaterThan(5);
    // The held stamp, while it waits.
    const held = run([...before, ['x.fail', 0]]);
    expect(held.clock).toStrictEqual({ at: T + 5 * MINUTE, behindAt: 0 });
    expect(held.intents.x!.updatedAt).toBe(T + 5 * MINUTE);
    expect(held.episode.lastEventAt).toBe(T + 5 * MINUTE);
  });

  it('two events behind the clock in a row confirm a correction: every anchor ahead of the first moves back to it', () => {
    let s = run([
      ['x.fail', T],
      ['y.tap', T],
    ]);
    s = observe(s, ev('x.fail', T + 4 * YEAR)); // a clock years ahead: closes the session, opens one in 2027
    s = markRevealed(s, 'y', T + 4 * YEAR + MINUTE); // a reveal stamped by the same clock
    s = endEpisode(s, T + 4 * YEAR + HOUR); // y's episode waits under attribution, closed in the future
    expect(s.intents.y!.pending.map((p) => p.endedAt)).toStrictEqual([T + 4 * YEAR + 30 * MINUTE]);
    expect(s.clock).toStrictEqual({ at: T + 4 * YEAR, behindAt: null }); // endEpisode leaves the clock

    // The clock corrected: the first event behind it is held, and nothing moves yet.
    s = observe(s, ev('y.tap', T + MINUTE));
    expect(s.clock).toStrictEqual({ at: T + 4 * YEAR, behindAt: T + MINUTE });
    expect(s.intents.x!.updatedAt).toBe(T + 4 * YEAR);
    expect(s.intents.y!.lastRevealedAt).toBe(T + 4 * YEAR + MINUTE);
    expect(predict(s, 'x', T + MINUTE).p).toBe(predict(s, 'x', T + 4 * YEAR).p); // held

    // The second confirms it: x, which no event touched, the reveal, the waiting episode and the
    // open episode all move back to the first held stamp, and the event runs forward from there.
    s = observe(s, ev('y.tap', T + 2 * MINUTE));
    assertInvariants(s);
    expect(s.clock).toStrictEqual({ at: T + 2 * MINUTE, behindAt: null });
    expect(s.intents.x!.updatedAt).toBe(T + MINUTE);
    expect(s.intents.y!.lastRevealedAt).toBe(T + MINUTE);
    expect(s.intents.y!.pending.map((p) => p.endedAt)).toStrictEqual([T + MINUTE]);
    expect(s.episode).toMatchObject({ startedAt: T + MINUTE, lastEventAt: T + 2 * MINUTE });
    expect(predict(s, 'y', T + 2 * MINUTE).suppressedUntil).toBe(T + MINUTE + HOUR);
    // Decay resumes from the corrected time: x is back at its prior two months on.
    const soon = predict(s, 'x', T + 2 * MINUTE).p;
    const later = predict(s, 'x', T + 2 * MINUTE + 60 * DAY).p;
    expect(later).toBeLessThan(soon);
    expect(Math.abs(later - 0.1)).toBeLessThan(0.001);
  });

  it('alternating jitter never confirms a correction: decay follows the forward steps only and the session stays open', () => {
    const jittered = run([
      ['x.fail', T + 5 * MINUTE],
      ['x.fail', T + MINUTE - 5 * MINUTE],
      ['x.fail', T + 2 * MINUTE + 5 * MINUTE],
      ['x.fail', T + 3 * MINUTE - 5 * MINUTE],
      ['x.fail', T + 4 * MINUTE + 5 * MINUTE],
    ]);
    const control = run([
      ['x.fail', T + 5 * MINUTE],
      ['x.fail', T + 5 * MINUTE],
      ['x.fail', T + 7 * MINUTE],
      ['x.fail', T + 7 * MINUTE],
      ['x.fail', T + 9 * MINUTE],
    ]);
    expect(jittered).toStrictEqual(control);
    expect(jittered.intents.x!.episodes).toStrictEqual({ hits: 0, misses: 0 });
  });

  it('a run of stamps behind the clock re-anchors once and then runs forward from the corrected time', () => {
    const s = run([
      ['x.fail', T + 100 * MINUTE],
      ['x.fail', T], // held
      ['x.fail', T + MINUTE], // confirms: everything moves back to T, then forward one minute
      ['x.fail', T + 2 * MINUTE],
    ]);
    expect(s.clock).toStrictEqual({ at: T + 2 * MINUTE, behindAt: null });
    expect(s.intents.x!.updatedAt).toBe(T + 2 * MINUTE);
    expect(s.episode).toMatchObject({ startedAt: T, lastEventAt: T + 2 * MINUTE });
    // Four failures counted, two minutes of decay since the correction.
    const same = run([
      ['x.fail', T],
      ['x.fail', T],
      ['x.fail', T + MINUTE],
      ['x.fail', T + 2 * MINUTE],
    ]);
    expect(s.intents.x!.alpha).toBeCloseTo(same.intents.x!.alpha, 12);
  });

  it('a reveal stamped ahead of the clock is pinned by the next event on any intent', () => {
    let s = run([['x.fail', T]]);
    s = markRevealed(s, 'x', T + YEAR);
    expect(predict(s, 'x', T + MINUTE).suppressedUntil).toBe(T + MINUTE + HOUR); // reads: as if now
    s = observe(s, ev('y.tap', T + MINUTE));
    expect(s.intents.x!.lastRevealedAt).toBe(T + MINUTE);
    expect(predict(s, 'x', T + MINUTE + HOUR + 1).suppressedUntil).toBeNull();
  });

  it('intents nothing moves in keep their objects, and a forward event allocates no new episode when nothing is ahead', () => {
    const s1 = run([
      ['x.fail', T],
      ['y.tap', T + MINUTE],
    ]);
    const s2 = observe(s1, ev('y.tap', T + 2 * MINUTE));
    expect(s2.intents.x).toBe(s1.intents.x);
    const s3 = observe(s2, ev('nobody.declares', T + 3 * MINUTE));
    expect(s3.intents.x).toBe(s2.intents.x);
    expect(s3.intents.y).toBe(s2.intents.y);
  });

  it('round-trips through serialize and deserialize, held stamp included', () => {
    const s = run([
      ['x.fail', T],
      ['y.tap', T - HOUR],
    ]);
    expect(s.clock).toStrictEqual({ at: T, behindAt: T - HOUR });
    const back = deserialize(serialize(s), { config });
    expect(back).toStrictEqual(s);
    // And the held stamp still decides at the next event.
    expect(observe(back, ev('y.tap', T - HOUR + MINUTE)).clock).toStrictEqual({
      at: T - HOUR + MINUTE,
      behindAt: null,
    });
  });

  it('a version 3 state migrates with the clock at the latest anchor, reveals left out, and no estimate moves', () => {
    let s = run([
      ['x.fail', T],
      ['y.tap', T + MINUTE],
      ['y.done', T + 2 * MINUTE],
    ]);
    s = markRevealed(s, 'x', T + YEAR); // a reveal stamped ahead: not a time to trust
    const { clock: _clock, ...rest } = JSON.parse(serialize(s));
    const v3 = JSON.stringify({ ...rest, version: 3 });
    const migrated = deserialize(v3, { config });
    assertInvariants(migrated);
    expect(migrated.version).toBe(4);
    expect(migrated.clock).toStrictEqual({ at: T + 2 * MINUTE, behindAt: null });
    expect({ ...migrated, clock: s.clock }).toStrictEqual(s);
    for (const name of ['x', 'y']) {
      expect(predict(migrated, name, T + 3 * MINUTE)).toStrictEqual(
        predict(s, name, T + 3 * MINUTE),
      );
    }
    // A malformed version 3 state passes through to the parser's own error.
    expect(() => deserialize(JSON.stringify({ ...rest, version: 3, intents: 'nope' }))).toThrow(
      TypeError,
    );
  });

  it('a state without a clock is not an engine state', () => {
    const { clock: _clock, ...rest } = createState(config);
    expect(() => observe(rest as never, ev('x.fail', T))).toThrow(TypeError);
    expect(() => deserialize(JSON.stringify(rest))).toThrow(TypeError);
  });

  it('two bad stamps in a row read as a correction, and cost what 0.10 paid on every backward step', () => {
    const before: [string, number][] = [0, 1, 2, 3, 4, 5].map((i) => ['x.fail', T + i * MINUTE]);
    let s = run([...before, ['x.fail', 0], ['x.fail', 1]]); // a phone stamping 1970 twice
    expect(s.clock).toStrictEqual({ at: 1, behindAt: null });
    expect(s.intents.x!.updatedAt).toBe(1);
    expect(s.episode).toMatchObject({ startedAt: 0, lastEventAt: 1 });
    // The next good event decays the whole gap and closes the session: the cost, once per pair.
    s = observe(s, ev('x.fail', T + 7 * MINUTE));
    assertInvariants(s);
    expect(s.intents.x!.episodes).toStrictEqual({ hits: 0, misses: 1 });
    expect(s.intents.x!.contributions['x.fail']!.alpha).toBeCloseTo(2, 9);
  });

  it('a stamp behind a held stamp confirms the correction at the first and holds the second', () => {
    let s = run([
      ['x.fail', T],
      ['x.fail', T - 4 * MINUTE], // held
      ['x.fail', T - 6 * MINUTE], // confirms the first; behind the corrected clock itself, so held
    ]);
    expect(s.clock).toStrictEqual({ at: T - 4 * MINUTE, behindAt: T - 6 * MINUTE });
    expect(s.intents.x!.updatedAt).toBe(T - 4 * MINUTE);
    expect(s.episode).toMatchObject({ startedAt: T - 4 * MINUTE, lastEventAt: T - 4 * MINUTE });
    s = observe(s, ev('x.fail', T - 5 * MINUTE)); // behind again: confirms the second, then forward
    assertInvariants(s);
    expect(s.clock).toStrictEqual({ at: T - 5 * MINUTE, behindAt: null });
    expect(s.intents.x!.updatedAt).toBe(T - 5 * MINUTE);
    expect(s.episode).toMatchObject({ startedAt: T - 6 * MINUTE, lastEventAt: T - 5 * MINUTE });
  });

  it('endEpisode and markRevealed keep the held stamp for the next event to judge', () => {
    const held = run([
      ['x.fail', T],
      ['x.fail', T - HOUR],
    ]);
    expect(held.clock).toStrictEqual({ at: T, behindAt: T - HOUR });
    const ended = endEpisode(held, T + MINUTE);
    expect(ended.clock).toBe(held.clock);
    expect(markRevealed(held, 'x', T + MINUTE).clock).toBe(held.clock);
    expect(observe(ended, ev('x.fail', T - HOUR + MINUTE)).clock).toStrictEqual({
      at: T - HOUR + MINUTE,
      behindAt: null,
    });
  });

  it('the first event after a correction is processed at the uncorrected time: what it touches decays to it', () => {
    let s = run([
      ['x.fail', T],
      ['y.tap', T],
    ]);
    s = observe(s, ev('x.fail', T + 4 * YEAR)); // the glitch closes the session and wipes x
    s = observe(s, ev('y.tap', T + MINUTE)); // held: y is decayed to the glitch's time before the tap counts
    expect(s.intents.y!.updatedAt).toBe(T + 4 * YEAR);
    expect(s.intents.y!.contributions['y.tap']!.alpha).toBeCloseTo(1, 9); // the earlier tap is gone
    s = observe(s, ev('y.tap', T + 2 * MINUTE)); // confirmed: y's anchor moves back, its evidence does not return
    assertInvariants(s);
    expect(s.intents.y!.updatedAt).toBe(T + 2 * MINUTE);
  });
});
