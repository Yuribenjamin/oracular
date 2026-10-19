import { createState, observe, serialize } from 'oracular';
import { act, type ReactElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertInvariants, DAY, MINUTE } from '../../../tests/helpers';
import {
  createIntentStore,
  IntentProvider,
  type IntentStore,
  type PersistAdapter,
  useIntent,
  useIntentContext,
} from '../src';

const T = 1_700_000_000_000;
const thin = {
  intents: {
    tip: { prior: 0.5, priorStrength: 2, halfLife: DAY, signals: { s: 5 }, saturate: false },
  },
};

function fakeAdapter(initial: string | null = null) {
  const writes: string[] = [];
  let stored = initial;
  const adapter: PersistAdapter = {
    load: () => stored,
    save: (json) => {
      stored = json;
      writes.push(json);
    },
  };
  return { adapter, writes };
}

/** Mounts with react-dom/client under act(); clicks dispatch real DOM events. */
function mount(element: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const errors: unknown[] = [];
  const root = createRoot(container, {
    onUncaughtError: (error) => {
      errors.push(error);
    },
  });
  act(() => {
    root.render(element);
  });
  const text = (selector: string) => container.querySelector(selector)?.textContent ?? null;
  const click = (label: string) => {
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === label);
    if (button === undefined) throw new Error(`no button "${label}"`);
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };
  const settle = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };
  const unmount = () => {
    act(() => {
      root.unmount();
    });
    container.remove();
  };
  mounted.push(unmount);
  return { container, text, click, settle, unmount, errors };
}
const mounted: (() => void)[] = [];
afterEach(() => {
  for (const unmount of mounted.splice(0)) {
    try {
      unmount();
    } catch {
      // already unmounted by the test
    }
  }
});

function Pricing({ store }: { store: IntentStore }) {
  const { state, track, reveal, predict } = useIntent(store);
  const [offer, setOffer] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          track('s');
          if (reveal('tip')) setOffer(true);
        }}
      >
        view
      </button>
      <span id="reveals">{state.intents.tip?.revealCount}</span>
      <span id="p">{predict('tip').p.toFixed(2)}</span>
      {offer && <p id="offer">offer</p>}
    </div>
  );
}

describe('useIntent', () => {
  it('track then reveal in the same click sees the fresh state, and the snapshot follows', () => {
    const store = createIntentStore(thin, { now: () => T });
    const view = mount(<Pricing store={store} />);
    expect(view.text('#reveals')).toBe('0');
    expect(view.text('#p')).toBe('0.50');
    expect(view.text('#offer')).toBeNull();
    view.click('view');
    expect(view.text('#offer')).toBe('offer');
    expect(view.text('#reveals')).toBe('1');
    expect(view.text('#p')).toBe('0.86');
    assertInvariants(store.getState());
  });

  it('reveal is false inside the cooldown', () => {
    let t = T;
    const store = createIntentStore(thin, { now: () => t });
    const view = mount(<Pricing store={store} />);
    view.click('view');
    t += MINUTE;
    view.click('view');
    expect(view.text('#reveals')).toBe('1');
    expect(store.reveal('tip')).toBe(false);
  });

  it('loads on mount, flushes when the page hides, on pagehide, and on unmount', async () => {
    const saved = serialize(observe(createState(thin), { name: 's', at: T - 2 * DAY }));
    const { adapter, writes } = fakeAdapter(saved);
    const store = createIntentStore(thin, { persist: adapter, now: () => T });
    const view = mount(<Pricing store={store} />);
    await view.settle();
    expect(store.getState().intents.tip?.contributions.s).toBeDefined();
    expect(writes).toHaveLength(0); // the loaded state round-trips byte for byte: nothing to write

    view.click('view');
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(writes).toHaveLength(1);
    hidden.mockRestore();

    view.click('view');
    window.dispatchEvent(new Event('pagehide'));
    expect(writes).toHaveLength(2);

    view.click('view');
    view.unmount();
    expect(writes).toHaveLength(3);
    expect(writes[2]).toBe(serialize(store.getState()));
  });

  it('never ends an episode on those events', () => {
    const store = createIntentStore(thin, { now: () => T });
    const view = mount(<Pricing store={store} />);
    view.click('view');
    window.dispatchEvent(new Event('pagehide'));
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    hidden.mockRestore();
    expect(store.getState().episode.startedAt).toBe(T);
  });

  it('given a config, makes one store per component and loads it', async () => {
    const saved = serialize(observe(createState(thin), { name: 's', at: T - 2 * DAY }));
    const { adapter } = fakeAdapter(saved);
    const stores: IntentStore[] = [];
    function Own() {
      const { store, state } = useIntent(thin, { persist: adapter, now: () => T });
      if (!stores.includes(store)) stores.push(store);
      return <span id="n">{Object.keys(state.intents.tip?.contributions ?? {}).length}</span>;
    }
    const view = mount(<Own />);
    await view.settle();
    expect(view.text('#n')).toBe('1');
    expect(stores).toHaveLength(1); // the same store across renders
  });

  it('IntentProvider shares a store with useIntentContext, which throws without one', () => {
    const store = createIntentStore(thin, { now: () => T });
    function Child() {
      const { track, state } = useIntentContext();
      return (
        <button type="button" onClick={() => track('s')}>
          {state.episode.intents.tip?.seen.length ?? 0}
        </button>
      );
    }
    const view = mount(
      <IntentProvider store={store}>
        <Child />
      </IntentProvider>,
    );
    view.click('0');
    expect(view.text('button')).toBe('1');
    expect(store.getState().episode.intents.tip?.seen).toStrictEqual(['s']);

    // act() rethrows an error thrown during render; React also reports it to the console and,
    // on 18, to the window, so both are quietened for this one mount.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const swallow = (event: Event) => event.preventDefault();
    window.addEventListener('error', swallow);
    try {
      expect(() => mount(<Child />)).toThrow('needs an <IntentProvider');
    } finally {
      window.removeEventListener('error', swallow);
      quiet.mockRestore();
    }
  });
});
