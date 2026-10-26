import { createHash } from 'node:crypto';
import { RETRIEVAL_COHORT_FIELDS, selectRetrievalCohort } from '../../shared/retrieval-cohort-admission.js';
import { isRetrievalExecution } from '../../../src/contracts/retrieval-execution.js';
import { buildRetrievalHitKey } from '../../../src/retrieval/hit-comparison.js';
import { SEARCH_MICRO_REPORT_VERSION, SEARCH_MICRO_WORK_VERSION } from '../../../src/contracts/search-microbenchmark.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { RETRIEVAL_WORK_VERSION, isRetrievalModelObservation } from '../../../src/contracts/retrieval-work.js';

export { SEARCH_MICRO_REPORT_VERSION, SEARCH_MICRO_WORK_VERSION };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = value => typeof value === 'string' && value.length > 0 ? value : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

export const captureMicroQuerySchedule = (query, schedule = null) => {
  const queries = schedule == null ? [query] : schedule;
  if (!Array.isArray(queries) || !queries.length || queries.length > 10000
    || queries.some(value => typeof value !== 'string' || !value.trim() || value.length > 65536 || !value.isWellFormed())) {
    throw new TypeError('Microbench requires a bounded nonempty frozen query schedule.');
  }
  let bytes = 0;
  for (const value of queries) {
    bytes += Buffer.byteLength(value);
    if (bytes > 4 * 1024 * 1024) throw new TypeError('Microbench query schedule exceeds its 4 MiB allowance.');
  }
  const captured = Object.freeze(queries.slice());
  return Object.freeze({ schemaVersion: 1, kind: 'cyclic-ordered-query-schedule', queries: captured,
    count: captured.length, identity: `mqs1-${hash(captured)}` });
};

/** Read only execution facts supplied by the search owner. The ANN stage exists
 * even when disabled; a stage label alone cannot prove a provider query. */
