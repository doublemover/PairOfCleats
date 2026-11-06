import { inspectEvidenceTaskOutcome } from './tasks/score.js';

/** Deterministic identification bounds for the exact finite source-task sample.
 * These are not confidence intervals or independent-unit claims. Every declared
 * task survives missing actions/labels; accepted=0 has undefined selective risk.
 */
export const summarizeFinitePolicyCohort = ({ indices, candidateRuns, baselineRuns, assignments, compilationIds, readCeiling }) => {
  const rows = indices.map(index => {
    const candidate = candidateRuns.get(index), baseline = baselineRuns.get(index);
    const outcome = candidate?.outcome ? inspectEvidenceTaskOutcome(candidate.outcome) : null;
    const prior = baseline?.outcome ? inspectEvidenceTaskOutcome(baseline.outcome) : null;
    const artifact = candidate?.artifact;
    const action = artifact?.submission.status === 'completed' ? artifact.submission.abstain ? 'abstain' : 'answer' : 'unknown';
    const result = outcome?.executionStatus === 'completed' ? outcome.taskResult : 'unknown';
    return { action, result, prior: prior?.executionStatus === 'completed' ? prior.taskResult : 'unknown',
      groupId: assignments.get(compilationIds.get(index))?.groupId ?? null,
      readBytes: Number.isSafeInteger(artifact?.work.sourceBytesRead) ? artifact.work.sourceBytesRead : null };
  });
  const n = rows.length, count = predicate => rows.filter(predicate).length;
  const answered = count(row => row.action === 'answer'), unknownActions = count(row => row.action === 'unknown');
  const pass = count(row => row.result === 'pass'), fail = count(row => row.result === 'fail'), unknownLabels = n - pass - fail;
  const answeredFailures = count(row => row.action === 'answer' && row.result === 'fail');
  const answeredUnknownLabels = count(row => row.action === 'answer' && row.result === 'unknown');
  const measurements = rows.filter(row => row.readBytes !== null), missingMeasurements = n - measurements.length;
  const observedMaximum = Math.max(0, ...measurements.map(row => row.readBytes));
  return { declaredTasks: n, leakageComponents: new Set(rows.map(row => row.groupId).filter(Boolean)).size,
    answered, abstained: count(row => row.action === 'abstain'), unknownActions, pass, fail, unknownLabels, answeredFailures, answeredUnknownLabels,
    answeredCorrect: count(row => row.action === 'answer' && row.result === 'pass'),
    coverageBounds: [answered / n, (answered + unknownActions) / n], utilityBounds: [pass / n, (pass + unknownLabels) / n],
    riskBounds: answered ? [answeredFailures / answered, (answeredFailures + answeredUnknownLabels) / answered] : null,
    unconditionalFailureBounds: [fail / n, (fail + unknownLabels) / n],
    newlyIncorrect: count(row => row.prior === 'pass' && row.result === 'fail'),
    unresolvedHarmPairs: count(row => row.prior === 'unknown' || row.result === 'unknown'),
    sourceReads: { measuredTasks: measurements.length, missingMeasurements,
      observedSum: measurements.reduce((sum, row) => sum + row.readBytes, 0), observedMaximum,
      possibleMaximum: missingMeasurements ? Math.max(observedMaximum, readCeiling) : observedMaximum } };
};

export const finitePolicyMetricGates = (metrics, thresholds) => {
  const upper = (bounds, maximum) => !bounds ? 'insufficient-evidence' : bounds[0] > maximum ? 'rejected' : bounds[1] > maximum ? 'insufficient-evidence' : 'pass';
  const lower = (bounds, minimum) => bounds[1] < minimum ? 'rejected' : bounds[0] < minimum ? 'insufficient-evidence' : 'pass';
  return [{ id: 'leakage-components', state: metrics.leakageComponents < thresholds.minLeakageComponents ? 'insufficient-evidence' : 'pass' },
    { id: 'selective-risk', state: upper(metrics.riskBounds, thresholds.maxRisk) },
    { id: 'coverage', state: lower(metrics.coverageBounds, thresholds.minCoverage) },
    { id: 'utility', state: lower(metrics.utilityBounds, thresholds.minUtility) },
    { id: 'source-read-budget', state: metrics.sourceReads.observedMaximum > thresholds.maxReadBytesPerTask ? 'rejected'
      : metrics.sourceReads.possibleMaximum > thresholds.maxReadBytesPerTask ? 'insufficient-evidence' : 'pass' },
    { id: 'known-labels-and-actions', state: metrics.unknownLabels || metrics.unknownActions ? 'insufficient-evidence' : 'pass' }];
};
