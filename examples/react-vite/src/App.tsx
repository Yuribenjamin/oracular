import { type IntentStore, useIntent } from '@oracular/react';
import { inspect } from 'oracular';
import { renderInspector } from 'oracular/inspect';
import { type CSSProperties, useEffect, useRef, useState } from 'react';

const PLANS = [
  { name: 'Free', price: '$0', blurb: 'One project, three exports a month' },
  { name: 'Pro', price: '$12', blurb: 'Unlimited projects and exports' },
  { name: 'Team', price: '$40', blurb: 'Pro for five, with roles' },
];

export function App({ store }: { store: IntentStore }) {
  const { state, track, reveal, predict, endEpisode } = useIntent(store);
  const [offer, setOffer] = useState(false);
  const panel = useRef<HTMLElement>(null);

  // The inspector is framework-free HTML; re-render it whenever the state changes.
  useEffect(() => {
    if (panel.current !== null) {
      panel.current.innerHTML = renderInspector(inspect(state, store.now()), { title: 'inspector' });
    }
  }, [state, store]);

  // Every signal is an ordinary event; the reveal check runs against the state after it.
  const signal = (name: string) => {
    track(name);
    if (reveal('upgrade')) setOffer(true);
  };
  const p = predict('upgrade');

  return (
    <main style={styles.main}>
      <section>
        <h1>Pricing</h1>
        <p>
          Each button is an event the app already emits. The offer appears when the engine is
          confident enough, from this browser's events alone; the panel shows p and the lower bound
          moving.
        </p>
        <div style={styles.plans}>
          {PLANS.map((plan) => (
            <article key={plan.name} style={styles.plan}>
              <h2>{plan.name}</h2>
              <p style={styles.price}>
                {plan.price}
                <small> / month</small>
              </p>
              <p>{plan.blurb}</p>
              <button type="button" onClick={() => signal('pricing.viewed')}>
                See details
              </button>
            </article>
          ))}
        </div>
        <div style={styles.row}>
          <button type="button" onClick={() => signal('limit.hit')}>
            Hit a plan limit
          </button>
          <button type="button" onClick={() => signal('export.clicked')}>
            Export
          </button>
          <button
            type="button"
            onClick={() => {
              track('upgrade.completed');
              setOffer(false);
            }}
          >
            Upgrade (the outcome)
          </button>
          <button type="button" onClick={() => endEpisode()}>
            Sign out (ends the session)
          </button>
        </div>
        <p style={styles.meter}>
          p {p.p.toFixed(3)} · lower bound {p.lower.toFixed(3)} ·{' '}
          {p.suppressedUntil === null ? 'free to fire' : 'in cooldown'}
        </p>
        {offer && (
          <aside style={styles.offer}>
            <strong>Ready for Pro?</strong> Two weeks free, no card needed.{' '}
            <button type="button" onClick={() => setOffer(false)}>
              Later
            </button>
          </aside>
        )}
      </section>
      <aside ref={panel} style={styles.panel} />
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  main: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 380px',
    gap: 24,
    padding: 24,
    fontFamily: 'system-ui, sans-serif',
  },
  plans: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 },
  plan: { border: '1px solid #ddd', borderRadius: 8, padding: 16 },
  price: { fontSize: 24, margin: '4px 0' },
  row: { display: 'flex', gap: 8, flexWrap: 'wrap', margin: '16px 0' },
  meter: { color: '#555' },
  offer: { background: '#fff7e0', border: '1px solid #f0c060', borderRadius: 8, padding: 12 },
  panel: {
    borderLeft: '1px solid #ddd',
    paddingLeft: 16,
    fontSize: 14,
    overflow: 'auto',
    maxHeight: '90vh',
  },
};
