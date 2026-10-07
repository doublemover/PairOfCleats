const COUNTERS = Object.freeze([
  'searches', 'cacheHits', 'cacheStatusUnknown', 'searchesWithAnnStages',
  'searchesWithoutAnnStages', 'annStages', 'vectorEligibleStages',
  'vectorResultStages', 'minhashResultStages', 'noResultStages',
  'unknownResultStages', 'sparseBypassStages'
]);
const VECTOR_SOURCES = new Set(['js', 'sqlite-vector', 'hnsw', 'lancedb']);
const SOURCES = new Set([...VECTOR_SOURCES, 'minhash']);
const MODES = new Set(['code', 'prose', 'extracted-prose', 'records']);
const REPORTED_BACKENDS = new Set(['js', 'sqlite-extension', 'hnsw', 'lancedb', 'none']);
const COUNT_MAPS = Object.freeze(['annSources', 'modes', 'reportedAnnBackends']);

const createRow = () => ({
  ...Object.fromEntries(COUNTERS.map((key) => [key, 0])),
  annSources: {},
  modes: {},
  reportedAnnBackends: {}
});
const increment = (counts, key) => { counts[key] = (counts[key] || 0) + 1; };
const sortedCounts = (counts) => Object.fromEntries(
  Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))
);
const copyRow = (row) => ({
  ...Object.fromEntries(COUNTERS.map((key) => [key, row[key]])),
  ...Object.fromEntries(COUNT_MAPS.map((key) => [key, sortedCounts(row[key])]))
});

/**
 * Retain observed query behavior separately from requested ANN configuration.
 * A reported `js` backend and `annActive` alone do not prove a vector query:
 * the former is also the session default, and the latter means eligibility.
 * Stage sources establish returned ANN results, not native compatibility or
 * the quality of those results. Cache hits without stages remain unobserved.
 */
export const createBenchQueryCapabilityCollector = ({ annRequested = null } = {}) => {
  const rows = new Map();
  return {
    observe(backend, payload) {
      if (typeof backend !== 'string' || !backend.trim()) return;
      if (!rows.has(backend)) rows.set(backend, createRow());
      const row = rows.get(backend);
      row.searches += 1;
      const stats = payload?.stats;
      if (stats?.cache?.hit === true) row.cacheHits += 1;
      else if (stats?.cache?.hit !== false) row.cacheStatusUnknown += 1;
      increment(row.reportedAnnBackends,
        REPORTED_BACKENDS.has(stats?.annBackend) ? stats.annBackend : 'unknown');
      let stageCount = 0;
      for (const stage of Array.isArray(stats?.pipeline) ? stats.pipeline : []) {
        if (stage?.stage !== 'ann') continue;
        stageCount += 1;
        row.annStages += 1;
        if (stage.vectorActive === true) row.vectorEligibleStages += 1;
        if (stage.bypassedToSparse === true) row.sparseBypassStages += 1;
        increment(row.modes, MODES.has(stage.mode) ? stage.mode : 'unknown');
        if (Number.isSafeInteger(stage.hits) && stage.hits === 0) {
          row.noResultStages += 1;
          increment(row.annSources, 'none');
        } else if (Number.isSafeInteger(stage.hits) && stage.hits > 0 && SOURCES.has(stage.source)) {
          if (VECTOR_SOURCES.has(stage.source)) row.vectorResultStages += 1;
          else row.minhashResultStages += 1;
          increment(row.annSources, stage.source);
        } else {
          row.unknownResultStages += 1;
          increment(row.annSources, 'unknown');
        }
      }
      if (stageCount) row.searchesWithAnnStages += 1;
      else row.searchesWithoutAnnStages += 1;
    },
    snapshot() {
      return {
        schemaVersion: 1,
        annRequested: typeof annRequested === 'boolean' ? annRequested : null,
        byBackend: Object.fromEntries(Array.from(rows.entries())
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([backend, row]) => [backend, copyRow(row)]))
      };
    }
  };
};

const validCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;

/** Old reports without stage evidence are counted explicitly, never as zero ANN use. */
export const mergeBenchQueryCapabilities = (summaries = []) => {
  const rows = new Map();
  let observedReports = 0;
  let unobservedReports = 0;
  for (const summary of summaries) {
    const evidence = summary?.queryCapabilities;
    if (evidence?.schemaVersion !== 1 || !evidence.byBackend || typeof evidence.byBackend !== 'object') {
      unobservedReports += 1;
      continue;
    }
    observedReports += 1;
    for (const [backend, input] of Object.entries(evidence.byBackend)) {
      if (!input || typeof input !== 'object') continue;
      if (!rows.has(backend)) rows.set(backend, createRow());
      const row = rows.get(backend);
      for (const key of COUNTERS) row[key] += validCount(input[key]);
      for (const key of COUNT_MAPS) {
        const allowed = key === 'annSources' ? new Set([...SOURCES, 'none', 'unknown'])
          : key === 'modes' ? new Set([...MODES, 'unknown']) : new Set([...REPORTED_BACKENDS, 'unknown']);
        for (const [label, count] of Object.entries(input[key] || {})) {
          const normalized = allowed.has(label) ? label : 'unknown';
          row[key][normalized] = (row[key][normalized] || 0) + validCount(count);
        }
      }
    }
  }
  return {
    schemaVersion: 1,
    observedReports,
    unobservedReports,
    byBackend: Object.fromEntries(Array.from(rows.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([backend, row]) => [backend, copyRow(row)]))
  };
};

export const formatBenchQueryCapabilityLines = (evidence) => Object.entries(evidence?.byBackend || {})
  .map(([backend, row]) => (
    `- ${backend} ANN stages: vector results ${row.vectorResultStages}, `
    + `MinHash results ${row.minhashResultStages}, without results ${row.noResultStages}, `
    + `unknown results ${row.unknownResultStages}, sparse bypass ${row.sparseBypassStages}; `
    + `searches without stage evidence ${row.searchesWithoutAnnStages}, cache hits ${row.cacheHits}`
  ));
