import { createState, endEpisode, episodeClosed, markRevealed, observe } from 'oracular';
import { describe, expect, it } from 'vitest';
import { assertInvariants, HOUR, MINUTE, upgradeConfig } from './helpers';

const T = 1_700_000_000_000;

describe('episodeClosed', () => {
  it('is true across endEpisode and across an episodeTimeout, false otherwise', () => {
    const s0 = createState(upgradeConfig({ episodeTimeout: 30 * MINUTE }));
    const s1 = observe(s0, { name: 'pricing.viewed', at: T });
    const s2 = observe(s1, { name: 'limit.hit', at: T + MINUTE });
    const s3 = endEpisode(s2, T + 2 * MINUTE);
    const s4 = observe(s3, { name: 'export.clicked', at: T + 3 * MINUTE });
    const s5 = observe(s4, { name: 'pricing.viewed', at: T + 3 * MINUTE + HOUR }); // gap > timeout
    const s6 = markRevealed(s5, 'upgrade', T + 3 * MINUTE + HOUR);
    for (const s of [s1, s2, s3, s4, s5, s6]) assertInvariants(s);

    expect(episodeClosed(s0, s1)).toBe(false); // nothing was open before
    expect(episodeClosed(s1, s2)).toBe(false); // same episode continues
    expect(episodeClosed(s2, s3)).toBe(true); // explicit end
    expect(episodeClosed(s3, s4)).toBe(false); // a new one opened, none closed
    expect(episodeClosed(s4, s5)).toBe(true); // closed by the idle gap, new one opened
    expect(episodeClosed(s5, s6)).toBe(false); // markRevealed touches no episode
    expect(episodeClosed(s0, s0)).toBe(false);
    expect(episodeClosed(s2, s2)).toBe(false);
  });

  it('pairs with the misses delta for an intent', () => {
    const s0 = createState(upgradeConfig());
    const s1 = observe(s0, { name: 'pricing.viewed', at: T });
    const s2 = endEpisode(s1, T + MINUTE);
    expect(episodeClosed(s1, s2)).toBe(true);
    expect(s2.intents.upgrade!.episodes.misses - s1.intents.upgrade!.episodes.misses).toBe(1);
    expect(
      s2.intents.upgrade!.learned['pricing.viewed']!.misses -
        (s1.intents.upgrade!.learned['pricing.viewed']?.misses ?? 0),
    ).toBe(1);
  });

  it('rejects things that are not engine state', () => {
    const s = createState(upgradeConfig());
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
    expect(() => episodeClosed(s, {} as any)).toThrow(TypeError);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
    expect(() => episodeClosed(null as any, s)).toThrow(TypeError);
  });
});
