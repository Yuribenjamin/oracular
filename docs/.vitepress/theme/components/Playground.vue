<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import {
  createState,
  deserialize,
  endEpisode,
  type EngineConfig,
  type EngineState,
  explain,
  markRevealed,
  observe,
  predict,
  type RevealOptions,
  serialize,
  shouldReveal,
} from '../../../../src/index';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

// A fixed virtual clock keeps the page deterministic: Monday 5 January 2026, 09:00 UTC.
const START = Date.UTC(2026, 0, 5, 9, 0, 0);

const defaultConfig: EngineConfig = {
  intents: {
    upgrade: {
      prior: 0.05,
      priorStrength: 10,
      halfLife: WEEK,
      signals: { 'pricing.viewed': 3, 'limit.hit': 2, 'export.clicked': 1 },
      outcome: 'upgrade.completed',
    },
  },
};

const state = shallowRef<EngineState>(createState(defaultConfig));
const now = ref(START);
const intentName = ref('upgrade');
const configText = ref(JSON.stringify(defaultConfig, null, 2));
const configError = ref<string | null>(null);
const configNote = ref<string | null>(null);
const log = ref<string[]>([]);
// How `lower` is computed, passed per call so the config above stays as written.
const bound = ref<'normal' | 'exact'>('normal');
const revealOpts = computed<RevealOptions>(() => ({ bound: bound.value }));
watch(bound, (b) => note(`bound: '${b}'`));

const intentNames = computed(() => Object.keys(state.value.config.intents));
watch(intentNames, (names) => {
  if (!names.includes(intentName.value)) intentName.value = names[0] ?? '';
});

const signalButtons = computed(() => {
  const seen = new Map<string, string[]>();
  for (const [intent, cfg] of Object.entries(state.value.config.intents)) {
    for (const [signal, weight] of Object.entries(cfg.signals)) {
      const label = `${intent} ${weight > 0 ? '+' : ''}${weight}`;
      seen.set(signal, [...(seen.get(signal) ?? []), label]);
    }
  }
  return [...seen.entries()].map(([name, labels]) => ({ name, hint: labels.join(', ') }));
});

const outcomeButtons = computed(() => {
  const seen = new Map<string, string[]>();
  for (const [intent, cfg] of Object.entries(state.value.config.intents)) {
    if (cfg.outcome) seen.set(cfg.outcome, [...(seen.get(cfg.outcome) ?? []), intent]);
  }
  return [...seen.entries()].map(([name, intents]) => ({ name, hint: `outcome of ${intents.join(', ')}` }));
});

const prediction = computed(() =>
  intentName.value ? predict(state.value, intentName.value, now.value, revealOpts.value) : null,
);
const fires = computed(() =>
  intentName.value ? shouldReveal(state.value, intentName.value, now.value, revealOpts.value) : false,
);
const rows = computed(() => (intentName.value ? explain(state.value, intentName.value, now.value) : []));
const intentState = computed(() => (intentName.value ? state.value.intents[intentName.value] : undefined));
const episode = computed(() => state.value.episode);
const episodeRecord = computed(() => episode.value.intents[intentName.value]);
const json = computed(() => JSON.stringify(JSON.parse(serialize(state.value)), null, 2));
const bytes = computed(() => new TextEncoder().encode(serialize(state.value)).length);

