import { type EngineState, type Prediction, predict, type RevealOptions } from 'oracular';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { IntentStore } from './store';

/**
 * Subscribes a component to one value derived from the store's state, re-rendering only when
 * that value changes. `selector` runs on every change (keep it cheap, or memoize it); `isEqual`
 * decides whether its result counts as changed, default `Object.is`, so select something whose
 * identity is stable, such as one intent's state, or pass a comparison for a fresh object.
 *
 * @example
 * ```tsx
 * const seen = useIntentSelector(store, (s) => s.episode.intents.upgrade?.seen.length ?? 0);
 * ```
 */
export function useIntentSelector<T>(
  store: IntentStore,
  selector: (state: EngineState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  // The value the component last rendered with, written after the commit; an equal new
  // selection returns this object, and React then skips the re-render.
  const committed = useRef<{ value: T } | null>(null);
  const [getSelection, getServerSelection] = useMemo(() => {
    let memo: { state: EngineState; value: T } | null = null;
    const select = (): T => {
      const state = store.getState();
      if (memo !== null && memo.state === state) return memo.value;
      let value = selector(state);
      if (memo !== null && isEqual(memo.value, value)) value = memo.value;
      else if (committed.current !== null && isEqual(committed.current.value, value)) {
        value = committed.current.value;
      }
      memo = { state, value };
      return value;
    };
    // The server rendered the fresh state; hydration selects over the same one, once, so that a
    // store loaded before hydration shows the loaded selection only after the markup matched.
    let server: { value: T } | null = null;
    const selectServer = (): T => {
      if (server === null) server = { value: selector(store.getInitialState()) };
      return server.value;
    };
    return [select, selectServer] as const;
  }, [store, selector, isEqual]);
  const value = useSyncExternalStore(store.subscribe, getSelection, getServerSelection);
  useEffect(() => {
    committed.current = { value };
  }, [value]);
  return value;
}

/** Selects the whole state, for `usePrediction`; one function, so the selector memo holds. */
const whole = (s: EngineState): EngineState => s;

/**
 * The intent's prediction, re-rendering only when that intent's state changes: an event no
 * intent declares, or one that touches other intents, leaves this component alone. The value is
 * the prediction as of the last change or render; a cooldown ending on its own does not
 * re-render, so schedule a check on `suppressedUntil` if the screen must react to it. It is
 * computed from the rendered snapshot, so under server rendering it hydrates with what the server
 * rendered before showing the loaded state.
 *
 * @example
 * ```tsx
 * const { p, lower, suppressedUntil } = usePrediction(store, 'upgrade');
 * ```
 */
export function usePrediction(
  store: IntentStore,
  intent: string,
  opts?: RevealOptions,
): Prediction {
  // The whole state is selected, so the prediction is computed from the snapshot React rendered
  // (the fresh one during hydration); the comparison keeps the previous state object, and so the
  // render, while this intent's state is the same object.
  const state = useIntentSelector(
    store,
    whole,
    useCallback(
      (a: EngineState, b: EngineState) => a.intents[intent] === b.intents[intent],
      [intent],
    ),
  );
  const threshold = opts?.threshold;
  const z = opts?.z;
  const cooldown = opts?.cooldown;
  const bound = opts?.bound;
  return useMemo(() => {
    const o: RevealOptions = {};
    if (threshold !== undefined) o.threshold = threshold;
    if (z !== undefined) o.z = z;
    if (cooldown !== undefined) o.cooldown = cooldown;
    if (bound !== undefined) o.bound = bound;
    return predict(state, intent, store.now(), o);
  }, [state, store, intent, threshold, z, cooldown, bound]);
}
