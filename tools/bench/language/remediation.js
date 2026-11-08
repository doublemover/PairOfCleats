import { BENCH_REMEDIATION_VERSION } from '../../../src/contracts/benchmark-remediation.js';
import { admitQueryOutcomeEvidence } from './query-outcomes.js';

const LOW_HIT_THRESHOLD = 0.82;
const measured = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const rate = value => measured(value) !== null && value <= 1 ? value : null;
const rounded = (value, digits = 4) => measured(value) === null ? null : Number(value.toFixed(digits));
const safeCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const legacyRates = summary => {
  const rows = new Map();
  for (const source of [summary?.hitRate, summary?.hitRates, summary?.hitRateByBackend]) {
    for (const [backend, value] of Object.entries(source || {})) if (!rows.has(backend) && rate(value) !== null) rows.set(backend, value);
  }
  for (const [backend, field] of [['memory', 'hitRateMemory'], ['sqlite', 'hitRateSqlite'], ['sqlite-fts', 'hitRateSqliteFts']]) {
    if (!rows.has(backend) && rate(summary?.[field]) !== null) rows.set(backend, summary[field]);
  }
  return rows;
};

/** Retained for historical display only. No remediation decision uses the best
 * backend's availability as relevance or as another backend's evidence. */
export const getBestHitRate = summary => {
  const values = [...legacyRates(summary).values()];
  return values.length ? Math.max(...values) : null;
};

const diagnose = row => row.positiveTargetMissing > 0 ? 'judged-positive-target-missing'
  : row.negativeViolated > 0 ? 'expected-negative-returned-hits'
    : row.unavailable > 0 ? 'retrieval-unavailable'
      : row.unknownExpected > 0 || row.knownPositive === null ? 'expectations-unknown'
        : row.expectedNegative > 0 && row.knownPositive === 0 ? 'expected-empty-success' : 'judged-targets-observed';

export const computeLowHitSeverity = ({ summary, lowHitThreshold = LOW_HIT_THRESHOLD } = {}) => {
  const admitted = admitQueryOutcomeEvidence(summary?.queryOutcomeEvidence);
  const cohorts = admitted ? admitted.cohorts.map(row => ({ ...row,
    nonemptyRate: row.nonempty + row.empty > 0 ? row.nonempty / (row.nonempty + row.empty) : null,
    positiveTargetFoundRate: row.knownPositive > 0 ? row.positiveTargetFound / row.knownPositive : null,
    diagnosis: diagnose(row), qualification: 'observed-selected-mode-cohort' }))
    : [...legacyRates(summary)].map(([backend, nonemptyRate]) => ({ backend,
      mode: 'unknown', stratum: 'unknown', nonemptyRate, searches: null,
      knownPositive: null, expectedNegative: null, unknownExpected: null,
      positiveTargetFoundRate: null, diagnosis: 'expectations-unknown', qualification: 'legacy-availability-only' }));
  const affected = cohorts.filter(row => row.nonemptyRate !== null && row.nonemptyRate < lowHitThreshold
    || row.positiveTargetMissing > 0 || row.negativeViolated > 0 || row.unavailable > 0);
  const priorities = affected.map(row => row.diagnosis === 'expected-empty-success' ? 0
    : row.knownPositive > 0 ? row.positiveTargetMissing / row.knownPositive
      : row.nonemptyRate === null ? 0 : Math.max(0, lowHitThreshold - row.nonemptyRate) / lowHitThreshold);
  const densities = [...Object.values(summary?.resultCountAvg || {}), summary?.resultCountMemory,
    summary?.resultCountSqlite, summary?.resultCountSqliteFts].map(measured).filter(value => value !== null);
  const gaps = affected.map(row => row.nonemptyRate === null ? 0 : Math.max(0, lowHitThreshold - row.nonemptyRate));
  return { lowHitThreshold, bestHitRate: getBestHitRate(summary),
    hitGap: gaps.length ? Math.max(...gaps) : null,
    avgResultCount: densities.length ? densities.reduce((sum, value) => sum + value, 0) / densities.length : null,
    queryWallMsPerSearch: measured(summary?.queryWallMsPerSearch),
    queryWallMsPerQuery: measured(summary?.queryWallMsPerQuery),
    severityScore: priorities.length ? Math.max(...priorities) : null,
    scoreMeaning: 'heuristic-inspection-priority', calibratedProbability: false,
    evidenceStatus: admitted ? 'observed' : summary?.queryOutcomeEvidence == null ? 'legacy-unjudged' : 'invalid-outcome-evidence',
    workloadKey: admitted?.workloadKey || null, cohorts, affected };
};

