import path from 'node:path';
import { observedTokenizationExecution } from '../file-processor/tokenization-evidence.js';
import { observedQuantizationExecution } from '../postings/quantization-evidence.js';
import { readRuntimeReceipt } from '../../../shared/runtime-envelope/read-receipt.js';
import { initBuildState } from '../build-state.js';
import { persistRuntimeAttempt } from '../build-state/runtime.js';
import { createRuntimeAttempt, observeRuntimePath, projectRuntimeScheduler } from '../../../shared/runtime-envelope/receipt.js';
import { redactDiagnosticText } from '../../../shared/diagnostic-text.js';
import { logLine } from '../../../shared/progress-runtime.js';
import { createRuntimeFailure } from './failure.js';
import { buildStageOverrides } from './stage.js';

export const withRuntimeReceiptInitialization = async (create, { finalizeFailure = null } = {}) => {
  let active = null;
  try { return await create((attempt, buildRoot) => { active = { attempt, buildRoot }; }); }
  catch (error) {
    let recordingError = null, recordingFailed = false;
    if (active) {
      try {
        await persistRuntimeAttempt(active.buildRoot, active.attempt, {
          lifecycle: error?.name === 'AbortError' ? 'aborted' : 'failed',
          error: { code: String(error?.code || 'UNKNOWN'), message: redactDiagnosticText(error?.message || error) }
        });
      } catch (cleanupError) {
        recordingError = cleanupError;
        recordingFailed = true;
      }
    } else {
      try { logLine(`[runtime] initialization failed before a durable receipt root: ${redactDiagnosticText(error?.message || error)}`, { kind: 'warning' }); }
      catch (cleanupError) { recordingError = cleanupError; recordingFailed = true; }
    }
    if (typeof finalizeFailure === 'function') throw await finalizeFailure({ error, recordingError, recordingFailed });
    if (recordingFailed) throw createRuntimeFailure(error, { cleanupError: recordingError, cleanupFailed: true });
    throw error;
  }
};

export const initializeRuntimeReceipt = async ({ buildRoot, buildId, root, stage, configHash, toolVersion, repoProvenance, profile, ...input }) => {
  const existing = await readRuntimeReceipt({ buildRoot, requireProducerIdentity: true });
  if ((existing.errorCode && existing.errorCode !== 'ENOENT') || existing.evidence === 'unsupported-runtime-receipt') throw Object.assign(new Error('Cannot initialize runtime receipt over unreadable or unsupported build evidence.'), { code: existing.errorCode || 'ERR_RUNTIME_RECEIPT_CONTRACT' });
  if (existing.errorCode === 'ENOENT') await initBuildState({ buildRoot, buildId, repoRoot: root, modes: null, stage, configHash, toolVersion, repoProvenance, profile });
  else if (existing.buildId !== buildId) throw Object.assign(new Error('Runtime generation differs from persisted build state.'), { code: 'ERR_RUNTIME_RECEIPT_GENERATION' });
  const attempt = await createRuntimeAttempt({ ...input, buildId, stage, toolVersion });
  await persistRuntimeAttempt(buildRoot, attempt, { lifecycle: 'initializing' });
  return attempt;
};

const poolEvidence = (pool) => {
  const stats = pool?.stats?.();
  if (!stats) return null;
  const observations = stats.runtimeObservations || [];
  return {
    backend: stats.backend || 'worker', process: stats.process || null,
    configuredMaxWorkers: stats.configuredMaxWorkers, effectiveMaxWorkers: stats.maxWorkers,
    activeTasks: stats.activeTasks, queuedTasks: stats.queuedTasks, disabled: stats.disabled,
    outstandingRequests: stats.outstandingRequests, waitingForThrottle: stats.waitingForThrottle,
    dispatchedTasks: stats.dispatchedTasks,
    actuallyRunning: stats.actuallyRunning, completedRequests: stats.completedRequests,
    busy: stats.busy || null, requestPressure: stats.requestPressure,
    heapLaunchContract: stats.heapLaunchContract, pressureDownscale: stats.pressureDownscale,
    observedWorkerCount: observations.length, runtimeObservations: observations.slice(0, 8),
    observationsTruncated: observations.length > 8
  };
};

