import type { Snapshot } from './types';

export type { IntentSnapshot, Snapshot } from './types';

/** Options for {@link renderInspector}. */
export interface RenderOptions {
  /** Heading above the tables. Default "oracular". */
  title?: string;
  /** Decimal places for probabilities and weights. Default 3. */
  digits?: number;
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const BOX =
  'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:#1f2328;background:#fff;border:1px solid #d0d7de;border-radius:6px;padding:10px 12px;max-width:100%;overflow:auto';
const TABLE = 'border-collapse:collapse;margin:6px 0 10px';
const CELL = 'padding:2px 10px 2px 0;text-align:right;white-space:nowrap';
const HEAD = `${CELL};color:#656d76;font-weight:normal;border-bottom:1px solid #d8dee4`;
const NAME = 'padding:2px 10px 2px 0;text-align:left;white-space:nowrap';

/**
 * A snapshot as an HTML fragment: for each intent, its prediction and its gate in one line, then
 * one row per signal with the contribution it holds, its impact on p, the initial, learned and
 * effective weights, and the hit/miss record. Inline styles, no script, every string escaped, so
 * the fragment can go into any element's `innerHTML` or into a file. Pure.
 *
 * @param snapshot - From {@link inspect}.
 * @param opts - `title` and `digits`.
 * @returns An HTML string.
 * @example
 * ```ts
 * panel.innerHTML = renderInspector(inspect(state, Date.now()));
 * ```
 */
export function renderInspector(snapshot: Snapshot, opts: RenderOptions = {}): string {
  const digits = opts.digits ?? 3;
  const n = (x: number) => x.toFixed(digits);
  const time = (t: number | null) => (t === null ? '–' : new Date(t).toISOString());
  const title = escapeHtml(opts.title ?? 'oracular');
  const parts: string[] = [
    `<div style="${BOX}">`,
    `<div><strong>${title}</strong> <span style="color:#656d76">at ${time(snapshot.at)}</span></div>`,
  ];
  for (const { intent, prediction, reveal, explanation } of snapshot.intents) {
    const gate = reveal
      ? '<span style="color:#1a7f37;font-weight:bold">reveal</span>'
      : prediction.suppressedUntil !== null
        ? `<span style="color:#9a6700">suppressed until ${time(prediction.suppressedUntil)}</span>`
        : '<span style="color:#656d76">no reveal</span>';
    parts.push(
      `<div style="margin-top:8px"><strong>${escapeHtml(intent)}</strong> p ${n(prediction.p)} · lower ${n(prediction.lower)} · sd ${n(prediction.sd)} · evidence ${n(prediction.evidence)} · ${gate}</div>`,
    );
    if (explanation.length === 0) {
      parts.push('<div style="color:#656d76">no signals declared</div>');
      continue;
    }
    parts.push(`<table style="${TABLE}"><thead><tr>`);
    parts.push(`<th style="${HEAD};text-align:left">signal</th>`);
    for (const h of ['holds', 'impact on p', 'initial', 'learned', 'effective', 'hits / misses']) {
      parts.push(`<th style="${HEAD}">${h}</th>`);
    }
    parts.push('</tr></thead><tbody>');
    for (const row of explanation) {
      const dim = row.contribution === 0 ? ';color:#8c959f' : '';
      parts.push(
        `<tr><td style="${NAME}${dim}">${escapeHtml(row.signal)}</td>`,
        `<td style="${CELL}${dim}">${n(row.contribution)}</td>`,
        `<td style="${CELL}${dim}">${row.impact >= 0 ? '+' : ''}${n(row.impact)}</td>`,
        `<td style="${CELL}${dim}">${n(row.initialWeight)}</td>`,
        `<td style="${CELL}${dim}">${n(row.learnedWeight)}</td>`,
        `<td style="${CELL}${dim}">${n(row.effectiveWeight)}</td>`,
        `<td style="${CELL}${dim}">${n(row.hits)} / ${n(row.misses)}</td></tr>`,
      );
    }
    parts.push('</tbody></table>');
  }
  parts.push('</div>');
  return parts.join('');
}

/** What {@link mountInspector} returns. */
export interface MountedInspector {
  /** Re-reads the snapshot and re-renders. Call it after every `observe`, or from a timer you own. */
  update: () => void;
  /** Empties the container. */
  unmount: () => void;
}

/**
 * Renders a live inspector into a container and keeps it current on demand. The container is
 * anything with an `innerHTML` property, so a DOM element; the library itself touches no DOM API
 * and sets no timer. Your app decides when to refresh: after each `observe`, or on an interval.
 *
 * @param container - The element to render into. Only its `innerHTML` is written.
 * @param read - Returns the snapshot to show, typically `() => inspect(state, Date.now())`.
 * @param opts - Passed to {@link renderInspector}.
 * @returns `update` to re-render and `unmount` to clear the container. The first render happens
 *   at once.
 * @example
 * ```ts
 * const panel = mountInspector(document.querySelector('#oracular')!, () => inspect(state, Date.now()));
 * state = observe(state, event);
 * panel.update();
 * ```
 */
export function mountInspector(
  container: { innerHTML: string },
  read: () => Snapshot,
  opts: RenderOptions = {},
): MountedInspector {
  const update = () => {
    container.innerHTML = renderInspector(read(), opts);
  };
  update();
  return {
    update,
    unmount: () => {
      container.innerHTML = '';
    },
  };
}