export const observeSearchMicroSample = (payload, { mode, scoreMode, workMode, requestedBackend, annBackend = null,
  queryIndex = 0, durationMs = null } = {}) => {
  const missing = [];
  let hits = [];
  try { hits = selectRetrievalCohort(payload, mode); }
  catch (error) { if (error.code !== 'ERR_RETRIEVAL_RESPONSE') throw error; missing.push('selected-results-unavailable'); }
  const receipt = payload?.retrieval;
  const selected = text(receipt?.backend?.selected), cacheHit = receipt?.cache?.hit;
  const actualHit = typeof cacheHit === 'boolean' ? cacheHit : null;
  const cacheEnabled = typeof payload?.stats?.cache?.enabled === 'boolean' ? payload.stats.cache.enabled : null;
  const execution = receipt?.fidelity?.byMode?.[mode];
  const qualifiedExecution = isRetrievalExecution(execution, mode) ? JSON.parse(JSON.stringify(execution)) : null;
  const stages = Array.isArray(payload?.stats?.pipeline) ? payload.stats.pipeline.filter(row => row?.mode === mode) : null;
  const candidates = stages?.filter(row => row.stage === 'candidates') || [];
  const ann = stages?.filter(row => row.stage === 'ann' && row.vectorActive === true && row.providerAvailable === true
    && Object.values(ANN_PROVIDER_IDS).includes(row.source)) || [];
  const providerCounts = {};
  for (const row of ann) providerCounts[row.source] = (providerCounts[row.source] || 0) + 1;
  const work = payload?.stats?.work;
  const workKnown = work?.schemaVersion === RETRIEVAL_WORK_VERSION && work.scope === 'whole-search-invocation'
    && ['embeddingRequests', 'embeddingApiCalls', 'embeddingCacheHits'].every(field => count(work[field]) !== null)
    && work.embeddingApiCalls + work.embeddingCacheHits <= work.embeddingRequests;
  if (!workKnown) missing.push('query-embedding-work-unobserved');
  if (scoreMode === 'sparse' && workKnown && work.embeddingRequests !== 0) missing.push('unexpected-query-embedding-in-sparse-workload');
  if (!selected) missing.push('effective-backend-unknown');
  if (!qualifiedExecution || qualifiedExecution.status !== 'complete') missing.push('execution-unavailable-or-partial');
  if (actualHit === null || cacheEnabled === null) missing.push('cache-observation-unknown');
  if (workMode === 'retrieval') {
    if (actualHit !== false || cacheEnabled !== false) missing.push('result-cache-not-bypassed');
    if (!stages) missing.push('stage-observations-missing');
    if (scoreMode !== 'dense' && !candidates.length) missing.push('sparse-stage-not-observed');
    if (scoreMode !== 'sparse' && !ann.length) missing.push('vector-provider-work-not-observed');
    if (scoreMode !== 'sparse' && !(workKnown && work.embeddingRequests > 0)) missing.push('query-embedding-request-not-observed');
    const selectedFts = ['fts', 'sqlite-fts'].includes(requestedBackend) && selected === 'sqlite'
      && candidates.some(row => row.sqliteFtsUsed === true);
    if (requestedBackend && selected !== requestedBackend && !selectedFts) missing.push('requested-backend-not-exercised');
    const expectedAnn = annBackend;
    if (expectedAnn && !Object.hasOwn(providerCounts, expectedAnn)) missing.push('requested-ann-provider-not-observed');
  } else if (workMode === 'result-cache') {
    if (actualHit !== true || cacheEnabled !== true) missing.push('result-cache-hit-not-observed');
    if (candidates.length || ann.length) missing.push('cache-hit-with-retrieval-work');
    if (workKnown && work.embeddingRequests !== 0) missing.push('cache-hit-with-query-embedding-work');
  } else throw new TypeError('Unknown search microbenchmark work mode.');
  const freshness = receipt?.freshness?.byMode?.[RETRIEVAL_COHORT_FIELDS[mode]];
  const source = freshness && ['buildId', 'generationKey', 'activeBuildRoot', 'signature', 'artifactSurfaceVersion', 'profileId']
    .every(field => text(freshness[field])) ? JSON.parse(JSON.stringify(freshness)) : null;
  const policyIdentity = text(receipt?.scorePolicyIdentity);
  if (!source) missing.push('index-generation-unknown');
  if (!policyIdentity) missing.push('effective-score-policy-unknown');
  const identities = hits.map((hit, rank) => buildRetrievalHitKey(hit, rank, { mode }));
  if (identities.some(value => value === null)) missing.push('result-identity-unknown');
  const model = scoreMode === 'sparse' ? { status: 'not-applicable', reason: 'sparse-score-workload' }
    : workMode === 'result-cache' && actualHit === true ? { status: 'not-applicable', reason: 'result-cache-replay' }
      : isRetrievalModelObservation(work?.models?.[mode]) ? { ...work.models[mode] }
        : { status: 'unqualified', modelId: text(payload?.stats?.models?.[RETRIEVAL_COHORT_FIELDS[mode]]),
          provider: text(payload?.stats?.embeddings?.provider), dimensions: null, stub: null,
          reason: 'runtime-model-artifact-and-input-format-not-observed' };
  return { schemaVersion: SEARCH_MICRO_WORK_VERSION, queryIndex, durationMs, status: missing.length ? 'unqualified' : 'observed', missing,
    cache: { enabled: cacheEnabled, hit: actualHit, strategy: text(receipt?.cache?.strategy),
      memoryHotPath: typeof receipt?.cache?.memoryHotPath === 'boolean' ? receipt.cache.memoryHotPath : null },
    backend: { requested: requestedBackend || null, effective: selected, requestedAnn: annBackend, vectorProviders: providerCounts,
      sqliteFtsUsed: stages ? candidates.some(row => row.sqliteFtsUsed === true) : null },
    execution: qualifiedExecution, source, policyIdentity, effectivePlanIdentity: text(receipt?.effectivePlanIdentity), model,
    operations: { candidateStages: stages ? candidates.length : null, vectorResultStages: stages ? ann.length : null,
      queryEmbeddingComputations: null, queryEmbeddingScope: 'warm-reuse-allowed-computations-unobserved',
      queryEmbeddingRequests: workKnown ? work.embeddingRequests : null,
      queryEmbeddingApiCalls: workKnown ? work.embeddingApiCalls : null,
      queryEmbeddingCacheHits: workKnown ? work.embeddingCacheHits : null,
      candidates: candidates.map(row => ({ built: row.counts?.lexicalCandidatesBuilt === true,
        bmHits: count(row.counts?.bmHits), candidates: count(row.counts?.candidates) })) },
    outputIdentity: identities.some(value => value === null) ? null : `mro1-${hash(identities)}` };
};