const projectDispatchComparison = runtime => {
  if (runtime.learnedAutoProfile?.enabled !== true) return null;
  const replay = runtime.scheduler?.getDispatchReplay?.();
  if (!replay) return null;
  // Full bounded task/decision traces remain with the scheduler owner. The
  // durable attempt records compact exclusions without crowding out other work.
  const summary = replay.comparison?.summary;
  return { version: replay.version, mode: replay.comparison?.mode,
    taskCount: replay.tasks?.length || 0, decisionCount: replay.decisions?.length || 0,
    droppedTasks: replay.droppedTasks, droppedDecisions: replay.droppedDecisions,
    summary: summary ? Object.fromEntries(Object.entries(summary)
      .filter(([key]) => key !== 'queueWaitMs' && key !== 'commitDelayMs')) : null,
    commitExclusions: replay.commitExclusions || null, fullTraceIncluded: false };
};
const projectSchedulerEvidence = runtime => {
  const scheduler = projectRuntimeScheduler(runtime.scheduler?.stats?.() || null);
  return runtime.learnedAutoProfile?.enabled === true
    ? { ...scheduler, dispatchReplay: projectDispatchComparison(runtime) } : scheduler;
};

export const collectRuntimeResourceEvidence = (runtime) => ({
  workers: {
    observedAt: new Date().toISOString(),
    tokenizationExecution: observedTokenizationExecution(runtime.tokenizationObservations),
    tokenizationObservations: runtime.tokenizationObservations || null,
    quantizationExecution: observedQuantizationExecution(runtime.quantizationObservations),
    quantizationObservations: runtime.quantizationObservations || null,
    embeddingInferenceExecution: 'separate-provider-owner',
    launchDecisions: runtime.workerPools?.runtimeEvidence || {},
    tokenize: poolEvidence(runtime.workerPool), quantize: poolEvidence(runtime.quantizePool)
  },
  scheduler: projectSchedulerEvidence(runtime)
});

const projectFeaturePlan = runtime => {
  const configured = runtime.userConfig?.indexing || {};
  const overrides = buildStageOverrides(configured.twoStage || {}, runtime.stage) || {};
  const definitions = {
    lint: ['lintEnabled', 'lint'], complexity: ['complexityEnabled', 'complexity'],
    astDataflow: ['astDataflowEnabled', 'astDataflow'], controlFlow: ['controlFlowEnabled', 'controlFlow'],
    types: ['typeInferenceEnabled', 'typeInference'], crossFileTypes: ['typeInferenceCrossFileEnabled', 'typeInferenceCrossFile'],
    risk: ['riskAnalysisEnabled', 'riskAnalysis'], crossFileRisk: ['riskAnalysisCrossFileEnabled', 'riskAnalysisCrossFile']
  };
  const plan = Object.fromEntries(Object.entries(definitions).map(([name, [field, key]]) => {
    const requested = typeof configured[key] === 'boolean' ? configured[key] : null;
    const effective = typeof runtime[field] === 'boolean' ? runtime[field] : null;
    return [name, { requested, effective, source: 'effective-runtime-and-stage-policy',
      stageOverride: typeof overrides[key] === 'boolean' ? overrides[key] : null,
      reason: effective === null ? 'runtime-evidence-unavailable' : effective ? 'enabled'
        : overrides[key] === false ? 'stage-policy-disabled' : requested === false ? 'configuration-disabled'
          : 'effective-disabled-reason-unrecorded' }];
  }));
  for (const [name, requested, effective, override] of [
    ['tooling', runtime.userConfig?.tooling?.autoEnableOnDetect, runtime.toolingEnabled, null],
    ['semantic', configured.semantic?.enabled, runtime.semanticPolicy?.enabled, overrides.semantic?.enabled],
    ['embeddings', configured.embeddings?.enabled, runtime.embeddingEnabled, overrides.embeddings?.enabled],
    ['sqlite', runtime.userConfig?.sqlite?.use, runtime.effectiveSqliteEnabled, null]
  ]) plan[name] = { requested: typeof requested === 'boolean' ? requested : null,
    effective: typeof effective === 'boolean' ? effective : null, stageOverride: override ?? null,
    source: 'effective-runtime-and-stage-policy', reason: typeof effective !== 'boolean' ? 'runtime-evidence-unavailable'
      : effective ? 'enabled' : override === false ? 'stage-policy-disabled' : requested === false ? 'configuration-disabled'
        : 'effective-disabled-reason-unrecorded' };
  return plan;
};
const projectActualFileWork = runtime => runtime.featureMetrics?.state ? Object.fromEntries(Object.entries(runtime.featureMetrics.state.modes).map(([mode, data]) => [mode,
  { fileMetricEvents: data.totals.count, observedBytes: data.totals.bytes, observedDurationMs: data.totals.durationMs,
    languageMetricEvents: Object.fromEntries(Object.entries(data.languages || {}).slice(0, 16).map(([language, bucket]) =>
      [language, { count: bucket.count, lines: bucket.lines, bytes: bucket.bytes, durationMs: bucket.durationMs }])),
    languageMetricsTruncated: Object.keys(data.languages || {}).length > 16 } ])) : null;

