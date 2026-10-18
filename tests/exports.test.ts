import * as api from 'oracular';
import { expect, it } from 'vitest';

it('exports exactly the public surface', () => {
  expect(Object.keys(api).sort()).toStrictEqual(
    [
      'RECORD_VERSION',
      'STATE_VERSION',
      'createEndRecord',
      'createRecord',
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
  expect(api.STATE_VERSION).toBe(2);
  expect(api.RECORD_VERSION).toBe(1);
});