const taxonomyCounts = summary => {
  const labels = new Map();
  const source = summary?.missTaxonomy;
  for (const [field, destination] of [['byBackend', 'total'], ['lowHitByBackend', 'zeroHit']]) {
    for (const [backend, counts] of Object.entries(source?.[field] || {})) {
      for (const [label, original] of Object.entries(counts || {})) {
        const count = safeCount(original);
        if (count === null) continue;
        if (!labels.has(label)) labels.set(label, new Map());
        const rows = labels.get(label);
        if (!rows.has(backend)) rows.set(backend, { backend, total: null, zeroHit: null });
        rows.get(backend)[destination] = count;
      }
    }
  }
  return [...labels].map(([label, values]) => {
    const byBackend = [...values.values()];
    const total = byBackend.every(row => row.total !== null) ? byBackend.reduce((sum, row) => sum + row.total, 0) : null;
    const zeroHit = byBackend.every(row => row.zeroHit !== null) ? byBackend.reduce((sum, row) => sum + row.zeroHit, 0) : null;
    return { label, count: total, total, zeroHit, scope: 'backend-search-occurrences', byBackend,
      consistent: byBackend.every(row => row.total === null || row.zeroHit === null || row.zeroHit <= row.total) };
  }).sort((left, right) => (right.total ?? right.zeroHit ?? 0) - (left.total ?? left.zeroHit ?? 0)
    || left.label.localeCompare(right.label)).slice(0, 6);
};

const buildSuggestions = severity => {
  const onlyExpectedEmpty = severity.affected.every(row => row.diagnosis === 'expected-empty-success');
  const hasJudgedMiss = severity.affected.some(row => row.positiveTargetMissing > 0);
  const definitions = onlyExpectedEmpty ? [
    ['workload.preserve-negative-controls', 'workload-design', 'Preserve expected-empty controls',
      'Expected-empty success provides no recall-failure evidence.', 0]
  ] : [
    ['workload.validate-expectations', 'workload-design', 'Inspect query expectations and workload coverage',
      'Nonempty frequency measures availability. Validate intent, expected positives and negatives before changing workload weights.', 0.7],
    ['retrieval.inspect-source-coverage', 'diagnostics', hasJudgedMiss ? 'Inspect missing judged targets' : 'Inspect source and index coverage',
      hasJudgedMiss ? 'Judged targets are missing; this does not identify a tokenizer, chunking or ranking cause.'
        : 'Expected relevance is unknown; inspect source availability before proposing a retrieval change.', 0.6],
    ['query.inspect-parsing', 'diagnostics', 'Inspect selected-mode query interpretation',
      'Query parsing is an unverified hypothesis. Miss-taxonomy labels alone do not establish a cause.', 0.5]
  ];
  if (severity.affected.some(row => row.serviceLatency?.observed > 0 && row.serviceLatency.meanMs > 120)) {
    definitions.push(['performance.inspect-service-latency', 'diagnostics', 'Inspect observed retrieval service time',
      'Actual service samples warrant inspection; no rerank-stage attribution or tuning direction is established.', 0.4]);
  }
  return definitions.map(([suggestionId, component, title, reason, priority], index) => ({
    suggestionId, component, title, reason, score: rounded(priority, 3), rank: index + 1,
    scoreMeaning: 'heuristic-inspection-priority', calibratedProbability: false,
    kind: onlyExpectedEmpty ? 'control-preservation' : 'diagnostic-hypothesis',
    applicability: onlyExpectedEmpty ? 'no-retrieval-remediation-indicated' : 'inspection-only',
    qualification: 'not-a-qualified-production-change',
    evidence: severity.affected,
    missingEvidence: ['matched causal evidence', 'independent frozen holdout', 'qualified post-change measurement'],
    contradictedClaims: onlyExpectedEmpty ? ['low nonempty frequency implies recall failure']
      : ['batch wall cost identifies query latency or rerank cost'],
    abstentionReason: 'No demonstrated causal remedy or comparable post-change quality evidence.',
    targetFiles: [],
    loop: { accepted: false, baseline: { workloadKey: severity.workloadKey,
      nonemptyResultFrequency: severity.cohorts.map(row => ({ backend: row.backend, mode: row.mode,
        stratum: row.stratum, value: row.nonemptyRate })),
      bestHitRate: severity.bestHitRate, queryWallMsPerSearch: severity.queryWallMsPerSearch },
    postChange: null, delta: null }
  }));
};

