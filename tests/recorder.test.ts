import {
  createEndRecord,
  createRecord,
  createState,
  type EngineState,
  type EventRecord,
  endEpisode,
  evaluate,
  markRevealed,
  observe,
  RECORD_VERSION,
} from 'oracular';
import { describe, expect, it } from 'vitest';
import { assertInvariants, assertPlainJson, DAY, MINUTE, upgradeConfig } from './helpers';

const T = 1_700_000_000_000;
const config = upgradeConfig({
  episodeTimeout: 30 * MINUTE,
  intents: {
    ...upgradeConfig().intents,
    churn: {
      prior: 0.1,
      priorStrength: 20,
      halfLife: 14 * DAY,
      signals: { 'export.clicked': 2, 'pricing.viewed': -1 },
      outcome: 'account.cancelled',
    },
  },
});
const recording = { installId: 'a3f0c2e1-6b1d-4c39-9d0e-2f1b7a5c8e44', mode: 'shadow' } as const;

/** Observes an event and records it, the way an app does. */
function step(state: EngineState, name: string, at: number, props?: Record<string, unknown>) {
  const event = props === undefined ? { name, at } : { name, at, props };
  const next = observe(state, event);
  assertInvariants(next);
  return { state: next, record: createRecord(next, event, recording) };
}

