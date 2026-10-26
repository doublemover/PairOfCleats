import { BENCH_QUERY_OUTCOME_VERSION } from '../../../src/contracts/benchmark-remediation.js';
import { selectRetrievalCohort } from '../../shared/retrieval-cohort-admission.js';
import { captureEvaluationJudgments } from '../../eval/judgments.js';
import { collectExpectedJudgments } from '../../eval/metrics.js';
import { matchExpected } from '../../eval/match.js';

export const QUERY_OUTCOME_COUNTS = Object.freeze(['searches', 'nonempty', 'empty', 'unavailable',
  'unknownExpected', 'knownPositive', 'positiveTargetFound', 'positiveTargetMissing',
  'expectedNegative', 'negativeSatisfied', 'negativeViolated']);
const measured = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const count = value => Number.isSafeInteger(value) && value >= 0;

/** Aggregate only actual selected-mode searches. Plain throughput queries have
 * unknown expectations; an explicit empty judgment array is a negative control.
 * Existing evaluation matching owns positive target identity, not nonemptiness. */
export const createBenchQueryOutcomeCollector = ({ workloadKey = null, concurrency = null } = {}) => {
  const rows = new Map();
  return {
    observe({ backend, mode, payload, expected, stratum = 'unclassified' }) {
      const key = JSON.stringify([backend, mode, stratum]);
      if (!rows.has(key)) rows.set(key, { backend, mode, stratum,
        ...Object.fromEntries(QUERY_OUTCOME_COUNTS.map(field => [field, 0])),
        serviceLatency: { kind: 'retrieval-service-elapsed', observed: 0, meanMs: null },
        cache: { hit: 0, miss: 0, unknown: 0 },
        backendScope: 'benchmark-invocation-backend', effectiveBackends: Object.create(null), unknownBackendCount: 0 });
      const row = rows.get(key);
      const judgments = expected === undefined ? null : captureEvaluationJudgments(expected);
      row.searches++;
      let hits;
      try { hits = selectRetrievalCohort(payload, mode); }
      catch (error) {
        if (error?.code !== 'ERR_RETRIEVAL_RESPONSE') throw error;
        row.unavailable++;
        return;
      }
      row[hits.length ? 'nonempty' : 'empty']++;
      const selectedBackend = payload?.retrieval?.backend?.selected;
      if (typeof selectedBackend === 'string' && selectedBackend.length > 0 && selectedBackend.length <= 64) {
        row.effectiveBackends[selectedBackend] = (row.effectiveBackends[selectedBackend] || 0) + 1;
      } else row.unknownBackendCount++;
      if (judgments === null) row.unknownExpected++;
      else if (!judgments.length) {
        row.expectedNegative++;
        row[hits.length ? 'negativeViolated' : 'negativeSatisfied']++;
      } else {
        const outcome = collectExpectedJudgments(hits, judgments,
          (hit, judgment) => matchExpected(hit, judgment, 'exact'), { mode });
        row.knownPositive++;
        row[outcome.ranks.length ? 'positiveTargetFound' : 'positiveTargetMissing']++;
      }
      const elapsedMs = payload?.stats?.elapsedMs;
      if (measured(elapsedMs)) {
        const sample = row.serviceLatency;
        sample.observed++;
        sample.meanMs = sample.meanMs === null ? elapsedMs : sample.meanMs + (elapsedMs - sample.meanMs) / sample.observed;
      }
      const cacheHit = payload?.retrieval?.cache?.hit ?? payload?.stats?.cache?.hit;
      row.cache[cacheHit === true ? 'hit' : cacheHit === false ? 'miss' : 'unknown']++;
    },
    snapshot() {
      return { schemaVersion: BENCH_QUERY_OUTCOME_VERSION, workloadKey,
        concurrency: count(concurrency) && concurrency > 0 ? concurrency : null,
        cohorts: JSON.parse(JSON.stringify([...rows.values()])) };
    }
  };
};

/** These are observed cohort counts, not calibrated relevance or causal proof. */
export const admitQueryOutcomeEvidence = value => {
  if (!value || value.schemaVersion !== BENCH_QUERY_OUTCOME_VERSION || typeof value.workloadKey !== 'string'
    || !value.workloadKey || !Array.isArray(value.cohorts) || value.cohorts.length > 256) return null;
  const seen = new Set(), cohorts = [];
  for (const row of value.cohorts) {
    if (!row || !['memory', 'sqlite', 'sqlite-fts', 'fts', 'lmdb', 'tantivy'].includes(row.backend)
      || !['code', 'prose', 'extracted-prose', 'records'].includes(row.mode)
      || typeof row.stratum !== 'string' || !row.stratum || row.stratum.length > 128
      || !QUERY_OUTCOME_COUNTS.every(field => count(row[field])) || row.searches <= 0
      || row.nonempty + row.empty + row.unavailable !== row.searches
      || row.unknownExpected + row.knownPositive + row.expectedNegative !== row.nonempty + row.empty
      || row.positiveTargetFound + row.positiveTargetMissing !== row.knownPositive
      || row.negativeSatisfied + row.negativeViolated !== row.expectedNegative
      || row.negativeSatisfied > row.empty || row.positiveTargetFound + row.negativeViolated > row.nonempty
      || row.backendScope !== 'benchmark-invocation-backend' || !row.effectiveBackends
      || typeof row.effectiveBackends !== 'object' || Array.isArray(row.effectiveBackends)
      || Object.keys(row.effectiveBackends).length > 64 || !count(row.unknownBackendCount)
      || !Object.entries(row.effectiveBackends).every(([backend, searches]) => backend.length > 0 && backend.length <= 64 && count(searches))
      || Object.values(row.effectiveBackends).reduce((sum, searches) => sum + searches, row.unknownBackendCount) !== row.nonempty + row.empty
      || !row.cache || !['hit', 'miss', 'unknown'].every(field => count(row.cache[field]))
      || row.cache.hit + row.cache.miss + row.cache.unknown !== row.nonempty + row.empty
      || row.serviceLatency?.kind !== 'retrieval-service-elapsed'
      || !count(row.serviceLatency.observed) || row.serviceLatency.observed > row.nonempty + row.empty
      || (row.serviceLatency.observed === 0 ? row.serviceLatency.meanMs !== null : !measured(row.serviceLatency.meanMs))) return null;
    const key = JSON.stringify([row.backend, row.mode, row.stratum]);
    if (seen.has(key)) return null;
    seen.add(key);
    cohorts.push(JSON.parse(JSON.stringify(row)));
  }
  return { schemaVersion: BENCH_QUERY_OUTCOME_VERSION, workloadKey: value.workloadKey,
    concurrency: count(value.concurrency) && value.concurrency > 0 ? value.concurrency : null, cohorts };
};
