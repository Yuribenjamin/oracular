import { createState, type EngineConfig, validateConfig } from 'oracular';
import { type PresetName, presetSources, presets } from 'oracular/presets';
import { describe, expect, it } from 'vitest';
import { assertInvariants, DAY, HOUR, MINUTE } from './helpers';

const names: PresetName[] = ['willBuy', 'upgrade', 'stuck', 'churn'];

describe('presets', () => {
  it('ships exactly four, each a config the engine accepts, each with a source', () => {
    expect(Object.keys(presets)).toStrictEqual(names);
    expect(Object.keys(presetSources)).toStrictEqual(names);
    for (const name of names) {
      const config: EngineConfig = { intents: { [name]: presets[name] } };
      expect(() => validateConfig(config)).not.toThrow();
      assertInvariants(createState(config));
      expect(presets[name].outcome).toBeDefined();
    }
    assertInvariants(createState({ episodeTimeout: 30 * MINUTE, intents: presets }));
  });

  it('willBuy carries the numbers the case study fitted, rounded', () => {
    expect(presets.willBuy).toStrictEqual({
      prior: 0.048,
      priorStrength: 4,
      halfLife: HOUR,
      signals: { 'cart.added': 2.3 },
      outcome: 'checkout.completed',
      reveal: { cooldown: DAY },
    });
    expect(presetSources.willBuy).toMatchObject({
      kind: 'tuned',
      episodes: 181_055,
      installs: 93_537,
    });
    expect(presetSources.willBuy.note).toMatch(/0\.0475 and 2\.32 rounded/);
  });

  it('the hand-written three say so and carry no sample', () => {
    for (const name of ['upgrade', 'stuck', 'churn'] as const) {
      expect(presetSources[name].kind).toBe('hand-written');
      expect(presetSources[name].episodes).toBeNull();
      expect(presetSources[name].installs).toBeNull();
      expect(presetSources[name].note).toMatch(/no log behind it/);
    }
  });

  it('upgrade is the quickstart, stuck and churn are the README examples', () => {
    expect(presets.upgrade).toStrictEqual({
      prior: 0.05,
      priorStrength: 10,
      halfLife: 7 * DAY,
      signals: { 'pricing.viewed': 3, 'limit.hit': 2, 'export.clicked': 1 },
      outcome: 'upgrade.completed',
    });
    expect(presets.stuck).toStrictEqual({
      prior: 0.1,
      priorStrength: 5,
      halfLife: 10 * MINUTE,
      signals: { 'editor.undo': 1, 'search.empty': 2, 'help.opened': 3, 'task.completed': -4 },
      outcome: 'help.article.read',
      saturate: false,
      reveal: { threshold: 0.6, cooldown: HOUR },
    });
    expect(presets.churn).toStrictEqual({
      prior: 0.08,
      priorStrength: 20,
      halfLife: 14 * DAY,
      signals: {
        'session.short': 1,
        'notifications.disabled': 3,
        'export.all': 4,
        'feature.new.used': -2,
      },
      outcome: 'account.cancelled',
      reveal: { threshold: 0.5, z: 1.64 },
    });
  });

  it('spreads and overrides as the guide shows, and the engine takes the result', () => {
    const buy = {
      ...presets.willBuy,
      outcome: 'order.placed',
      signals: { ...presets.willBuy.signals, 'wishlist.added': 2 },
    };
    const state = createState({ episodeTimeout: 30 * MINUTE, intents: { buy } });
    assertInvariants(state);
    expect(state.config.intents.buy).toStrictEqual(buy);
    // The preset itself is untouched by the spread.
    expect(presets.willBuy.signals).toStrictEqual({ 'cart.added': 2.3 });
  });

  it('is frozen through and through: a shared object cannot be changed by one caller for every other', () => {
    expect(Object.isFrozen(presets)).toBe(true);
    expect(Object.isFrozen(presetSources)).toBe(true);
    for (const name of names) {
      expect(Object.isFrozen(presets[name])).toBe(true);
      expect(Object.isFrozen(presets[name].signals)).toBe(true);
      expect(Object.isFrozen(presetSources[name])).toBe(true);
    }
    expect(() => {
      (presets.willBuy.signals as Record<string, number>)['cart.added'] = 9;
    }).toThrow(TypeError);
    // Spreading still gives a plain object to override, and the engine copies what it validates.
    const own = { ...presets.willBuy, prior: 0.1 };
    expect(Object.isFrozen(own)).toBe(false);
    assertInvariants(createState({ intents: { buy: own } }));
  });
});