describe('createRecord', () => {
  it('records the event and, separately, every intent’s decision', () => {
    const { state, record } = step(createState(config), 'pricing.viewed', T);
    expect(Object.keys(record)).toStrictEqual([
      'v',
      'kind',
      'installId',
      'mode',
      'event',
      'decisions',
    ]);
    expect(record).toMatchObject({
      v: 1,
      kind: 'event',
      installId: recording.installId,
      mode: 'shadow',
      event: { name: 'pricing.viewed', at: T },
    });
    expect(RECORD_VERSION).toBe(1);
    expect(Object.keys(record.decisions)).toStrictEqual(['upgrade', 'churn']);
    const upgrade = record.decisions.upgrade!;
    // α = 0.5 + 3, β = 9.5
    expect(upgrade.p).toBeCloseTo(3.5 / 13, 12);
    expect(upgrade).toMatchObject({ shouldReveal: false, suppressedUntil: null });
    expect(upgrade.top).toStrictEqual([
      { signal: 'pricing.viewed', impact: evaluate(state, 'upgrade', T).explanation[0]!.impact },
    ]);
    expect(upgrade.weights).toStrictEqual({
      'pricing.viewed': 3,
      'limit.hit': 2,
      'export.clicked': 1,
      'plan.downgraded': -4,
    });
    // The same event is evidence against churn.
    expect(record.decisions.churn!.top).toStrictEqual([
      {
        signal: 'pricing.viewed',
        impact: evaluate(state, 'churn', T).explanation[0]!.impact,
      },
    ]);
    expect(record.decisions.churn!.top[0]!.impact).toBeLessThan(0);
  });

  it('decides exactly what evaluate reports, through learning, reveals and cooldowns', () => {
    let s = createState(config);
    const records: EventRecord[] = [];
    const events: Array<[string, number]> = [
      ['pricing.viewed', T],
      ['limit.hit', T + MINUTE],
      ['upgrade.completed', T + 2 * MINUTE],
      ['export.clicked', T + DAY],
      ['pricing.viewed', T + 2 * DAY],
      ['pricing.viewed', T + 2 * DAY + MINUTE],
      ['limit.hit', T + 3 * DAY],
      ['export.clicked', T + 3 * DAY + MINUTE],
    ];
    for (const [name, at] of events) {
      const { state, record } = step(s, name, at);
      s = state;
      records.push(record);
      for (const [intent, decision] of Object.entries(record.decisions)) {
        const { prediction, reveal, explanation } = evaluate(s, intent, at);
        expect(decision.p).toBe(prediction.p);
        expect(decision.lower).toBe(prediction.lower);
        expect(decision.shouldReveal).toBe(reveal);
        expect(decision.suppressedUntil).toBe(prediction.suppressedUntil);
        expect(decision.top).toStrictEqual(
          explanation
            .filter((row) => row.contribution !== 0)
            .slice(0, 3)
            .map(({ signal, impact }) => ({ signal, impact })),
        );
        for (const row of explanation) {
          expect(decision.weights[row.signal]).toBe(row.effectiveWeight);
        }
      }
      if (record.decisions.upgrade!.shouldReveal) {
        s = markRevealed(s, 'upgrade', at);
        assertInvariants(s);
      }
    }
    // The outcome starts a cooldown, which the next records carry.
    expect(records[2]!.decisions.upgrade!.suppressedUntil).toBe(T + 2 * MINUTE + 7 * DAY);
  });

  it('never records props, and every record is one plain JSON line', () => {
    const { record } = step(createState(config), 'pricing.viewed', T, {
      email: 'pii@example.com',
      plan: { name: 'secret-plan' },
    });
    const line = JSON.stringify(record);
    for (const needle of ['props', 'pii@example.com', 'secret-plan', 'email']) {
      expect(line).not.toContain(needle);
    }
    expect(line).not.toContain('\n');
    assertPlainJson(record, 'record');
    expect(JSON.parse(line)).toStrictEqual(record);
  });

  it('lists at most `top` signals, only those holding evidence, largest impact first', () => {
    let s = createState(config);
    for (const name of ['pricing.viewed', 'limit.hit', 'export.clicked', 'plan.downgraded']) {
      s = observe(s, { name, at: T });
      assertInvariants(s);
    }
    const event = { name: 'export.clicked', at: T };
    const top = (n?: number) =>
      createRecord(s, event, n === undefined ? recording : { ...recording, top: n }).decisions
        .upgrade!.top;
    expect(top()).toHaveLength(3);
    expect(top(10)).toHaveLength(4);
    expect(top(1)).toStrictEqual([top()[0]]);
    expect(top(0)).toStrictEqual([]);
    const sizes = top(10).map((row) => Math.abs(row.impact));
    expect(sizes).toStrictEqual([...sizes].sort((a, b) => b - a));
    const fresh = createRecord(createState(config), { name: 'app.opened', at: T }, recording);
    expect(fresh.decisions.upgrade!.top).toStrictEqual([]);
  });

  it('records live mode as given', () => {
    const live = createRecord(
      createState(config),
      { name: 'app.opened', at: T },
      { ...recording, mode: 'live' },
    );
    expect(live.mode).toBe('live');
  });

  it('rejects malformed options, events and states', () => {
    const s = createState(config);
    const event = { name: 'app.opened', at: T };
    const bad: Array<[string, unknown, ErrorConstructor]> = [
      ['no options', undefined, TypeError],
      ['empty installId', { ...recording, installId: '' }, TypeError],
      ['missing installId', { mode: 'shadow' }, TypeError],
      ['numeric installId', { ...recording, installId: 42 }, TypeError],
      ['unknown mode', { ...recording, mode: 'test' }, TypeError],
      ['unknown key', { ...recording, instalId: 'x' }, TypeError],
      ['negative top', { ...recording, top: -1 }, RangeError],
      ['fractional top', { ...recording, top: 1.5 }, RangeError],
      ['string top', { ...recording, top: '3' }, TypeError],
    ];
    for (const [label, opts, ErrorType] of bad) {
      // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
      expect(() => createRecord(s, event, opts as any), label).toThrow(ErrorType);
      // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
      expect(() => createRecord(s, event, opts as any), label).toThrow(/^oracular: /);
    }
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
    expect(() => createRecord(s, { name: '', at: T } as any, recording)).toThrow(TypeError);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
    expect(() => createRecord({} as any, event, recording)).toThrow(TypeError);
  });
});

describe('createEndRecord', () => {
  it('records the end of an episode', () => {
    let s = observe(createState(config), { name: 'pricing.viewed', at: T });
    s = endEpisode(s, T + MINUTE);
    assertInvariants(s);
    const record = createEndRecord(T + MINUTE, recording);
    expect(record).toStrictEqual({
      v: 1,
      kind: 'end',
      installId: recording.installId,
      mode: 'shadow',
      at: T + MINUTE,
    });
    expect(Object.keys(record)).toStrictEqual(['v', 'kind', 'installId', 'mode', 'at']);
    expect(createEndRecord(T, { ...recording, top: 7 }).kind).toBe('end');
  });

  it('rejects a bad time or options', () => {
    expect(() => createEndRecord(Number.NaN, recording)).toThrow(TypeError);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
    expect(() => createEndRecord(T, { installId: 'x' } as any)).toThrow(TypeError);
  });
});