export const refreshRuntimeReceipt = async (runtime, { lifecycle = 'running', ...patch } = {}) => {
  if (!runtime?.runtimeAttempt || !runtime?.buildRoot) return null;
  const paths = {};
  if (runtime.modelsDir) paths.models = await observeRuntimePath(runtime.modelsDir);
  if (runtime.embeddingCache?.dir) paths.embeddingCache = await observeRuntimePath(runtime.embeddingCache.dir);
  const record = await persistRuntimeAttempt(runtime.buildRoot, runtime.runtimeAttempt, {
    lifecycle, ...patch, paths: { ...paths, ...patch.paths },
    inputs: { executionPlan: {
      stage: runtime.stage || null, configHash: runtime.configHash || null,
      sourceSnapshot: runtime.buildSourceSnapshot || null,
      profile: runtime.profile || null,
      requestedStage: runtime.requestedStage || null, requestedModes: runtime.requestedModes || null,
      featurePlan: projectFeaturePlan(runtime), sourceSelection: runtime.sourceSelection || null,
      features: { lint: runtime.lintEnabled ?? null, complexity: runtime.complexityEnabled ?? null,
        astDataflow: runtime.astDataflowEnabled ?? null, controlFlow: runtime.controlFlowEnabled ?? null,
        types: runtime.typeInferenceEnabled ?? null, crossFileTypes: runtime.typeInferenceCrossFileEnabled ?? null,
        risk: runtime.riskAnalysisEnabled ?? null, tooling: runtime.toolingEnabled ?? null,
        semantic: runtime.semanticPolicy?.enabled ?? null,
        embeddings: runtime.embeddingEnabled ?? null, embeddingService: runtime.embeddingService ?? null },
      producerIdentity: runtime.stageProducer || null,
      semanticEnvironment: runtime.stageReuseEnvironment || null,
      recoveryPlanId: runtime.recoveryPlanId || null,
      reuseDecision: runtime.reuseDecision || null
    }, ...patch.inputs },
    runtime: { ...collectRuntimeResourceEvidence(runtime), completedStageWork: runtime.completedStageWork || null,
      actualFileWork: projectActualFileWork(runtime), ...patch.runtime },
    embeddings: {
      requested: { modelId: runtime.modelId, provider: runtime.embeddingProvider, mode: runtime.embeddingMode, stub: runtime.useStubEmbeddings },
      resolvedIdentity: runtime.embeddingIdentity || null, identityKey: runtime.embeddingIdentityKey || null,
      observation: runtime.getEmbeddingObservation?.() || runtime.runtimeAttempt.embeddings?.observation,
      ...patch.embeddings
    }
  });
  return record;
};

export const logRuntimeReceiptLocation = (buildRoot, attempt, log) => {
  log(`[runtime] attempt ${attempt.attemptId}; receipt: ${path.join(buildRoot, 'build_state.json')} (durable).`);
};
