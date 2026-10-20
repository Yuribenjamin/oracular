import {
  type EngineConfig,
  type EngineState,
  type EvaluateOptions,
  type Evaluation,
  type ExplainOptions,
  evaluate,
  explain,
  type Prediction,
  predict,
  type RevealOptions,
  type SignalExplanation,
  shouldReveal,
} from 'oracular';
import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { createIntentStore, type IntentStore, type IntentStoreOptions } from './store';

/**
 * What `useIntent` returns. Reads go to the store's current state, not to the rendered snapshot.
 * The functions keep their identity across renders, so a memo that should follow the state must
 * depend on `state`, not on them.
 */
export interface UseIntent {
  /** The rendered snapshot: the state as of the last change, for display. */
  state: EngineState;
  /** The store behind the hook, for code outside React. */
  store: IntentStore;
  /** `observe` with the event stamped by the store's clock. */
  track(name: string, props?: Record<string, unknown>): void;
  shouldReveal(intent: string, opts?: RevealOptions): boolean;
  /** `shouldReveal` and `markRevealed` as one step: true when the reveal happened. */
  reveal(intent: string, opts?: RevealOptions): boolean;
  predict(intent: string, opts?: RevealOptions): Prediction;
  explain(intent: string, opts?: ExplainOptions): SignalExplanation[];
  evaluate(intent: string, opts?: EvaluateOptions): Evaluation;
  /** Ends the open episode now. For sign-out; not for a tab or app going to the background. */
  endEpisode(): void;
}

function isStore(source: IntentStore | EngineConfig): source is IntentStore {
  return typeof (source as IntentStore).getState === 'function';
}

/**
 * Loads the store on mount and flushes its pending save on `pagehide`, when the page becomes
 * hidden, and on unmount. Never ends an episode. Shared by `useIntent` and `IntentProvider`, and
 * safe to run more than once on one store: a load is shared, and a flush with nothing new writes
 * nothing.
 */
function useStoreLifecycle(store: IntentStore): void {
  useEffect(() => {
    void store.load();
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return () => {
        void store.flush();
      };
    }
    const flush = (): void => {
      void store.flush();
    };
    const hidden = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
      flush();
    };
  }, [store]);
}

/**
 * Binds a component to an intent store. Pass a store created once with `createIntentStore` to
 * share it across components (or put it in an `IntentProvider`), or pass a config to give this
 * component a store of its own, created on first render with `opts` and kept for the component's
 * life: a different config on a later render is ignored.
 *
 * On mount the hook loads the persisted state (operations made before the load resolves are
 * replayed onto it) and flushes the pending save on `pagehide`, when the page becomes hidden,
 * and on unmount. It never ends an episode on those events: a short switch away is not a session
 * boundary. Set `episodeTimeout` in the config and idle gaps close episodes on their own. On
 * React Native neither page event exists; add `flushOnBackground(store, AppState)`.
 *
 * The component re-renders on every change to the state, including events no intent declares;
 * `usePrediction` and `useIntentSelector` re-render on less.
 *
 * @example
 * ```tsx
 * const store = createIntentStore(config, { persist: localStorageAdapter() });
 *
 * function Pricing() {
 *   const { track, reveal } = useIntent(store);
 *   return <button onClick={() => { track('pricing.viewed'); if (reveal('upgrade')) openOffer(); }} />;
 * }
 * ```
 */
export function useIntent(
  source: IntentStore | EngineConfig,
  opts?: IntentStoreOptions,
): UseIntent {
  const own = useRef<IntentStore | null>(null);
  if (!isStore(source) && own.current === null) own.current = createIntentStore(source, opts);
  const store = isStore(source) ? source : (own.current as IntentStore);

  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  useStoreLifecycle(store);

  const api = useMemo(
    () => ({
      store,
      track: (name: string, props?: Record<string, unknown>) => {
        store.track(name, props);
      },
      shouldReveal: (intent: string, o?: RevealOptions) =>
        shouldReveal(store.getState(), intent, store.now(), o),
      reveal: (intent: string, o?: RevealOptions) => store.reveal(intent, o),
      predict: (intent: string, o?: RevealOptions) =>
        predict(store.getState(), intent, store.now(), o),
      explain: (intent: string, o?: ExplainOptions) =>
        explain(store.getState(), intent, store.now(), o),
      evaluate: (intent: string, o?: EvaluateOptions) =>
        evaluate(store.getState(), intent, store.now(), o),
      endEpisode: () => {
        store.endEpisode();
      },
    }),
    [store],
  );

  return { state, ...api };
}

const IntentContext = createContext<IntentStore | null>(null);

export interface IntentProviderProps {
  store: IntentStore;
  children?: ReactNode;
}

/**
 * Makes one store available to every `useIntentContext()`, `useIntentStore()` and, through it,
 * `usePrediction` below it, and runs the store's lifecycle (load on mount, flush on page hide and
 * unmount) so a tree with no `useIntent` call still loads and saves.
 */
export function IntentProvider({ store, children }: IntentProviderProps) {
  useStoreLifecycle(store);
  return createElement(IntentContext.Provider, { value: store }, children);
}

function useContextStore(hook: string): IntentStore {
  const store = useContext(IntentContext);
  if (store === null) {
    throw new Error(`@oracular/react: ${hook} needs an <IntentProvider store={...}> above it`);
  }
  return store;
}

/** `useIntent` on the store of the nearest `IntentProvider`. */
export function useIntentContext(): UseIntent {
  return useIntent(useContextStore('useIntentContext'));
}

/**
 * The store of the nearest `IntentProvider`, without subscribing to it: for a component that only
 * tracks or reveals in handlers, or that passes the store to `usePrediction`.
 */
export function useIntentStore(): IntentStore {
  return useContextStore('useIntentStore');
}
