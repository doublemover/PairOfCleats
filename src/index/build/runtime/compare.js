import { readRuntimeReceipt } from '../../../shared/runtime-envelope/read-receipt.js';
import { stableStringifyForSignature } from '../../../shared/stable-json.js';

const selected = attempt => ({
  stage: attempt.inputs?.executionPlan?.stage ?? attempt.stage,
  configIdentity: attempt.inputs?.executionPlan?.configHash,
  sourceIdentity: attempt.inputs?.executionPlan?.sourceSnapshot?.identity,
  discoveryPolicy: attempt.inputs?.executionPlan?.sourceSnapshot?.policyKey,
  candidateCount: attempt.inputs?.executionPlan?.sourceSnapshot?.candidateCount,
  capturedSourceBytes: attempt.inputs?.executionPlan?.sourceSnapshot?.capturedSourceBytes,
  profile: attempt.inputs?.executionPlan?.profile,
  qualityPolicy: attempt.inputs?.quality,
  learnedPolicy: attempt.inputs?.learnedAutoProfile,
  schedulerAutoTunePolicy: attempt.inputs?.schedulerAutoTuneProfile,
  configSources: attempt.inputs?.configSources,
  implementationIdentity: attempt.inputs?.executionPlan?.producerIdentity?.identity,
  dependencyBootstrapIdentity: attempt.inputs?.executionPlan?.producerIdentity?.bootstrap,
  semanticEnvironment: attempt.inputs?.executionPlan?.semanticEnvironment,
  recoveryPlanId: attempt.inputs?.executionPlan?.recoveryPlanId,
  reuseDecision: attempt.inputs?.executionPlan?.reuseDecision,
  sourceSelection: attempt.inputs?.executionPlan?.sourceSelection,
  featurePolicy: attempt.inputs?.executionPlan?.featurePlan,
  actualFileWork: attempt.runtime?.actualFileWork,
  ...Object.fromEntries(['lint', 'complexity', 'astDataflow', 'controlFlow', 'types', 'crossFileTypes',
    'risk', 'tooling', 'semantic', 'embeddings', 'embeddingService'].map(feature => [
    `feature.${feature}`, attempt.inputs?.executionPlan?.features?.[feature]
  ])),
  requestedConcurrency: attempt.runtime?.plan?.concurrency,
  queuePlan: attempt.runtime?.plan?.queues,
  runtimeSettings: attempt.runtime?.plan?.settings,
  workerAdmission: attempt.runtime?.workers?.launchDecisions,
  tokenizationBackend: attempt.runtime?.workers?.tokenizationExecution,
  tokenizationObservedWorkers: attempt.runtime?.workers?.tokenize?.observedWorkerCount,
  tokenizationConfiguredWorkers: attempt.runtime?.workers?.tokenize?.configuredMaxWorkers,
  tokenizationEffectiveWorkers: attempt.runtime?.workers?.tokenize?.effectiveMaxWorkers,
  tokenizationCompletedRequests: attempt.runtime?.workers?.tokenize?.completedRequests,
  schedulerCounters: attempt.runtime?.scheduler?.counters,
  schedulerPressure: attempt.runtime?.scheduler?.adaptive?.surfaces,
  completedStageWork: attempt.runtime?.completedStageWork,
  embeddingRequest: attempt.embeddings?.requested,
  embeddingIdentity: attempt.embeddings?.identityKey,
  embeddingObservation: attempt.embeddings?.observation?.state,
  toolVersion: attempt.producer?.toolVersion,
  toolRevision: attempt.producer?.toolSourceRevision
});
const identity = attempt => ({ attemptId: attempt.attemptId, buildId: attempt.buildId,
  buildRoot: attempt.buildRoot || null, receiptPath: attempt.receiptPath || null,
  lifecycle: attempt.lifecycle, startedAt: attempt.startedAt, finishedAt: attempt.finishedAt,
  elapsedMs: Number.isFinite(Date.parse(attempt.startedAt)) && Number.isFinite(Date.parse(attempt.finishedAt || attempt.updatedAt))
    ? Math.max(0, Date.parse(attempt.finishedAt || attempt.updatedAt) - Date.parse(attempt.startedAt)) : null,
  partial: attempt.lifecycle !== 'succeeded' });
const missing = value => value === null || value === undefined;

/** Absence on both sides is unknown, never exact sameness. Work is mode-scoped;
 * counters/timings are observations and cannot establish a slowdown's cause.
 */
export const compareBuildAttempts = (before, after) => {
  const previous = selected(before), current = selected(after);
  const changes = [];
  for (const field of Object.keys(previous)) {
    const from = previous[field], to = current[field];
    changes.push({ field, status: missing(from) || missing(to) ? 'unknown'
      : stableStringifyForSignature(from) === stableStringifyForSignature(to) ? 'unchanged' : 'changed',
    before: from ?? null, after: to ?? null });
  }
  return { schemaVersion: 1, before: identity(before), after: identity(after), changes,
    limitations: ['Changed settings are correlations; no slowdown cause is inferred.',
      'Configured workers are distinct from observed worker/process evidence.',
      'Completed mode work is not a whole-run total; stages and modes can overlap.',
      'Observed source/bootstrap identities do not certify loaded-module or unrecorded native/host state.',
      'Unrecorded historical work remains unknown.'] };
};

export const readBuildAttemptComparison = async ({ before, after }) => {
  const read = async selector => {
    if (!selector?.buildRoot || !selector.attemptId) throw Object.assign(new Error('Comparison requires exact build root and attempt id for each side.'),
      { code: 'ERR_BUILD_ATTEMPT_SELECTOR' });
    const report = await readRuntimeReceipt({ buildRoot: selector.buildRoot, attemptId: selector.attemptId, requireProducerIdentity: true });
    if (report.evidence !== 'persisted-runtime-receipt' || report.attempts.length !== 1) throw Object.assign(new Error('Selected historical runtime attempt is missing or unverified.'),
      { code: 'ERR_BUILD_ATTEMPT_MISSING' });
    return { ...report.attempts[0], buildRoot: report.buildRoot, receiptPath: report.receiptPath };
  };
  return compareBuildAttempts(await read(before), await read(after));
};

const valueLabel = value => {
  const encoded = JSON.stringify(value);
  return encoded.length > 256 ? encoded.slice(0, 253) + '...' : encoded;
};
export const formatBuildAttemptComparison = report => [
  `Build attempt ${report.before.attemptId} (${report.before.lifecycle}) -> ${report.after.attemptId} (${report.after.lifecycle}).`,
  ...report.changes.map(change => `${change.field}: ${change.status}${change.status === 'changed'
    ? ` (${valueLabel(change.before)} -> ${valueLabel(change.after)})` : ''}.`),
  ...report.limitations
];
