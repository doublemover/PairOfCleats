import { canonicalSemanticJson } from '../identity.js';
const same = (a, b) => canonicalSemanticJson(a) === canonicalSemanticJson(b);
export const runtimeCaptureCompatibility = (left, right) => {
  const reasons = [];
  for (const field of ['repositoryNamespace', 'generation', 'sources', 'runtime', 'scope', 'clock', 'instrumentation', 'collector', 'parser', 'actualFlags']) {
    if (!same(left[field], right[field])) reasons.push('different_' + field);
  }
  for (const field of ['fingerprint', 'inputShapeHash', 'phase']) {
    if (!same(left.workload[field], right.workload[field])) reasons.push('different_workload_' + field);
  }
  if (left.workload.phase === 'unknown' || left.workload.phase === 'mixed') reasons.push('indeterminate_workload_phase');
  if (left.completion !== 'complete' || right.completion !== 'complete') reasons.push('incomplete_capture');
  return reasons;
};
