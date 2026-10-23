import path from 'node:path';
import { observedTokenizationExecution } from '../file-processor/tokenization-evidence.js';
import { readRuntimeReceipt } from '../../../shared/runtime-envelope/read-receipt.js';
import { initBuildState } from '../build-state.js';
import { persistRuntimeAttempt } from '../build-state/runtime.js';
import { createRuntimeAttempt, observeRuntimePath, projectRuntimeScheduler } from '../../../shared/runtime-envelope/receipt.js';
import { redactDiagnosticText } from '../../../shared/diagnostic-text.js';
import { logLine } from '../../../shared/progress-runtime.js';
import { createRuntimeFailure } from './failure.js';

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
    actuallyRunning: stats.actuallyRunning, completedRequests: stats.completedRequests,
    busy: stats.busy || null, requestPressure: stats.requestPressure,
    heapLaunchContract: stats.heapLaunchContract, pressureDownscale: stats.pressureDownscale,
    observedWorkerCount: observations.length, runtimeObservations: observations.slice(0, 8),
    observationsTruncated: observations.length > 8
  };
};

export const collectRuntimeResourceEvidence = (runtime) => ({
  workers: {
    observedAt: new Date().toISOString(),
    tokenizationExecution: observedTokenizationExecution(runtime.tokenizationObservations),
    tokenizationObservations: runtime.tokenizationObservations || null,
    quantizationExecution: (runtime.quantizePool?.stats?.().busy?.completedTasks || 0) > 0
      ? (runtime.quantizePool.getExecutionBackend?.() === 'process' ? 'process-pool' : 'worker-pool') : 'not-yet-observed',
    embeddingInferenceExecution: 'separate-provider-owner',
    launchDecisions: runtime.workerPools?.runtimeEvidence || {},
    tokenize: poolEvidence(runtime.workerPool), quantize: poolEvidence(runtime.quantizePool)
  },
  scheduler: projectRuntimeScheduler(runtime.scheduler?.stats?.() || null)
});

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
      features: { lint: runtime.lintEnabled ?? null, complexity: runtime.complexityEnabled ?? null,
        astDataflow: runtime.astDataflowEnabled ?? null, controlFlow: runtime.controlFlowEnabled ?? null,
        types: runtime.typeInferenceEnabled ?? null, crossFileTypes: runtime.typeInferenceCrossFileEnabled ?? null,
        risk: runtime.riskAnalysisEnabled ?? null, tooling: runtime.toolingEnabled ?? null,
        semantic: runtime.semanticPolicy?.enabled ?? null,
        embeddings: runtime.embeddingEnabled ?? null, embeddingService: runtime.embeddingService ?? null },
      producerIdentity: 'implementation-working-tree-unknown'
    }, ...patch.inputs },
    runtime: { ...collectRuntimeResourceEvidence(runtime), completedStageWork: runtime.completedStageWork || null, ...patch.runtime },
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
