import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import { stableStringify } from '../../shared/stable-json.js';
import { QUALITY_COMPARISON_VERSION } from '../../contracts/schemas/quality-comparison.js';
import { validatePairedQualityRequest } from '../../contracts/validators/quality-comparison.js';

export const PAIRED_QUALITY_POLICY = 'repository-macro.complete-paired-quality.v1;paired-cluster-percentile.v1';
const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const fail = message => Object.assign(new Error(message), { code: 'ERR_PAIRED_QUALITY_INPUT' });
const caps = Object.freeze({ inputBytes: 8 * 1024 * 1024, outputBytes: 1024 * 1024, work: 2 * 1024 * 1024, maxMs: 1000 });
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const quantile = (values, p) => {
  const at = (values.length - 1) * p, low = Math.floor(at), high = Math.ceil(at);
  return values[low] + (values[high] - values[low]) * (at - low);
};
const randomFor = seed => {
  let state = Number.parseInt(digest(seed).slice(0, 8), 16) || 1;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
};
const snapshot = input => {
  const active = new Set(); let bytes = 0, nodes = 0;
  const copy = (value, depth) => {
    if (++nodes > 200000 || depth > 8) throw fail('Comparison requires bounded plain JSON data.');
    if (value === null || typeof value === 'boolean') { bytes += 5; return value; }
    if (typeof value === 'number' && Number.isFinite(value)) { bytes += 32; return value; }
    if (typeof value === 'string') {
      bytes += Buffer.byteLength(JSON.stringify(value));
      if (bytes > caps.inputBytes) throw fail('Paired quality input exceeds 8 MiB.');
      return value;
    }
    if (!value || typeof value !== 'object' || active.has(value)
      || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) throw fail('Comparison requires bounded acyclic plain JSON data.');
    active.add(value);
    const keys = Object.keys(value), result = Array.isArray(value) ? [] : Object.create(null);
    if (keys.length > 8192 || (Array.isArray(value) && (keys.length !== value.length
      || keys.some((key, index) => key !== String(index))))) throw fail('Comparison arrays must be bounded dense JSON data.');
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw fail('Comparison cannot execute input accessors.');
      bytes += Buffer.byteLength(JSON.stringify(key)) + 2;
      if (bytes > caps.inputBytes) throw fail('Paired quality input exceeds 8 MiB.');
      Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    active.delete(value); return result;
  };
  return copy(input, 0);
};
const admit = input => {
  const request = snapshot(input), validation = validatePairedQualityRequest(request);
  if (!validation.ok) throw fail(`Invalid paired quality request: ${validation.errors.slice(0, 4).join('; ')}`);
  const families = new Map();
  if (request.slices.includes('all')) throw fail('The all slice is reserved.');
  for (const side of ['baseline', 'candidate']) {
    const seen = new Set();
    for (const row of request[side]) {
      if (seen.has(row.taskKey)) throw fail('Repeated task identity cannot be counted as another observation.');
      seen.add(row.taskKey);
      if ((row.status === 'complete') !== Number.isFinite(row.value)) throw fail('Complete quality requires a measurement; failed/missing outcomes cannot fabricate zero.');
      if (families.has(row.repoId) && families.get(row.repoId) !== row.familyId) throw fail('One repository cannot change family across paired tasks.');
      families.set(row.repoId, row.familyId);
    }
    request[side].sort((a, b) => a.taskKey.localeCompare(b.taskKey));
  }
  request.slices.sort();
  return request;
};

/** Pair original input/task identities before any resampling. Failures remain
 * visible outcomes, not invented zero-quality observations. The quality effect
 * is explicitly conditional on complete pairs; completion is reported separately.
 */
