import { createState, observe, serialize } from 'oracular';
import { act, type ReactElement, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertInvariants, DAY, MINUTE } from '../../../tests/helpers';
import {
  createIntentStore,
  flushOnBackground,
  IntentProvider,
  type IntentStore,
  useIntent,
  useIntentContext,
  useIntentSelector,
  useIntentStore,
  usePrediction,
} from '../src';
import { deferredAdapter, fakeAdapter, microtasks, T } from './adapters';

const thin = {
  intents: {
    tip: { prior: 0.5, priorStrength: 2, halfLife: DAY, signals: { s: 5 }, saturate: false },
    other: { prior: 0.5, priorStrength: 2, halfLife: DAY, signals: { o: 5 }, saturate: false },
  },
};

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
  /** Lets the store's promise chains settle and React commit what they changed. */
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await microtasks();
      });
    }
  };
  const rerender = (next: ReactElement) => {
    act(() => {
      root.render(next);
    });
  };
  const unmount = () => {
    act(() => {
      root.unmount();
    });
    container.remove();
  };
  mounted.push(unmount);
  return { container, text, click, settle, rerender, unmount, errors };
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
  vi.restoreAllMocks();
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

/** Counts its renders: one object per mounted component, bumped on every render. */
function Watcher({ store, renders }: { store: IntentStore; renders: { n: number } }) {
  const { state } = useIntent(store);
  renders.n++;
  return <span id="watcher">{state.episode.lastEventAt ?? 0}</span>;
}

