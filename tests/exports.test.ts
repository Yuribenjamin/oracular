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
      'inspect',
      'markRevealed',
      'ms',
      'observe',
      'predict',
      'serialize',
      'settleState',
      'shouldReveal',
      'validateConfig',
    ].sort(),
  );
  expect(api.STATE_VERSION).toBe(4);
  expect(api.RECORD_VERSION).toBe(1);
});
