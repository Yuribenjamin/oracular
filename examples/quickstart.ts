import { createState, markRevealed, observe, shouldReveal } from 'oracular';
let state = createState({
  episodeTimeout: 30 * 60 * 1000, // 30 idle minutes end a session
  intents: {
    upgrade: {
      prior: 0.05, priorStrength: 10, halfLife: 7 * 24 * 60 * 60 * 1000, // one week, in ms
      signals: { 'pricing.viewed': 3, 'limit.hit': 2, 'export.clicked': 1 },
      outcome: 'upgrade.completed',
    },
  },
});
state = observe(state, { name: 'pricing.viewed', at: Date.now() });
if (shouldReveal(state, 'upgrade', Date.now())) {
  state = markRevealed(state, 'upgrade', Date.now()); // ...then show your offer
}