function Predicted({ store, renders }: { store: IntentStore; renders: { n: number } }) {
  const { p } = usePrediction(store, 'tip');
  renders.n++;
  return <span id="predicted">{p.toFixed(2)}</span>;
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

  it('under StrictMode, a slow read happens once and the fresh state is never written over it', async () => {
    const saved = serialize(observe(createState(thin), { name: 's', at: T - 2 * DAY }));
    const d = deferredAdapter(saved);
    const store = createIntentStore(thin, { persist: d.adapter, now: () => T });
    const view = mount(
      <StrictMode>
        <Pricing store={store} />
      </StrictMode>,
    );
    await view.settle(); // the double effect: load, flush, load again
    expect(d.reads()).toBe(1);
    expect(d.writes).toHaveLength(0);
    d.resolveLoad();
    await view.settle();
    expect(store.getState().intents.tip?.contributions.s).toBeDefined();
    expect(d.writes).toHaveLength(0);
    expect(d.stored()).toBe(saved);
    view.click('view');
    view.unmount();
    expect(d.writes).toHaveLength(1);
    expect(JSON.parse(d.writes[0] as string).intents.tip.revealCount).toBe(1);
  });

  it('unmounting before the read resolves writes nothing over the stored state', async () => {
    const saved = serialize(observe(createState(thin), { name: 's', at: T - 2 * DAY }));
    const d = deferredAdapter(saved);
    const store = createIntentStore(thin, { persist: d.adapter, now: () => T });
    const view = mount(<Pricing store={store} />);
    view.unmount(); // the flush waits for the read
    await microtasks();
    expect(d.writes).toHaveLength(0);
    d.resolveLoad();
    await microtasks();
    expect(d.writes).toHaveLength(0);
    expect(d.stored()).toBe(saved);
    expect(store.getState().intents.tip?.contributions.s).toBeDefined();
  });

  it('given a config, makes one store per component, loads it, and keeps it when the config changes', async () => {
    const saved = serialize(observe(createState(thin), { name: 's', at: T - 2 * DAY }));
    const { adapter } = fakeAdapter(saved);
    const stores: IntentStore[] = [];
    function Own({ config }: { config: typeof thin }) {
      const { store, state } = useIntent(config, { persist: adapter, now: () => T });
      if (!stores.includes(store)) stores.push(store);
      return <span id="n">{Object.keys(state.intents.tip?.contributions ?? {}).length}</span>;
    }
    const view = mount(<Own config={thin} />);
    await view.settle();
    expect(view.text('#n')).toBe('1');
    view.rerender(<Own config={{ ...thin }} />);
    expect(stores).toHaveLength(1); // the same store across renders and configs
  });

  it('the functions it returns keep their identity across renders', () => {
    const store = createIntentStore(thin, { now: () => T });
    const tracks: unknown[] = [];
    function Identity() {
      const { track } = useIntent(store);
      const [, bump] = useState(0);
      tracks.push(track);
      return (
        <button type="button" onClick={() => bump((n) => n + 1)}>
          bump
        </button>
      );
    }
    const view = mount(<Identity />);
    view.click('bump');
    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toBe(tracks[1]);
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

  it('IntentProvider loads the store on mount, and useIntentStore reads it without subscribing', async () => {
    const saved = serialize(observe(createState(thin), { name: 's', at: T - 2 * DAY }));
    const { adapter } = fakeAdapter(saved);
    const store = createIntentStore(thin, { persist: adapter, now: () => T });
    const renders = { n: 0 };
    let seen: IntentStore | null = null;
    function Handler() {
      seen = useIntentStore();
      renders.n++;
      return (
        <button type="button" onClick={() => seen?.track('s')}>
          go
        </button>
      );
    }
    const view = mount(
      <IntentProvider store={store}>
        <Handler />
      </IntentProvider>,
    );
    await view.settle();
    expect(seen).toBe(store);
    expect(store.getState().intents.tip?.contributions.s).toBeDefined(); // loaded by the provider
    view.click('go');
    expect(store.getState().episode.intents.tip?.seen).toStrictEqual(['s']);
    expect(renders.n).toBe(1);

    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const swallow = (event: Event) => event.preventDefault();
    window.addEventListener('error', swallow);
    try {
      expect(() => mount(<Handler />)).toThrow('useIntentStore needs an <IntentProvider');
    } finally {
      window.removeEventListener('error', swallow);
      quiet.mockRestore();
    }
  });

  it('usePrediction re-renders only when its intent changes', () => {
    let t = T;
    const store = createIntentStore(thin, { now: () => t });
    const whole = { n: 0 };
    const one = { n: 0 };
    const view = mount(
      <>
        <Watcher store={store} renders={whole} />
        <Predicted store={store} renders={one} />
      </>,
    );
    expect([whole.n, one.n]).toStrictEqual([1, 1]);
    expect(view.text('#predicted')).toBe('0.50');

    t += MINUTE;
    act(() => {
      store.track('x'); // declared by no intent: extends the episode, nothing else
    });
    expect([whole.n, one.n]).toStrictEqual([2, 1]);

    act(() => {
      store.track('o'); // the other intent
    });
    expect([whole.n, one.n]).toStrictEqual([3, 1]);

    act(() => {
      store.track('s');
    });
    expect([whole.n, one.n]).toStrictEqual([4, 2]);
    expect(view.text('#predicted')).toBe('0.86');

    act(() => {
      store.markRevealed('tip');
    });
    expect(one.n).toBe(3);
  });

  it('usePrediction takes reveal options inline without looping', () => {
    const store = createIntentStore(thin, { now: () => T });
    function Exact() {
      const { p, lower } = usePrediction(store, 'tip', { z: 0 });
      return <span id="exact">{lower === p ? 'same' : 'differs'}</span>;
    }
    const view = mount(<Exact />);
    expect(view.text('#exact')).toBe('same');
    act(() => {
      store.track('s');
    });
    expect(view.text('#exact')).toBe('same');
  });

  it('useIntentSelector re-renders only when the selection changes, with an inline selector and comparison', () => {
    const store = createIntentStore(thin, { now: () => T });
    const renders = { n: 0 };
    function Seen() {
      const seen = useIntentSelector(
        store,
        (s) => ({ n: s.episode.intents.tip?.seen.length ?? 0 }),
        (a, b) => a.n === b.n,
      );
      renders.n++;
      return <span id="seen">{seen.n}</span>;
    }
    const view = mount(<Seen />);
    expect(renders.n).toBe(1);
    act(() => {
      store.track('x');
    });
    expect(renders.n).toBe(1);
    act(() => {
      store.track('s');
    });
    expect(renders.n).toBe(2);
    expect(view.text('#seen')).toBe('1');
  });
});

describe('flushOnBackground', () => {
  function fakeAppState() {
    const listeners = new Set<(status: string) => void>();
    return {
      appState: {
        addEventListener: (_type: 'change', listener: (status: string) => void) => {
          listeners.add(listener);
          return {
            remove: () => {
              listeners.delete(listener);
            },
          };
        },
      },
      emit: (status: string) => {
        for (const listener of listeners) listener(status);
      },
      size: () => listeners.size,
    };
  }

  it('flushes when the app leaves active, and the returned function removes the listener', async () => {
    const f = fakeAdapter();
    const store = createIntentStore(thin, { persist: f.adapter, now: () => T });
    await store.load();
    const app = fakeAppState();
    const stop = flushOnBackground(store, app.appState);
    store.track('s');
    app.emit('background');
    expect(f.writes).toHaveLength(1);
    store.track('o');
    app.emit('inactive');
    expect(f.writes).toHaveLength(2);
    stop();
    expect(app.size()).toBe(0);
    store.track('x');
    app.emit('background');
    expect(f.writes).toHaveLength(2);
  });

  it('retries a failed read when the app becomes active again', async () => {
    const d = deferredAdapter(serialize(createState(thin)));
    const store = createIntentStore(thin, { persist: d.adapter, now: () => T, onError: () => {} });
    const app = fakeAppState();
    flushOnBackground(store, app.appState);
    const first = store.load();
    d.rejectLoad(new Error('busy'));
    await first;
    expect(store.getStatus()).toBe('failed');
    app.emit('active');
    expect(d.reads()).toBe(2);
    d.resolveLoad();
    await microtasks();
    expect(store.getStatus()).toBe('loaded');
  });
});
