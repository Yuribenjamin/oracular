import { version } from 'react';
import { describe, expect, it } from 'vitest';

describe('the React under test', () => {
  it('is the major the run asked for: 19 by default, 18 under npm run test:react18', () => {
    const major = process.env.ORACULAR_EXPECT_REACT ?? '19';
    expect(version.startsWith(`${major}.`), `React ${version}`).toBe(true);
  });
});
