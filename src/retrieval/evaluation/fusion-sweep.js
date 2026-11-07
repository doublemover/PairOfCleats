import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import { stableStringify } from '../../shared/stable-json.js';
import { FUSION_REPLAY_VERSION, admitFusionReplayRecord, replayFusionRecord } from './fusion-replay.js';
import { fusionDepthAvailability, FUSION_DEPTH_POLICY } from './fusion-channel-coverage.js';
import { comparePairedQuality, PAIRED_QUALITY_POLICY } from './paired-quality.js';
import { QUALITY_COMPARISON_VERSION } from '../../contracts/schemas/quality-comparison.js';

export const FUSION_SWEEP_METRIC_POLICY = `graded-ndcg.recall-positive.mrr.v1;paired-query-normal-95.v1;${PAIRED_QUALITY_POLICY};${FUSION_DEPTH_POLICY}`;
const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const fail = message => Object.assign(new Error(message), { code: 'ERR_FUSION_SWEEP' });
const caps = { records: 256, configurations: 64, inputBytes: 16 * 1024 * 1024,
  outputBytes: 4 * 1024 * 1024, work: 1000000, maxMs: 2000 };
const fields = new Set(['mode', 'sparseDepth', 'denseDepth', 'rrfK', 'sparseWeight', 'denseWeight', 'boosts', 'diversity']);
const metricNames = ['ndcg', 'recall', 'mrr', 'candidateRecall'];
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/** The query identity, not the rank of its input row, determines its split. */
export const fusionReplaySplit = (queryKey, seed) => {
  const bucket = Number.parseInt(digest([FUSION_REPLAY_VERSION, seed, queryKey]).slice(0, 8), 16) % 100;
  return bucket < 60 ? 'train' : bucket < 80 ? 'dev' : 'test';
};
const quality = (record, receipt) => {
  const grades = new Map(record.judgments.map(row => [row.key, row.relevance]));
  const relevant = record.judgments.filter(row => row.relevance > 0).length;
  const k = record.rankOptions.searchTopN;
  const ideal = record.judgments.map(row => row.relevance).sort((a, b) => b - a).slice(0, k)
    .reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
  const dcg = receipt.results.reduce((sum, row, index) => sum + (2 ** (grades.get(row.key) || 0) - 1) / Math.log2(index + 2), 0);
  const first = receipt.results.findIndex(row => (grades.get(row.key) || 0) > 0);
  return { ndcg: ideal ? dcg / ideal : null,
    recall: relevant ? receipt.results.filter(row => (grades.get(row.key) || 0) > 0).length / relevant : null,
    mrr: relevant ? first < 0 ? 0 : 1 / (first + 1) : null,
    candidateRecall: receipt.candidateRecall.value };
};
const summarize = rows => Object.fromEntries(metricNames.map(name => [name,
  average(rows.map(row => row.metrics[name]).filter(Number.isFinite))]));
const paired = (baseline, candidate) => Object.fromEntries(metricNames.map(name => {
  const differences = candidate.flatMap((row, index) => Number.isFinite(row.metrics[name]) && Number.isFinite(baseline[index]?.metrics[name])
    ? [row.metrics[name] - baseline[index].metrics[name]] : []);
  const mean = average(differences), n = differences.length;
  const variance = n > 1 ? differences.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1) : null;
  const halfWidth = variance === null ? null : 1.96 * Math.sqrt(variance / n);
  return [name, { queries: n, meanDifference: mean,
    interval95: halfWidth === null ? null : [mean - halfWidth, mean + halfWidth],
    method: 'paired-query normal approximation; descriptive, not a promotion decision' }];
}));

/** Development-only saved-score work. No native provider, retrieval, model or
 * live index is opened. Every parameter is frozen before test quality is read.
 * A checkpoint authorizes a full deterministic restart, not partial aggregates.
 */
