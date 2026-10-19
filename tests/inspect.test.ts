import { createState, evaluate, inspect, observe, type Snapshot } from 'oracular';
import { mountInspector, renderInspector } from 'oracular/inspect';
import { describe, expect, it } from 'vitest';
import { deepFreeze, MINUTE, upgradeConfig } from './helpers';

const T = 1_700_000_000_000;

function twoIntents() {
  const base = upgradeConfig({ episodeTimeout: 30 * MINUTE });
  return {
    ...base,
    intents: {
      ...base.intents,
      '<stuck>': {
        prior: 0.1,
        priorStrength: 5,
        halfLife: 10 * MINUTE,
        signals: { 'editor.undo': 1, '"help".opened': 3 },
        outcome: 'help.article.read',
      },
    },
  };
}

describe('inspect', () => {
  it('is evaluate for every intent, in config order, at one moment', () => {
    let s = createState(twoIntents());
    s = observe(s, { name: 'pricing.viewed', at: T });
    s = observe(s, { name: 'editor.undo', at: T });
    const snapshot = inspect(deepFreeze(s), T + MINUTE);
    expect(snapshot.at).toBe(T + MINUTE);
    expect(snapshot.intents.map((i) => i.intent)).toStrictEqual(['upgrade', '<stuck>']);
    for (const { intent, ...rest } of snapshot.intents) {
      expect(rest).toStrictEqual(evaluate(s, intent, T + MINUTE));
    }
    const filtered = inspect(s, T + MINUTE, { nonZero: true, threshold: 0.1, z: 0 });
    expect(filtered.intents[0]?.explanation.map((r) => r.signal)).toStrictEqual(['pricing.viewed']);
    expect(filtered.intents[0]?.reveal).toBe(
      evaluate(s, 'upgrade', T + MINUTE, { threshold: 0.1, z: 0 }).reveal,
    );
  });

  it('validates like evaluate', () => {
    const s = createState(twoIntents());
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
    expect(() => inspect({} as any, T)).toThrow(TypeError);
    expect(() => inspect(s, Number.NaN)).toThrow(TypeError);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
    expect(() => inspect(s, T, { nope: 1 } as any)).toThrow(TypeError);
  });
});

describe('renderInspector', () => {
  const snapshot = (): Snapshot => {
    let s = createState(twoIntents());
    s = observe(s, { name: 'pricing.viewed', at: T });
    s = observe(s, { name: '"help".opened', at: T });
    return inspect(s, T + MINUTE);
  };

  it('renders one block per intent with the prediction, the gate and every signal', () => {
    const html = renderInspector(snapshot(), { title: 'my app' });
    expect(html.startsWith('<div style=')).toBe(true);
    expect(html.endsWith('</div>')).toBe(true);
    expect(html).toContain('<strong>my app</strong>');
    expect(html).toContain(`at ${new Date(T + MINUTE).toISOString()}`);
    expect(html).toContain('<strong>upgrade</strong> p 0.269');
    expect(html).toContain('no reveal');
    expect(html.match(/<table/g)).toHaveLength(2);
    // Every declared signal appears, including the ones holding nothing.
    for (const signal of ['pricing.viewed', 'limit.hit', 'export.clicked', 'plan.downgraded']) {
      expect(html).toContain(`>${signal}</td>`);
    }
    expect(html).toContain(
      '<th style="padding:2px 10px 2px 0;text-align:right;white-space:nowrap;color:#656d76;font-weight:normal;border-bottom:1px solid #d8dee4">hits / misses</th>',
    );
  });

  it('escapes every string that came from the app, and contains no script', () => {
    const html = renderInspector(snapshot(), { title: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&#60;script&#62;alert(1)&#60;/script&#62;');
    expect(html).toContain('&#60;stuck&#62;');
    expect(html).toContain('&#34;help&#34;.opened');
    expect(html).not.toMatch(/<stuck>|"help"/);
  });

  it('shows the reveal and the suppression states, and honours digits', () => {
    let s = createState(upgradeConfig({ episodeTimeout: 30 * MINUTE }));
    for (let i = 0; i < 6; i++) s = observe(s, { name: 'pricing.viewed', at: T + i * 60 * MINUTE });
    const at = T + 6 * 60 * MINUTE;
    const open = renderInspector(inspect(s, at), { digits: 2 });
    expect(open).toContain('>reveal</span>');
    expect(open).toMatch(/p 0\.\d\d · lower/);
    s = observe(s, { name: 'upgrade.completed', at });
    const quiet = renderInspector(inspect(s, at + MINUTE));
    expect(quiet).toContain('suppressed until');
    expect(quiet).toContain(
      new Date(s.intents.upgrade!.lastOutcomeAt! + 7 * 24 * 60 * MINUTE).toISOString(),
    );
  });

  it('says so for an intent without signals', () => {
    const s = createState({
      intents: { x: { prior: 0.5, priorStrength: 1, halfLife: 1, signals: {} } },
    });
    expect(renderInspector(inspect(s, T))).toContain('no signals declared');
  });
});

describe('mountInspector', () => {
  it('renders at once into anything with an innerHTML, re-renders on update, clears on unmount', () => {
    let s = createState(upgradeConfig());
    const container = { innerHTML: 'before' };
    const reads: number[] = [];
    const panel = mountInspector(container, () => {
      reads.push(1);
      return inspect(s, T);
    });
    expect(reads).toHaveLength(1);
    expect(container.innerHTML).toBe(renderInspector(inspect(s, T)));
    s = observe(s, { name: 'pricing.viewed', at: T });
    panel.update();
    expect(reads).toHaveLength(2);
    expect(container.innerHTML).toBe(renderInspector(inspect(s, T)));
    expect(container.innerHTML).toContain('p 0.269');
    panel.unmount();
    expect(container.innerHTML).toBe('');
  });
});