export const summarizeSearchMicroWork = samples => {
  const rows = Array.isArray(samples) ? samples : [];
  return { schemaVersion: SEARCH_MICRO_WORK_VERSION, samples: rows.length,
    qualified: rows.filter(row => row.status === 'observed').length,
    unqualified: rows.filter(row => row.status !== 'observed').length,
    cacheHits: rows.filter(row => row.cache.hit === true).length,
    cacheMisses: rows.filter(row => row.cache.hit === false).length,
    cacheUnknown: rows.filter(row => row.cache.hit === null).length,
    candidateStages: rows.every(row => row.operations.candidateStages !== null)
      ? rows.reduce((sum, row) => sum + row.operations.candidateStages, 0) : null,
    vectorResultStages: rows.every(row => row.operations.vectorResultStages !== null)
      ? rows.reduce((sum, row) => sum + row.operations.vectorResultStages, 0) : null,
    queryEmbeddingComputations: null,
    ...Object.fromEntries(['queryEmbeddingRequests', 'queryEmbeddingApiCalls', 'queryEmbeddingCacheHits'].map(field => [field,
      rows.every(row => row.operations[field] !== null) ? rows.reduce((sum, row) => sum + row.operations[field], 0) : null])),
    missing: [...new Set(rows.flatMap(row => row.missing))] };
};

/** Keep bounded sample receipts while conserving observations for every call.
 * Query/source/output controls are compared inside each declared phase, so a
 * cache warmup miss cannot be mistaken for a measured cache-hit sample. */
export const createSearchMicroCollector = options => {
  const phases = new Map();
  return {
    observe(payload, details) {
      const sample = observeSearchMicroSample(payload, { ...options, ...details });
      const phase = details.phase;
      if (!phases.has(phase)) phases.set(phase, { samples: [], controls: new Map(), summary: null, drift: 0 });
      const bucket = phases.get(phase), one = summarizeSearchMicroWork([sample]);
      if (!bucket.summary) bucket.summary = one;
      else {
        for (const field of ['samples', 'qualified', 'unqualified', 'cacheHits', 'cacheMisses', 'cacheUnknown']) bucket.summary[field] += one[field];
        for (const field of ['candidateStages', 'vectorResultStages', 'queryEmbeddingRequests', 'queryEmbeddingApiCalls', 'queryEmbeddingCacheHits']) {
          bucket.summary[field] = bucket.summary[field] === null || one[field] === null ? null : bucket.summary[field] + one[field];
        }
        bucket.summary.missing = [...new Set([...bucket.summary.missing, ...one.missing])];
      }
      const control = { queryIndex: sample.queryIndex, source: sample.source, policyIdentity: sample.policyIdentity,
        backend: sample.backend, cache: sample.cache, execution: sample.execution, model: sample.model, outputIdentity: sample.outputIdentity };
      const key = sample.queryIndex;
      const prior = bucket.controls.get(key);
      if (prior && JSON.stringify(prior) !== JSON.stringify(control)) bucket.drift++;
      else if (!prior) bucket.controls.set(key, control);
      if (bucket.samples.length < 64) bucket.samples.push(sample);
      return sample;
    },
    snapshot() {
      return { schemaVersion: SEARCH_MICRO_WORK_VERSION,
        timingScope: 'search-call-excludes-receipt-projection',
        phases: Object.fromEntries([...phases].map(([phase, value]) => [phase, { ...value.summary,
          retainedSamples: value.samples, omittedSampleReceipts: value.summary.samples - value.samples.length,
          controls: [...value.controls.values()], controlDrift: value.drift }])) };
    }
  };
};
