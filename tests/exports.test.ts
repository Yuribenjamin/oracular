import * as api from 'oracular';
import { expect, it } from 'vitest';

it('exports exactly the public surface', () => {
  expect(Object.keys(api).sort()).toStrictEqual(
    [
      'STATE_VERSION',
      'createState',
      'deserialize',
      'endEpisode',
      'episodeClosed',
      'evaluate',
      'evidenceToReveal',
      'explain',
      'markRevealed',
      'observe',
      'predict',
      'serialize',
      'shouldReveal',
    ].sort(),
  );
  expect(api.STATE_VERSION).toBe(1);
});
