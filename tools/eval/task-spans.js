import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { stableStringify } from '../../src/shared/stable-json.js';
import { TASK_SPAN_TRACE_VERSION } from '../../src/contracts/schemas/task-span-trace.js';
import { evaluateTaskSpanTrace } from '../../src/retrieval/evaluation/task-span-trace.js';
import { compareTaskSpanQuality, TASK_SPAN_QUALITY_METRICS } from '../../src/retrieval/evaluation/task-span-quality.js';

const caps = { tasks: 64, inputBytes: 16 * 1024 * 1024, outputBytes: 16 * 1024 * 1024, work: 4 * 1024 * 1024, maxMs: 2000 };
const digest = text => createHash('sha256').update(text).digest('hex');
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const summarize = receipts => Object.fromEntries(TASK_SPAN_QUALITY_METRICS.map(metric => {
  const repositories = new Map(); let known = 0;
  for (const receipt of receipts) {
    const value = receipt.runComplete ? receipt.metrics?.[metric] : null;
    if (!Number.isFinite(value)) continue;
    if (!repositories.has(receipt.identity.repoId)) repositories.set(receipt.identity.repoId, []);
    repositories.get(receipt.identity.repoId).push(value); known++;
  }
  return [metric, { repositoryMacro: average([...repositories.values()].map(average)),
    knownTasks: known, missingTasks: receipts.length - known, repositories: repositories.size,
    estimand: 'conditional on complete runs with known instrumentation/labels; no inferred failure penalty' }];
}));

/** Saved trace reports are separate from current search and judged-hit metrics.
 * Malformed optional trace evidence cannot select providers or erase live data. */
export const evaluateDatasetTaskSpans = async ({ cases, signal = null, limits = {} } = {}) => {
  if (!Array.isArray(cases)) throw new Error('Task-span evaluation requires dataset cases.');
  const selected = cases.filter(entry => entry?.taskTrace != null || entry?.taskTraceBaseline != null);
  if (!selected.length) return null;
  const started = performance.now(), budget = {};
  for (const [name, maximum] of Object.entries(caps)) {
    const value = limits[name] ?? maximum;
    if (!Number.isSafeInteger(value) || value < (name === 'outputBytes' ? 256 : 1) || value > maximum) throw new Error(`Invalid tightened task-span report ${name} bound.`);
    budget[name] = value;
  }
  if (Object.keys(limits).some(name => !Object.hasOwn(caps, name))) throw new Error('Unknown task-span report bound.');
  const tasks = [], judgmentPolicies = new Set(); let work = 0, inputBytes = 0, retainedBytes = 0;
  const partial = reason => ({ schemaVersion: TASK_SPAN_TRACE_VERSION, kind: 'saved-task-stage-replay', complete: false,
    currentSearchEvidence: false, reason, summary: null, pairedQuality: null, decision: null });
  if (selected.length > budget.tasks) return partial('task-count');
  const stop = () => signal?.aborted ? 'cancelled' : performance.now() - started >= budget.maxMs ? 'deadline' : work >= budget.work ? 'work' : null;
  let comparison = null, invalid = false;
  for (const entry of selected) {
    if (stop()) return partial(stop());
    const queryDigest = digest(String(entry.query || '').trim());
    const settings = { metric: 'deliveredCoverage', seed: 'task-span-quality-v1', cluster: 'repository', resamples: 256, ...(entry.taskSpanComparison || {}) };
    if (Object.keys(settings).some(key => !['metric', 'seed', 'cluster', 'resamples'].includes(key))
      || !TASK_SPAN_QUALITY_METRICS.includes(settings.metric) || !['repository', 'family'].includes(settings.cluster)
      || typeof settings.seed !== 'string' || !settings.seed || settings.seed.length > 256
      || !Number.isSafeInteger(settings.resamples) || settings.resamples < 32 || settings.resamples > 2048) return partial('unsupported-comparison-policy');
    if (comparison && stableStringify(comparison) !== stableStringify(settings)) return partial('mixed-comparison-policy');
    comparison = settings;
    for (const [role, trace] of [['candidate', entry.taskTrace], ['baseline', entry.taskTraceBaseline]]) {
      if (trace == null) continue;
      if (tasks.length >= budget.tasks) return partial('task-count');
      try {
        const receipt = await evaluateTaskSpanTrace(trace, { signal, limits: { work: Math.min(1024 * 1024, budget.work - work),
          maxMs: Math.max(1, Math.min(500, Math.floor(budget.maxMs - (performance.now() - started)))) } });
        if (!receipt.complete) return partial(`task-trace-${receipt.reason}`);
        if (receipt.identity.queryDigest !== queryDigest) throw new Error('Saved task trace query identity differs from the evaluation case.');
        judgmentPolicies.add(receipt.judgmentPolicyKey);
        if (judgmentPolicies.size > 1) return partial('mixed-judgment-policy');
        work += receipt.work.units; inputBytes += Buffer.byteLength(JSON.stringify(receipt.trace));
        retainedBytes += Buffer.byteLength(JSON.stringify(receipt));
        if (inputBytes > budget.inputBytes || retainedBytes > budget.outputBytes) return partial('report-bytes');
        tasks.push({ role, receipt });
      } catch (error) {
        invalid = true;
        tasks.push({ role, receipt: { schemaVersion: TASK_SPAN_TRACE_VERSION, kind: 'task-span-evaluation', complete: false,
          reason: 'input-incomparable', queryDigest, errorCode: error.code || 'ERR_TASK_SPAN_TRACE', metrics: null } });
      }
    }
  }
  if (stop()) return partial(stop());
  const baseline = tasks.filter(row => row.role === 'baseline').map(row => row.receipt), candidate = tasks.filter(row => row.role === 'candidate').map(row => row.receipt);
  let pairedQuality = null;
  if (!invalid && baseline.length) {
    try {
      pairedQuality = await compareTaskSpanQuality({ baseline, candidate, ...comparison, signal,
        limits: { work: Math.min(2 * 1024 * 1024, budget.work - work),
          maxMs: Math.max(1, Math.min(1000, Math.floor(budget.maxMs - (performance.now() - started)))) } });
      if (!pairedQuality.complete) return partial(`paired-quality-${pairedQuality.reason}`);
      work += pairedQuality.work.units;
    } catch { return partial('comparison-incomparable'); }
  }
  const result = { schemaVersion: TASK_SPAN_TRACE_VERSION, kind: 'saved-task-stage-replay', complete: !invalid,
    currentSearchEvidence: false, aggregation: 'separate from current judged retrieval and timing', tasks,
    summary: invalid ? null : { metrics: summarize(candidate), tasks: candidate.length,
      outcomes: Object.fromEntries(['succeeded', 'failed', 'unknown'].map(outcome => [outcome, candidate.filter(row => row.outcome === outcome).length])),
      completeRuns: candidate.filter(row => row.runComplete).length }, pairedQuality, work: { units: work, inputBytes }, decision: null };
  if (stop()) return partial(stop());
  return Buffer.byteLength(JSON.stringify(result)) > budget.outputBytes ? partial('output-bytes') : result;
};
