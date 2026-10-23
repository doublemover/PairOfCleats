import { createHash } from 'node:crypto';
import { stableStringify } from '../../shared/stable-json.js';
import { TASK_SPAN_TRACE_VERSION } from '../../contracts/schemas/task-span-trace.js';
import { QUALITY_COMPARISON_VERSION } from '../../contracts/schemas/quality-comparison.js';
import { TASK_SPAN_TRACE_POLICY } from './task-span-trace.js';
import { comparePairedQuality } from './paired-quality.js';
import { captureTaskSpanQualityReceipts } from './task-span-quality-inputs.js';

export const TASK_SPAN_QUALITY_METRICS = Object.freeze(['retrievalOverlap', 'exploredOverlap', 'deliveredCoverage',
  'claimedUtilization', 'atomicSupportRate', 'taskSuccess']);
const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const fail = message => Object.assign(new Error(message), { code: 'ERR_TASK_SPAN_TRACE' });

/** Failed/censored runs retain their outcomes. Unknown instrumentation never
 * receives a fabricated quality measurement or silently disappears. */
export const compareTaskSpanQuality = async ({ baseline, candidate, metric = 'deliveredCoverage',
  seed = 'task-span-quality-v1', cluster = 'repository', resamples = 256,
  signal = null, limits = {}, resumeKey = null } = {}) => {
  if (!TASK_SPAN_QUALITY_METRICS.includes(metric)) throw fail('Explicit bounded task-span evaluation populations and metric required.');
  baseline = captureTaskSpanQualityReceipts(baseline, metric);
  candidate = captureTaskSpanQualityReceipts(candidate, metric);
  const judgmentPolicies = new Set();
  const observations = receipts => receipts.map(receipt => {
    const identity = receipt.identity;
    judgmentPolicies.add(receipt.judgmentPolicyKey);
    const value = receipt.measurement;
    const status = receipt.runStatus === 'complete' ? Number.isFinite(value) ? 'complete' : 'missing'
      : receipt.runStatus === 'timeout' || receipt.runStatus === 'cancelled' ? receipt.runStatus
        : receipt.runStatus === 'failed' ? 'failed' : 'missing';
    return { taskKey: identity.taskKey,
      inputKey: digest([identity.inputKey, identity.queryDigest, receipt.sourceDigest, receipt.goldDigest]),
      repoId: identity.repoId, familyId: identity.familyId, slice: 'task-stage', status, value: status === 'complete' ? value : null };
  });
  const left = observations(baseline), right = observations(candidate);
  if (judgmentPolicies.size > 1) throw fail('Task-span judgment/measurement rubric changed across comparison runs.');
  return comparePairedQuality({ schemaVersion: QUALITY_COMPARISON_VERSION, kind: 'paired-quality-comparison',
    metric: { name: metric, definitionKey: digest([TASK_SPAN_TRACE_VERSION, TASK_SPAN_TRACE_POLICY, [...judgmentPolicies][0] || null,
      metric, 'complete-known-unit-quality.v1']), unit: 'quality-unit-interval' },
    baselineKey: digest(baseline.map(row => row.traceKey).sort()), candidateKey: digest(candidate.map(row => row.traceKey).sort()),
    cluster, seed, resamples, slices: [], baseline: left, candidate: right }, { signal, limits, resumeKey });
};
