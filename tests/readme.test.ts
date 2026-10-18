import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const readme = readFileSync(new URL('README.md', root), 'utf8');
const quickstart = readFileSync(new URL('examples/quickstart.ts', root), 'utf8');

describe('README', () => {
  it('opens with the headline', () => {
    expect(readme).toContain('Your app learns when the user is ready. Nothing leaves the device.');
  });

  it('first code block is TypeScript, at most 15 lines, and identical to examples/quickstart.ts', () => {
    const match = /```([a-z]*)\n([\s\S]*?)```/.exec(readme);
    expect(match, 'README has a fenced code block').not.toBeNull();
    const [, lang, body] = match!;
    expect(lang).toBe('ts');
    expect(body!.trimEnd().split('\n').length).toBeLessThanOrEqual(15);
    expect(body).toBe(quickstart);
  });

  it('the quickstart example runs', async () => {
    await expect(import('../examples/quickstart')).resolves.toBeDefined();
  });

  it('mentions no stale working names', () => {
    expect(readme).not.toMatch(/intent-engine/);
  });
});