export const sweepFusionReplays = async ({ records, grid, seed = 'fusion-sweep-v1', signal = null,
  limits = {}, resumeKey = null, expected = null } = {}) => {
  const started = performance.now(), budget = {};
  for (const [name, maximum] of Object.entries(caps)) {
    const value = limits[name] ?? maximum;
    if (!Number.isSafeInteger(value) || value < (name === 'outputBytes' ? 256 : 1) || value > maximum) throw fail(`Invalid tightened ${name} bound.`);
    budget[name] = value;
  }
  if (Object.keys(limits).some(name => !Object.hasOwn(caps, name))) throw fail('Unknown sweep bound.');
  if (typeof seed !== 'string' || !seed || seed.length > 256 || !Array.isArray(records) || !records.length
    || records.length > caps.records || !Array.isArray(grid) || !grid.length || grid.length > caps.configurations) throw fail('Sweep requires bounded explicit records, grid and split seed.');
  if (grid.some(row => !row || typeof row !== 'object' || Array.isArray(row)
    || Object.keys(row).some(name => !fields.has(name)))) throw fail('Grid contains unsupported policy fields.');
  let work = 0, inputBytes = 0, checkpointKey = null, completedQueries = 0;
  const stop = () => signal?.aborted ? 'cancelled' : performance.now() - started >= budget.maxMs ? 'deadline' : null;
  const partial = reason => ({ schemaVersion: FUSION_REPLAY_VERSION, kind: 'fusion-sweep', complete: false, reason,
    checkpoint: { key: checkpointKey, resume: 'restart-from-zero', cacheableComplete: false },
    work: { candidateUnits: work, completedQueries }, selected: null, metrics: null });
  const emit = report => Buffer.byteLength(JSON.stringify(report)) <= budget.outputBytes ? report : {
    schemaVersion: FUSION_REPLAY_VERSION, kind: 'fusion-sweep', complete: false, reason: 'output-bytes', selected: null, metrics: null };
  if (records.length > budget.records || grid.length > budget.configurations) return emit(partial('admission-limit'));
  const capturedGrid = grid.map(row => Object.fromEntries(Object.keys(row).map(name => {
    const descriptor = Object.getOwnPropertyDescriptor(row, name);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !['string', 'number', 'boolean'].includes(typeof descriptor.value)) {
      throw fail('Grid settings require original scalar policy values.');
    }
    return [name, descriptor.value];
  })));
  const seenQueries = new Set(), seenKeys = new Set(), admitted = [], policies = new Set(), identities = new Set();
  const baseline = [];
  for (const input of records) {
    if (stop()) return emit(partial(stop()));
    // The replay owner admits an immutable bounded plain-data copy and checks
    // the exact source/runtime policy. Its replay first proves current parity.
    const record = admitFusionReplayRecord(input);
    for (const candidate of capturedGrid) { if (stop()) return emit(partial(stop())); fusionDepthAvailability(record, candidate); }
    const receipt = replayFusionRecord(record);
    if (stableStringify(receipt.results) !== stableStringify(record.baseline)) throw fail('Current fusion baseline parity failed.');
    inputBytes += Buffer.byteLength(JSON.stringify(record));
    if (inputBytes > budget.inputBytes) return emit(partial('input-bytes'));
    if (seenQueries.has(record.provenance.queryKey) || seenKeys.has(record.recordKey)) throw fail('A query cannot occupy more than one split or repeated observation.');
    seenQueries.add(record.provenance.queryKey); seenKeys.add(record.recordKey);
    policies.add(record.policy);
    identities.add(digest([record.provenance.corpus, record.provenance.embeddingKey, record.rankOptions.searchTopN]));
    if (expected && (record.provenance.embeddingKey !== expected.embeddingKey
      || record.provenance.corpus.generation !== expected.generation || record.provenance.corpus.sourceDigest !== expected.sourceDigest)) throw fail('Sweep model or corpus generation does not match its requested identity.');
    work += record.candidates.length;
    if (work > budget.work) return emit(partial('work'));
    admitted.push(record); baseline.push(receipt);
    await yieldImmediate();
  }
  if (policies.size !== 1 || identities.size !== 1) throw fail('One sweep requires one source/model/generation/output policy.');
  const configurations = [...new Map(capturedGrid.map(row => [digest(row), row])).entries()]
    .sort(([a], [b]) => a.localeCompare(b));
  const sorted = admitted.map((record, index) => ({ record, baseline: baseline[index] }))
    .sort((a, b) => a.record.provenance.queryKey.localeCompare(b.record.provenance.queryKey));
  const splits = Object.fromEntries(['train', 'dev', 'test'].map(name => [name,
    sorted.filter(row => fusionReplaySplit(row.record.provenance.queryKey, seed) === name)]));
  const splitIds = Object.fromEntries(Object.entries(splits).map(([name, rows]) => [name, rows.map(row => row.record.provenance.queryKey)]));
  checkpointKey = digest({ version: FUSION_REPLAY_VERSION, metric: FUSION_SWEEP_METRIC_POLICY,
    records: sorted.map(row => row.record.recordKey), configurations, seed, splitIds });
  if (resumeKey !== null && resumeKey !== checkpointKey) throw fail('Fusion replay checkpoint policy, grid or input identity changed.');
  if (!splits.train.length || !splits.dev.length || !splits.test.length) return emit(partial('empty-split'));
  const evaluate = async (rows, candidate) => {
    const output = [];
    for (const { record, baseline: current } of rows) {
      if (stop()) return { reason: stop() };
      const cost = Math.min(record.channels.sparse.length, candidate?.sparseDepth ?? record.channels.sparse.length)
        + Math.min(record.channels.dense.length, candidate?.denseDepth ?? record.channels.dense.length);
      if (work + cost > budget.work) return { reason: 'work' };
      work += cost;
      const receipt = candidate ? replayFusionRecord(record, candidate) : current;
      output.push({ queryKey: record.provenance.queryKey, policyKey: receipt.policyKey,
        metrics: quality(record, receipt), candidateRecall: receipt.candidateRecall, missingness: receipt.missingness,
        depthAvailability: receipt.depthAvailability });
      completedQueries++;
      await yieldImmediate();
    }
    return { rows: output };
  };
  const observations = [], baselines = {};
  for (const split of ['train', 'dev']) {
    const current = await evaluate(splits[split], null);
    if (current.reason) return emit(partial(current.reason));
    baselines[split] = current.rows;
  }
  for (const [key, candidate] of configurations) {
    const train = await evaluate(splits.train, candidate), dev = train.reason ? null : await evaluate(splits.dev, candidate);
    if (train.reason || dev.reason) return emit(partial(train.reason || dev.reason));
    observations.push({ key, candidate, train: { metrics: summarize(train.rows), paired: paired(baselines.train, train.rows) },
      dev: { metrics: summarize(dev.rows), paired: paired(baselines.dev, dev.rows) }, trainRows: train.rows, devRows: dev.rows });
  }
  const judged = observations.filter(row => Number.isFinite(row.dev.metrics.ndcg));
  if (!judged.length) return emit(partial('no-dev-judgments'));
  judged.sort((a, b) => b.dev.metrics.ndcg - a.dev.metrics.ndcg || a.key.localeCompare(b.key));
  const winner = judged[0];
  // This immutable selection receipt is constructed before accessing any test
  // judgment. Changing held-out grades cannot change its key or parameters.
  const frozen = Object.freeze({ policy: winner.candidate, policyKey: winner.key, depthPolicy: FUSION_DEPTH_POLICY,
    selection: 'dev graded NDCG; stable policy-key tie', seed, splits: splitIds,
    key: digest({ version: FUSION_REPLAY_VERSION, metric: FUSION_SWEEP_METRIC_POLICY, seed, splitIds,
      trainDev: [...splits.train, ...splits.dev].map(row => row.record.recordKey), policyKey: winner.key }) });
  const testBaseline = await evaluate(splits.test, null);
  const testSelected = testBaseline.reason ? null : await evaluate(splits.test, winner.candidate);
  if (testBaseline.reason || testSelected.reason || stop()) return emit(partial(testBaseline.reason || testSelected.reason || stop()));
  const clusteredPairedTest = {};
  for (const name of metricNames) {
    if (stop() || work >= budget.work) return emit(partial(stop() || 'work'));
    const observationsFor = rows => rows.map((row, index) => {
      const record = splits.test[index].record, value = row.metrics[name];
      return { taskKey: row.queryKey, inputKey: digest([record.provenance.corpus.sourceDigest, row.queryKey, name, record.rankOptions.searchTopN]),
        repoId: record.provenance.corpus.id, familyId: record.provenance.corpus.id, slice: 'held-out',
        status: Number.isFinite(value) ? 'complete' : 'missing', value: Number.isFinite(value) ? value : null };
    });
    const comparison = await comparePairedQuality({ schemaVersion: QUALITY_COMPARISON_VERSION, kind: 'paired-quality-comparison',
      metric: { name, definitionKey: digest([FUSION_SWEEP_METRIC_POLICY, name]), unit: 'quality-unit-interval' },
      baselineKey: digest(['current-fusion', sorted[0].record.policy]), candidateKey: winner.key,
      cluster: 'repository', seed, resamples: 256, slices: [],
      baseline: observationsFor(testBaseline.rows), candidate: observationsFor(testSelected.rows) },
    { signal, limits: { work: Math.min(2 * 1024 * 1024, budget.work - work),
      maxMs: Math.max(1, Math.min(1000, Math.floor(budget.maxMs - (performance.now() - started)))) } });
    if (!comparison.complete) return emit(partial(`paired-quality-${comparison.reason}`));
    work += comparison.work.units; clusteredPairedTest[name] = comparison;
  }
  if (stop()) return emit(partial(stop()));
  return emit({ schemaVersion: FUSION_REPLAY_VERSION, kind: 'fusion-sweep', complete: true,
    checkpoint: { key: checkpointKey, resume: 'restart-from-zero', cacheableComplete: true },
    metricPolicy: FUSION_SWEEP_METRIC_POLICY, selected: frozen,
    splits: splitIds, configurations: observations.map(({ trainRows, devRows, ...row }) => row),
    metrics: { baseline: { train: summarize(baselines.train), dev: summarize(baselines.dev), test: summarize(testBaseline.rows) },
      selectedTest: summarize(testSelected.rows), pairedTest: paired(testBaseline.rows, testSelected.rows), clusteredPairedTest },
    queries: { train: winner.trainRows, dev: winner.devRows, test: testSelected.rows },
    work: { candidateUnits: work, completedQueries, inputBytes, replayMs: performance.now() - started },
    costScope: 'saved-score-replay; retrieval/model/index-IO-not-measured', promotion: 'none; held-out campaign qualification required' });
};