export const buildRemediationSummary = tasks => {
  const validTasks = (Array.isArray(tasks) ? tasks : []).filter(entry => entry?.summary);
  const rows = [], aggregated = new Map();
  for (const entry of validTasks) {
    const severity = computeLowHitSeverity({ summary: entry.summary });
    if (!severity.affected.length) continue;
    const rankedSuggestions = buildSuggestions(severity);
    for (const suggestion of rankedSuggestions) {
      if (!aggregated.has(suggestion.suggestionId)) aggregated.set(suggestion.suggestionId, {
        suggestionId: suggestion.suggestionId, title: suggestion.title, component: suggestion.component,
        kind: suggestion.kind, qualification: suggestion.qualification, uses: 0, scoreTotal: 0, repos: new Set() });
      const bucket = aggregated.get(suggestion.suggestionId);
      bucket.uses++; bucket.scoreTotal += suggestion.score; bucket.repos.add(`${entry.language}/${entry.repo}`);
    }
    rows.push({ language: entry.language, tier: entry.tier, repo: entry.repo, repoPath: entry.repoPath || null,
      outFile: entry.outFile || null, bestHitRate: severity.bestHitRate,
      metric: 'nonempty-result-frequency', metricScope: 'backend-and-selected-mode', qualityClaim: 'unavailable',
      lowHitThreshold: severity.lowHitThreshold, hitGap: rounded(severity.hitGap),
      avgResultCount: rounded(severity.avgResultCount, 3),
      queryWallMsPerSearch: rounded(severity.queryWallMsPerSearch, 2), queryWallMsPerQuery: rounded(severity.queryWallMsPerQuery, 2),
      wallCostMeaning: 'batch-wall-per-completion-including-pool-lifecycle',
      severityScore: rounded(severity.severityScore, 3), scoreMeaning: severity.scoreMeaning,
      evidenceStatus: severity.evidenceStatus, workloadKey: severity.workloadKey,
      cohorts: severity.cohorts, causeAttribution: 'unverified', missTaxonomyTop: taxonomyCounts(entry.summary), rankedSuggestions });
  }
  rows.sort((left, right) => (right.severityScore ?? -1) - (left.severityScore ?? -1));
  const topSuggestions = [...aggregated.values()].map(({ scoreTotal, repos, ...entry }) => ({ ...entry,
    avgScore: rounded(scoreTotal / entry.uses, 3), scoreMeaning: 'heuristic-inspection-priority', repos: [...repos].sort() }))
    .sort((left, right) => right.avgScore - left.avgScore || right.uses - left.uses || left.suggestionId.localeCompare(right.suggestionId));
  const tracked = rows.reduce((sum, row) => sum + row.rankedSuggestions.length, 0);
  return { schemaVersion: BENCH_REMEDIATION_VERSION, lowHitThreshold: LOW_HIT_THRESHOLD,
    metric: 'nonempty-result-frequency', reposConsidered: validTasks.length,
    lowHitCount: rows.length, lowHitRepos: rows, topSuggestions,
    qualityDelta: { status: 'unavailable', reason: 'independent-matched-holdout-required',
      workloadChanges: 'workload-design-change-not-product-quality-gain' },
    loop: { trackedSuggestions: tracked, acceptedSuggestions: 0, pendingSuggestions: tracked, postChangeDeltaReady: false } };
};