export const comparePairedQuality = async (input, { signal = null, limits = {}, resumeKey = null } = {}) => {
  const started = performance.now(), budget = {};
  for (const [key, maximum] of Object.entries(caps)) {
    const value = limits[key] ?? maximum;
    if (!Number.isSafeInteger(value) || value < (key === 'outputBytes' ? 256 : 1) || value > maximum) throw fail(`Invalid tightened ${key} limit.`);
    budget[key] = value;
  }
  if (Object.keys(limits).some(key => !Object.hasOwn(caps, key))) throw fail('Unknown paired quality bound.');
  let work = 0, checkpoint = null;
  const stop = () => signal?.aborted ? 'cancelled' : performance.now() - started >= budget.maxMs ? 'deadline' : work > budget.work ? 'work' : null;
  const partial = reason => {
    const result = { schemaVersion: QUALITY_COMPARISON_VERSION, kind: 'paired-quality-result', complete: false,
      reason, policy: PAIRED_QUALITY_POLICY, checkpoint: { key: checkpoint, resume: 'restart-from-zero' },
      estimates: null, slices: null, decision: null };
    return Buffer.byteLength(JSON.stringify(result)) <= budget.outputBytes ? result : {
      schemaVersion: QUALITY_COMPARISON_VERSION, kind: 'paired-quality-result', complete: false,
      reason, estimates: null, slices: null, decision: null };
  };
  if (stop()) return partial(stop());
  const request = admit(input);
  if (Buffer.byteLength(JSON.stringify(request)) > budget.inputBytes) return partial('input-bytes');
  checkpoint = digest({ policy: PAIRED_QUALITY_POLICY, request });
  if (resumeKey !== null && resumeKey !== checkpoint) throw fail('Comparison checkpoint metric, pairing, source input or resampling policy changed.');
  const left = new Map(request.baseline.map(row => [row.taskKey, row])), right = new Map(request.candidate.map(row => [row.taskKey, row]));
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort(), pairs = [];
  for (const taskKey of keys) {
    work++;
    if (stop()) return partial(stop());
    const a = left.get(taskKey), b = right.get(taskKey), row = a || b;
    if (a && b && (a.inputKey !== b.inputKey || a.repoId !== b.repoId || a.familyId !== b.familyId || a.slice !== b.slice)) throw fail('Paired task has mismatched corpus/source/query/filter or cluster identity.');
    const status = { baseline: a?.status || 'missing', candidate: b?.status || 'missing' };
    pairs.push({ taskKey, inputKey: row.inputKey, repoId: row.repoId, familyId: row.familyId, slice: row.slice, status,
      difference: a?.status === 'complete' && b?.status === 'complete' ? b.value - a.value : null });
  }
  const reports = [];
  for (const slice of ['all', ...request.slices]) {
    if (stop()) return partial(stop());
    const selected = slice === 'all' ? pairs : pairs.filter(row => row.slice === slice), complete = selected.filter(row => row.difference !== null);
    work += pairs.length + selected.length;
    if (stop()) return partial(stop());
    const byRepo = new Map(), byCluster = new Map();
    for (const row of complete) {
      if (!byRepo.has(row.repoId)) byRepo.set(row.repoId, { familyId: row.familyId, differences: [] });
      byRepo.get(row.repoId).differences.push(row.difference);
    }
    for (const [repoId, row] of [...byRepo].sort(([a], [b]) => a.localeCompare(b))) {
      const key = request.cluster === 'repository' ? repoId : row.familyId;
      if (!byCluster.has(key)) byCluster.set(key, { repositorySum: 0, repositories: 0, taskSum: 0, tasks: 0 });
      const cluster = byCluster.get(key);
      cluster.repositorySum += mean(row.differences); cluster.repositories++;
      cluster.taskSum += row.differences.reduce((sum, value) => sum + value, 0); cluster.tasks += row.differences.length;
    }
    const clusters = [...byCluster].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value), samples = { macro: [], micro: [] };
    const macro = mean([...byRepo.values()].map(row => mean(row.differences))), micro = mean(complete.map(row => row.difference));
    if (clusters.length > 1) {
      if (work + request.resamples * clusters.length > budget.work) return partial('work');
      const random = randomFor([QUALITY_COMPARISON_VERSION, request.seed, request.metric, slice]);
      for (let sample = 0; sample < request.resamples; sample++) {
        if (sample % 128 === 0) { await yieldImmediate(); if (stop()) return partial(stop()); }
        let repositorySum = 0, repositories = 0, taskSum = 0, tasks = 0;
        for (let index = 0; index < clusters.length; index++) {
          const cluster = clusters[Math.floor(random() * clusters.length)]; work++;
          repositorySum += cluster.repositorySum; repositories += cluster.repositories;
          taskSum += cluster.taskSum; tasks += cluster.tasks;
        }
        samples.macro.push(repositorySum / repositories); samples.micro.push(taskSum / tasks);
      }
      samples.macro.sort((a, b) => a - b); samples.micro.sort((a, b) => a - b);
    }
    const outcomes = Object.fromEntries(['baseline', 'candidate'].map(side => [side, Object.fromEntries(['complete', 'missing', 'failed', 'timeout', 'cancelled']
      .map(status => [status, selected.filter(row => row.status[side] === status).length]))]));
    const missing = selected.filter(row => row.difference === null);
    reports.push({ id: slice, tasks: selected.length, completePairs: complete.length, repositories: byRepo.size, clusters: clusters.length,
      pairingComplete: !missing.length, outcomes,
      completionRates: { baseline: selected.length ? outcomes.baseline.complete / selected.length : null,
        candidate: selected.length ? outcomes.candidate.complete / selected.length : null,
        paired: selected.length ? complete.length / selected.length : null },
      incompletePairs: missing.slice(0, 128).map(({ taskKey, status }) => ({ taskKey, status })),
      incompletePairsOmitted: Math.max(0, missing.length - 128),
      inference: clusters.length < 2 ? 'insufficient-independent-clusters' : missing.length ? 'conditional-on-complete-pairs' : 'paired-cluster-resampling',
      repositoryMacro: { meanDifference: macro, interval95: samples.macro.length ? [quantile(samples.macro, 0.025), quantile(samples.macro, 0.975)] : null },
      taskMicro: { meanDifference: micro, interval95: samples.micro.length ? [quantile(samples.micro, 0.025), quantile(samples.micro, 0.975)] : null } });
  }
  if (stop()) return partial(stop());
  const result = { schemaVersion: QUALITY_COMPARISON_VERSION, kind: 'paired-quality-result', complete: true,
    policy: PAIRED_QUALITY_POLICY, checkpoint: { key: checkpoint, resume: 'restart-from-zero' },
    metric: request.metric, baselineKey: request.baselineKey, candidateKey: request.candidateKey,
    pairing: 'taskKey+inputKey+repository+family+declared-slice', cluster: request.cluster, seed: request.seed, resamples: request.resamples,
    interval: 'paired-cluster percentile2.5/97.5;preserve dependent tasks and repository weights',
    estimand: 'repository-macro mean paired quality difference conditional on complete pairs;task-micro separately labeled',
    estimates: reports[0], slices: reports.slice(1), work: { units: work }, decision: null,
    completion: 'failure/timeout/missing outcomes remain separate;no implicit scoring penalty', latencyInference: 'none' };
  return Buffer.byteLength(JSON.stringify(result)) > budget.outputBytes ? partial('output-bytes') : result;
};
