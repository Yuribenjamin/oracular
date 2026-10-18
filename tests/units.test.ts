import { createState, ms, validateConfig } from 'oracular';
import { describe, expect, it } from 'vitest';
import { DAY, HOUR, MINUTE, SECOND } from './helpers';

describe('ms', () => {
  it('is plain multiplication by the unit in milliseconds', () => {
    expect(ms.seconds(1)).toBe(1_000);
    expect(ms.minutes(1)).toBe(60_000);
    expect(ms.hours(1)).toBe(3_600_000);
    expect(ms.days(1)).toBe(86_400_000);
    expect(ms.weeks(1)).toBe(604_800_000);
    expect(ms.days(7)).toBe(604_800_000);
    expect(ms.minutes(1.5)).toBe(90_000);
    expect(ms.hours(0)).toBe(0);
    expect(ms.seconds(-2)).toBe(-2_000);
  });

  it('composes the way the calendar does', () => {
    expect(ms.minutes(1)).toBe(ms.seconds(60));
    expect(ms.hours(1)).toBe(ms.minutes(60));
    expect(ms.days(1)).toBe(ms.hours(24));
    expect(ms.weeks(1)).toBe(ms.days(7));
  });

  it('spells the constants the tests and docs write by hand', () => {
    expect(ms.seconds(1)).toBe(SECOND);
    expect(ms.minutes(30)).toBe(30 * MINUTE);
    expect(ms.hours(3)).toBe(3 * HOUR);
    expect(ms.days(7)).toBe(7 * DAY);
  });

  it('has exactly these five units', () => {
    expect(Object.keys(ms)).toStrictEqual(['seconds', 'minutes', 'hours', 'days', 'weeks']);
  });

  it('builds durations the engine accepts as they are', () => {
    const config = {
      episodeTimeout: ms.minutes(30),
      learning: { halfLife: ms.weeks(26) },
      intents: {
        upgrade: {
          prior: 0.05,
          priorStrength: 10,
          halfLife: ms.days(7),
          signals: { 'pricing.viewed': 3 },
          reveal: { cooldown: ms.weeks(2) },
        },
      },
    };
    expect(validateConfig(config)).toStrictEqual(config);
    expect(createState(config).config.intents.upgrade?.halfLife).toBe(7 * DAY);
  });
});