function fmtTime(t: number | null): string {
  if (t === null) return '—';
  return `${new Date(t).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

function fmtDuration(ms: number): string {
  if (ms < MINUTE) return `${Math.round(ms / 1000)} s`;
  if (ms < HOUR) return `${Math.round(ms / MINUTE)} min`;
  if (ms < DAY) return `${(ms / HOUR).toFixed(1)} h`;
  return `${(ms / DAY).toFixed(1)} d`;
}

function fmt(n: number, digits = 3): string {
  return n.toFixed(digits);
}

function note(line: string): void {
  log.value = [`${fmtTime(now.value)}  ${line}`, ...log.value].slice(0, 12);
}

function advance(ms: number, label: string): void {
  now.value += ms;
  note(`clock ${label}`);
}

function fire(name: string): void {
  state.value = observe(state.value, { name, at: now.value });
  note(`observe "${name}"`);
}

function end(): void {
  state.value = endEpisode(state.value, now.value);
  note('endEpisode');
}

function reveal(): void {
  if (!intentName.value) return;
  state.value = markRevealed(state.value, intentName.value, now.value);
  note(`markRevealed "${intentName.value}"`);
}

function reset(): void {
  state.value = createState(state.value.config);
  now.value = START;
  log.value = [];
  configNote.value = null;
}

function applyConfig(): void {
  configNote.value = null;
  try {
    const parsed: unknown = JSON.parse(configText.value);
    state.value = deserialize(serialize(state.value), { config: parsed as EngineConfig });
    configError.value = null;
    configNote.value = 'Applied. Learned data for signals that still exist was kept; α and β were recomputed.';
    note('config applied');
  } catch (error) {
    configError.value = error instanceof Error ? error.message : String(error);
  }
}

function restoreDefaultConfig(): void {
  configText.value = JSON.stringify(defaultConfig, null, 2);
  configError.value = null;
  applyConfig();
}
</script>

<template>
  <div class="pg">
    <section class="pg-row pg-clock">
      <div>
        <span class="pg-label">Virtual clock</span>
        <strong class="pg-mono">{{ fmtTime(now) }}</strong>
        <span class="pg-muted">(+{{ fmtDuration(now - START) }} since start)</span>
      </div>
      <div class="pg-buttons">
        <button type="button" @click="advance(MINUTE, '+1 min')">+1 min</button>
        <button type="button" @click="advance(HOUR, '+1 hour')">+1 hour</button>
        <button type="button" @click="advance(DAY, '+1 day')">+1 day</button>
        <button type="button" @click="advance(WEEK, '+1 week')">+1 week</button>
      </div>
    </section>

    <section class="pg-row">
      <span class="pg-label">Events</span>
      <div class="pg-buttons">
        <button
          v-for="b in signalButtons"
          :key="b.name"
          type="button"
          class="pg-signal"
          :title="b.hint"
          @click="fire(b.name)"
        >
          {{ b.name }} <small>{{ b.hint }}</small>
        </button>
        <button
          v-for="b in outcomeButtons"
          :key="b.name"
          type="button"
          class="pg-outcome"
          :title="b.hint"
          @click="fire(b.name)"
        >
          {{ b.name }} <small>{{ b.hint }}</small>
        </button>
      </div>
      <div class="pg-buttons">
        <button type="button" @click="end">End episode</button>
        <button type="button" :disabled="!intentName" @click="reveal">Mark revealed</button>
        <button type="button" class="pg-danger" @click="reset">Reset</button>
      </div>
    </section>

    <section v-if="intentNames.length > 1" class="pg-row">
      <label class="pg-label" for="pg-intent">Intent</label>
      <select id="pg-intent" v-model="intentName">
        <option v-for="name in intentNames" :key="name" :value="name">{{ name }}</option>
      </select>
    </section>

    <section v-if="prediction" class="pg-readout">
      <div class="pg-verdict" :class="fires ? 'pg-yes' : 'pg-no'">
        <span class="pg-label">shouldReveal("{{ prediction.intent }}")</span>
        <strong>{{ fires ? 'true' : 'false' }}</strong>
        <span v-if="prediction.suppressedUntil !== null" class="pg-muted">
          suppressed until {{ fmtTime(prediction.suppressedUntil) }}
        </span>
      </div>
      <div class="pg-bound">
        <span class="pg-label">lower bound</span>
        <label><input v-model="bound" type="radio" name="pg-bound" value="normal" /> normal: p − z·sd</label>
        <label><input v-model="bound" type="radio" name="pg-bound" value="exact" /> exact: the Beta quantile at Φ(−z)</label>
        <span class="pg-muted">passed as <code>{ bound: '{{ bound }}' }</code> to predict and shouldReveal</span>
      </div>
      <dl class="pg-stats">
        <div><dt>p</dt><dd class="pg-mono">{{ fmt(prediction.p) }}</dd></div>
        <div><dt>lower ({{ bound === 'exact' ? 'Beta quantile at Φ(−z)' : 'p − z·sd' }})</dt><dd class="pg-mono">{{ fmt(prediction.lower) }}</dd></div>
        <div><dt>sd</dt><dd class="pg-mono">{{ fmt(prediction.sd) }}</dd></div>
        <div><dt>confidence</dt><dd class="pg-mono">{{ fmt(prediction.confidence) }}</dd></div>
        <div><dt>evidence (α + β)</dt><dd class="pg-mono">{{ fmt(prediction.evidence, 2) }}</dd></div>
        <div><dt>revealed</dt><dd class="pg-mono">{{ prediction.revealed }}</dd></div>
        <div><dt>suppressedUntil</dt><dd class="pg-mono">{{ fmtTime(prediction.suppressedUntil) }}</dd></div>
        <div><dt>lastOutcomeAt</dt><dd class="pg-mono">{{ fmtTime(intentState?.lastOutcomeAt ?? null) }}</dd></div>
        <div>
          <dt>episode</dt>
          <dd class="pg-mono">
            <template v-if="episode.startedAt === null">none open</template>
            <template v-else>
              open since {{ fmtTime(episode.startedAt) }}<br />
              seen: {{ episodeRecord?.seen.length ? episodeRecord.seen.join(', ') : 'nothing' }}
              <template v-if="episodeRecord?.resolved"> · resolved</template>
            </template>
          </dd>
        </div>
      </dl>
    </section>

    <section v-if="rows.length" class="pg-table">
      <span class="pg-label">explain("{{ intentName }}")</span>
      <table>
        <thead>
          <tr>
            <th>signal</th>
            <th>contribution</th>
            <th>impact</th>
            <th>initial</th>
            <th>learned</th>
            <th>effective</th>
            <th>hits</th>
            <th>misses</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.signal">
            <td>{{ r.signal }}</td>
            <td class="pg-mono">{{ fmt(r.contribution, 2) }}</td>
            <td class="pg-mono" :class="r.impact > 0 ? 'pg-pos' : r.impact < 0 ? 'pg-neg' : ''">{{ fmt(r.impact) }}</td>
            <td class="pg-mono">{{ fmt(r.initialWeight, 2) }}</td>
            <td class="pg-mono">{{ fmt(r.learnedWeight, 2) }}</td>
            <td class="pg-mono">{{ fmt(r.effectiveWeight, 2) }}</td>
            <td class="pg-mono">{{ fmt(r.hits, 2) }}</td>
            <td class="pg-mono">{{ fmt(r.misses, 2) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="pg-config">
      <label class="pg-label" for="pg-config">Config (JSON)</label>
      <textarea id="pg-config" v-model="configText" rows="14" spellcheck="false"></textarea>
      <div class="pg-buttons">
        <button type="button" @click="applyConfig">Apply (keep learned data)</button>
        <button type="button" @click="restoreDefaultConfig">Restore default</button>
      </div>
      <p v-if="configError" class="pg-error" role="alert">{{ configError }}</p>
      <p v-else-if="configNote" class="pg-ok">{{ configNote }}</p>
    </section>

    <details class="pg-json">
      <summary>What the engine knows: <code>serialize(state)</code>, live ({{ bytes }} bytes)</summary>
      <p class="pg-muted">
        This is the entire state. Plain JSON, nothing hidden: your config snapshot, α and β per
        intent, per-signal contributions and hit/miss counts, the open episode, and the reveal
        and outcome timestamps. Event props are never in here.
      </p>
      <pre class="pg-mono">{{ json }}</pre>
    </details>

    <section v-if="log.length" class="pg-log">
      <span class="pg-label">Log</span>
      <ol class="pg-mono">
        <li v-for="(line, i) in log" :key="i">{{ line }}</li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.pg {
  display: grid;
  gap: 1rem;
  margin: 1.5rem 0;
}
.pg section,
.pg details {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  padding: 0.9rem 1rem;
}
.pg-row {
  display: grid;
  gap: 0.6rem;
}
.pg-clock > div:first-child {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.6rem;
}
.pg-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--vp-c-text-2);
}
.pg-muted {
  color: var(--vp-c-text-3);
  font-size: 0.85rem;
}
.pg-mono {
  font-family: var(--vp-font-family-mono);
  font-size: 0.85rem;
}
.pg-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.pg button,
.pg select {
  font: inherit;
  font-size: 0.875rem;
  padding: 0.4rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.pg button:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
}
.pg button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.pg button small {
  display: block;
  font-size: 0.7rem;
  color: var(--vp-c-text-3);
}
.pg-signal {
  border-color: var(--vp-c-brand-soft) !important;
  background: var(--vp-c-brand-soft) !important;
}
.pg-outcome {
  border-color: var(--vp-c-green-soft) !important;
  background: var(--vp-c-green-soft) !important;
}
.pg-danger:hover {
  border-color: var(--vp-c-red-1) !important;
}
.pg-readout {
  display: grid;
  gap: 0.9rem;
}
.pg-verdict {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0.6rem 0.8rem;
  border-radius: 8px;
}
.pg-verdict strong {
  font-family: var(--vp-font-family-mono);
  font-size: 1.4rem;
}
.pg-yes {
  background: var(--vp-c-green-soft);
  color: var(--vp-c-green-1);
}
.pg-no {
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-1);
}
.pg-bound {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem 1rem;
  font-size: 0.875rem;
}
.pg-bound label {
  cursor: pointer;
}
.pg-bound input {
  margin-right: 0.3rem;
}
.pg-stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
  gap: 0.6rem 1rem;
  margin: 0;
}
.pg-stats dt {
  font-size: 0.75rem;
  color: var(--vp-c-text-2);
}
.pg-stats dd {
  margin: 0;
}
.pg-table table {
  width: 100%;
  margin: 0.5rem 0 0;
  display: table;
}
.pg-table th,
.pg-table td {
  text-align: right;
  padding: 0.3rem 0.5rem;
}
.pg-table th:first-child,
.pg-table td:first-child {
  text-align: left;
}
.pg-pos {
  color: var(--vp-c-green-1);
}
.pg-neg {
  color: var(--vp-c-red-1);
}
.pg-config textarea {
  width: 100%;
  margin: 0.4rem 0 0.6rem;
  padding: 0.6rem;
  font-family: var(--vp-font-family-mono);
  font-size: 0.8rem;
  line-height: 1.4;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  resize: vertical;
}
.pg-error {
  margin: 0.6rem 0 0;
  color: var(--vp-c-red-1);
  font-family: var(--vp-font-family-mono);
  font-size: 0.8rem;
  white-space: pre-wrap;
}
.pg-ok {
  margin: 0.6rem 0 0;
  color: var(--vp-c-green-1);
  font-size: 0.85rem;
}
.pg-json summary {
  cursor: pointer;
  font-weight: 500;
}
.pg-json pre {
  margin: 0.6rem 0 0;
  max-height: 28rem;
  overflow: auto;
  padding: 0.75rem;
  border-radius: 8px;
  background: var(--vp-c-bg);
  font-size: 0.75rem;
  line-height: 1.45;
}
.pg-log ol {
  margin: 0.4rem 0 0;
  padding-left: 1.2rem;
}
.pg-log li {
  white-space: pre;
}
</style>
