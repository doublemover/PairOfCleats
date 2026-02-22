import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyAdaptiveDictConfig, getIndexDir, getMetricsDir } from '../../../shared/dict-utils.js';
import { buildRecordsIndexForRepo } from '../../../integrations/triage/index-records.js';
import { createCacheReporter, createLruCache, estimateFileTextBytes } from '../../../shared/cache.js';
import { atomicWriteJson } from '../../../shared/io/atomic-write.js';
import { getEnvConfig } from '../../../shared/env.js';
import { log, showProgress } from '../../../shared/progress.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { coerceUnitFraction } from '../../../shared/number-coerce.js';
import { createCrashLogger } from '../crash-log.js';
import { recordOrderingSeedInputs, updateBuildState } from '../build-state.js';
import { estimateContextWindow } from '../context-window.js';
import { createPerfProfile, loadPerfProfile } from '../perf-profile.js';
import { createStageCheckpointRecorder } from '../stage-checkpoints.js';
import { createIndexState } from '../state.js';
import { enqueueEmbeddingJob } from './embedding-queue.js';
import { getTreeSitterStats, resetTreeSitterStats } from '../../../lang/tree-sitter.js';
import { INDEX_PROFILE_VECTOR_ONLY } from '../../../contracts/index-profile.js';
import { SCHEDULER_QUEUE_NAMES } from '../runtime/scheduler.js';
import { writeSchedulerAutoTuneProfile } from '../runtime/scheduler-autotune-profile.js';
import { formatHealthFailure, runIndexingHealthChecks } from '../../../shared/ops-health.js';
import { runWithOperationalFailurePolicy } from '../../../shared/ops-failure-injection.js';
import {
  RESOURCE_GROWTH_THRESHOLDS,
  RESOURCE_WARNING_CODES,
  evaluateResourceGrowth,
  formatResourceGrowthWarning,
  readIndexArtifactBytes
} from '../../../shared/ops-resource-visibility.js';
import {
  SIGNATURE_VERSION,
  buildIncrementalSignature,
  buildIncrementalSignatureSummary,
  buildTokenizationKey
} from './signatures.js';
import { runDiscovery } from './steps/discover.js';
import {
  loadIncrementalPlan,
  prepareIncrementalBundleVfsRows,
  pruneIncrementalState,
  updateIncrementalBundles
} from './steps/incremental.js';
import { buildIndexPostings } from './steps/postings.js';
import { processFiles } from './steps/process-files.js';
import { postScanImports, preScanImports, runCrossFileInference } from './steps/relations.js';
import { writeIndexArtifactsForMode } from './steps/write.js';

/**
 * Resolve effective analysis feature flags with policy overrides.
 * Runtime toggles provide defaults; explicit policy booleans take precedence.
 *
 * @param {object} runtime
 * @returns {{gitBlame:boolean,typeInference:boolean,typeInferenceCrossFile:boolean,riskAnalysis:boolean,riskAnalysisCrossFile:boolean}}
 */
const resolveAnalysisFlags = (runtime) => {
  const policy = runtime.analysisPolicy || {};
  return {
    gitBlame: typeof policy?.git?.blame === 'boolean' ? policy.git.blame : runtime.gitBlameEnabled,
    typeInference: typeof policy?.typeInference?.local?.enabled === 'boolean'
      ? policy.typeInference.local.enabled
      : runtime.typeInferenceEnabled,
    typeInferenceCrossFile: typeof policy?.typeInference?.crossFile?.enabled === 'boolean'
      ? policy.typeInference.crossFile.enabled
      : runtime.typeInferenceCrossFileEnabled,
    riskAnalysis: typeof policy?.risk?.enabled === 'boolean' ? policy.risk.enabled : runtime.riskAnalysisEnabled,
    riskAnalysisCrossFile: typeof policy?.risk?.crossFile === 'boolean'
      ? policy.risk.crossFile
      : runtime.riskAnalysisCrossFileEnabled
  };
};

/**
 * Vector-only builds can proceed when embeddings are either immediately
 * available (`embeddingEnabled`) or deferred to service queueing
 * (`embeddingService`).
 *
 * @param {object} runtime
 * @returns {boolean}
 */
const hasVectorEmbeddingBuildCapability = (runtime) => (
  runtime?.embeddingEnabled === true || runtime?.embeddingService === true
);

export const resolveVectorOnlyShortcutPolicy = (runtime) => {
  const profileId = runtime?.profile?.id || runtime?.indexingConfig?.profile || 'default';
  const vectorOnly = profileId === INDEX_PROFILE_VECTOR_ONLY;
  const config = runtime?.indexingConfig?.vectorOnly && typeof runtime.indexingConfig.vectorOnly === 'object'
    ? runtime.indexingConfig.vectorOnly
    : {};
  return {
    profileId,
    enabled: vectorOnly,
    disableImportGraph: vectorOnly ? config.disableImportGraph !== false : false,
    disableCrossFileInference: vectorOnly ? config.disableCrossFileInference !== false : false
  };
};

const MODALITY_SPARSITY_SCHEMA_VERSION = '1.0.0';
const MODALITY_SPARSITY_PROFILE_FILE = 'modality-sparsity-profile.json';
const MODALITY_SPARSITY_MAX_ENTRIES = 512;

const createEmptyModalitySparsityProfile = () => ({
  schemaVersion: MODALITY_SPARSITY_SCHEMA_VERSION,
  updatedAt: null,
  entries: {}
});

export const resolveModalitySparsityProfilePath = (runtime) => {
  const repoCacheRoot = typeof runtime?.repoCacheRoot === 'string' ? runtime.repoCacheRoot : '';
  if (!repoCacheRoot) return null;
  return path.join(repoCacheRoot, MODALITY_SPARSITY_PROFILE_FILE);
};

export const buildModalitySparsityEntryKey = ({ mode, cacheSignature }) => (
  `${String(mode || 'unknown')}:${String(cacheSignature || 'nosig')}`
);

const normalizeModalitySparsityProfile = (profile) => {
  if (!profile || typeof profile !== 'object') return createEmptyModalitySparsityProfile();
  const entries = profile.entries && typeof profile.entries === 'object' ? profile.entries : {};
  return {
    schemaVersion: typeof profile.schemaVersion === 'string'
      ? profile.schemaVersion
      : MODALITY_SPARSITY_SCHEMA_VERSION,
    updatedAt: typeof profile.updatedAt === 'string' ? profile.updatedAt : null,
    entries
  };
};

export const readModalitySparsityProfile = async (runtime) => {
  const profilePath = resolveModalitySparsityProfilePath(runtime);
  if (!profilePath) {
    return { profilePath: null, profile: createEmptyModalitySparsityProfile() };
  }
  try {
    const raw = await fs.readFile(profilePath, 'utf8');
    const parsed = normalizeModalitySparsityProfile(JSON.parse(raw));
    return { profilePath, profile: parsed };
  } catch {
    return { profilePath, profile: createEmptyModalitySparsityProfile() };
  }
};

const trimModalitySparsityEntries = (entries = {}) => {
  const list = Object.entries(entries);
  if (list.length <= MODALITY_SPARSITY_MAX_ENTRIES) return entries;
  list.sort((a, b) => {
    const aTs = Date.parse(a?.[1]?.updatedAt || 0) || 0;
    const bTs = Date.parse(b?.[1]?.updatedAt || 0) || 0;
    return bTs - aTs;
  });
  const keep = list.slice(0, MODALITY_SPARSITY_MAX_ENTRIES);
  return Object.fromEntries(keep);
};

export const writeModalitySparsityEntry = async ({
  runtime,
  profilePath,
  profile,
  mode,
  cacheSignature,
  fileCount,
  chunkCount,
  elided,
  source
}) => {
  if (!profilePath) return;
  const now = new Date().toISOString();
  const key = buildModalitySparsityEntryKey({ mode, cacheSignature });
  const next = normalizeModalitySparsityProfile(profile);
  next.updatedAt = now;
  next.entries = {
    ...next.entries,
    [key]: {
      schemaVersion: MODALITY_SPARSITY_SCHEMA_VERSION,
      key,
      mode,
      cacheSignature: cacheSignature || null,
      fileCount: Number.isFinite(Number(fileCount)) ? Number(fileCount) : 0,
      chunkCount: Number.isFinite(Number(chunkCount)) ? Number(chunkCount) : 0,
      elided: elided === true,
      source: source || null,
      repoRoot: runtime?.root || null,
      updatedAt: now
    }
  };
  next.entries = trimModalitySparsityEntries(next.entries);
  await fs.mkdir(path.dirname(profilePath), { recursive: true });
  await atomicWriteJson(profilePath, next, { spaces: 2 });
};

export const shouldElideModalityProcessingStage = ({ fileCount, chunkCount }) => (
  Number(fileCount) === 0 && Number(chunkCount) === 0
);

/**
 * Build the effective feature toggle set for a mode from runtime settings,
 * analysis policy flags, and index profile behavior.
 *
 * @param {object} runtime
 * @param {'code'|'prose'|'records'|'extracted-prose'} mode
 * @returns {object}
 */
export const buildFeatureSettings = (runtime, mode) => {
  const analysisFlags = resolveAnalysisFlags(runtime);
  const profileId = runtime?.profile?.id || runtime?.indexingConfig?.profile || 'default';
  const vectorOnly = profileId === INDEX_PROFILE_VECTOR_ONLY;
  const vectorOnlyShortcuts = resolveVectorOnlyShortcutPolicy(runtime);
  return {
    profileId,
    // Query-AST filtering depends on per-chunk tokens even for vector_only retrieval.
    // Keep tokenization enabled while still disabling sparse postings artifacts.
    tokenize: true,
    postings: !vectorOnly,
    embeddings: runtime.embeddingEnabled || runtime.embeddingService,
    gitBlame: analysisFlags.gitBlame,
    pythonAst: runtime.languageOptions?.pythonAst?.enabled !== false && mode === 'code',
    treeSitter: runtime.languageOptions?.treeSitter?.enabled !== false,
    typeInference: analysisFlags.typeInference && mode === 'code',
    riskAnalysis: analysisFlags.riskAnalysis && mode === 'code',
    lint: runtime.lintEnabled && mode === 'code',
    complexity: runtime.complexityEnabled && mode === 'code',
    astDataflow: runtime.astDataflowEnabled && mode === 'code',
    controlFlow: runtime.controlFlowEnabled && mode === 'code',
    typeInferenceCrossFile: analysisFlags.typeInferenceCrossFile && mode === 'code',
    riskAnalysisCrossFile: analysisFlags.riskAnalysisCrossFile && mode === 'code',
    vectorOnlyShortcuts: vectorOnlyShortcuts.enabled
      ? {
        disableImportGraph: vectorOnlyShortcuts.disableImportGraph,
        disableCrossFileInference: vectorOnlyShortcuts.disableCrossFileInference
      }
      : null
  };
};

const countFieldEntries = (fieldMaps) => {
  if (!fieldMaps || typeof fieldMaps !== 'object') return 0;
  let total = 0;
  for (const entry of Object.values(fieldMaps)) {
    if (entry && typeof entry.size === 'number') total += entry.size;
  }
  return total;
};

const countFieldArrayEntries = (fieldArrays) => {
  if (!fieldArrays || typeof fieldArrays !== 'object') return 0;
  let total = 0;
  for (const entry of Object.values(fieldArrays)) {
    if (Array.isArray(entry)) total += entry.length;
  }
  return total;
};

const summarizeGraphRelations = (graphRelations) => {
  if (!graphRelations || typeof graphRelations !== 'object') return null;
  const summarize = (graph) => ({
    nodes: Number.isFinite(graph?.nodeCount) ? graph.nodeCount : 0,
    edges: Number.isFinite(graph?.edgeCount) ? graph.edgeCount : 0
  });
  return {
    callGraph: summarize(graphRelations.callGraph),
    usageGraph: summarize(graphRelations.usageGraph),
    importGraph: summarize(graphRelations.importGraph)
  };
};

const summarizeDocumentExtractionForMode = (state) => {
  const fileInfoByPath = state?.fileInfoByPath;
  if (!(fileInfoByPath && typeof fileInfoByPath.entries === 'function')) return null;
  const files = [];
  const extractorMap = new Map();
  const totals = {
    files: 0,
    pages: 0,
    paragraphs: 0,
    units: 0
  };
  for (const [file, info] of fileInfoByPath.entries()) {
    const extraction = info?.extraction;
    if (!extraction || extraction.status !== 'ok') continue;
    const extractorName = extraction?.extractor?.name || null;
    const extractorVersion = extraction?.extractor?.version || null;
    const extractorTarget = extraction?.extractor?.target || null;
    const extractorKey = `${extractorName || 'unknown'}|${extractorVersion || 'unknown'}|${extractorTarget || ''}`;
    if (!extractorMap.has(extractorKey)) {
      extractorMap.set(extractorKey, {
        name: extractorName,
        version: extractorVersion,
        target: extractorTarget
      });
    }
    const unitCounts = {
      pages: Number(extraction?.counts?.pages) || 0,
      paragraphs: Number(extraction?.counts?.paragraphs) || 0,
      totalUnits: Number(extraction?.counts?.totalUnits) || 0
    };
    totals.files += 1;
    totals.pages += unitCounts.pages;
    totals.paragraphs += unitCounts.paragraphs;
    totals.units += unitCounts.totalUnits;
    files.push({
      file,
      sourceType: extraction.sourceType || null,
      extractor: {
        name: extractorName,
        version: extractorVersion,
        target: extractorTarget
      },
      sourceBytesHash: extraction.sourceBytesHash || null,
      sourceBytesHashAlgo: extraction.sourceBytesHashAlgo || 'sha256',
      unitCounts,
      normalizationPolicy: extraction.normalizationPolicy || null
    });
  }
  files.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  if (!files.length) return null;
  const extractors = Array.from(extractorMap.values()).sort((a, b) => {
    const left = `${a.name || ''}|${a.version || ''}|${a.target || ''}`;
    const right = `${b.name || ''}|${b.version || ''}|${b.target || ''}`;
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
  return {
    schemaVersion: 1,
    files,
    extractors,
    totals
  };
};

/**
 * Build indexes for a given mode.
 * @param {{mode:'code'|'prose'|'records'|'extracted-prose',runtime:object,discovery?:{entries:Array,skippedFiles:Array}}} input
 */
export async function buildIndexForMode({ mode, runtime, discovery = null, abortSignal = null }) {
  throwIfAborted(abortSignal);
  if (mode === 'records') {
    await buildRecordsIndexForRepo({ runtime, discovery, abortSignal });
    if (runtime?.overallProgress?.advance) {
      runtime.overallProgress.advance({ message: 'records' });
    }
    return;
  }
  const crashLogger = await createCrashLogger({
    repoCacheRoot: runtime.repoCacheRoot,
    enabled: runtime.debugCrash === true,
    log
  });
  const outDir = getIndexDir(runtime.root, mode, runtime.userConfig, { indexRoot: runtime.buildRoot });
  const indexSizeBaselineBytes = await readIndexArtifactBytes(outDir);
  await fs.mkdir(outDir, { recursive: true });
  const indexingHealth = runIndexingHealthChecks({ mode, runtime, outDir });
  if (!indexingHealth.ok) {
    const firstFailure = indexingHealth.failures[0] || null;
    const message = formatHealthFailure(firstFailure);
    log(message);
    const error = new Error(message);
    error.code = firstFailure?.code || 'op_health_indexing_failed';
    error.healthReport = indexingHealth;
    throw error;
  }
  log(`[init] ${mode} index dir: ${outDir}`);
  log(`\n📄  Scanning ${mode} ...`);
  const timing = { start: Date.now() };
  const metricsDir = getMetricsDir(runtime.root, runtime.userConfig);
  const analysisFlags = resolveAnalysisFlags(runtime);
  const perfFeatures = {
    stage: runtime.stage || null,
    embeddings: runtime.embeddingEnabled || runtime.embeddingService,
    treeSitter: runtime.languageOptions?.treeSitter?.enabled !== false,
    relations: runtime.stage !== 'stage1',
    tooling: runtime.toolingEnabled,
    typeInference: analysisFlags.typeInference,
    riskAnalysis: analysisFlags.riskAnalysis
  };
  const perfProfile = createPerfProfile({
    configHash: runtime.configHash,
    mode,
    buildId: runtime.buildId,
    features: perfFeatures
  });
  const stageCheckpoints = createStageCheckpointRecorder({
    buildRoot: runtime.buildRoot,
    metricsDir,
    mode,
    buildId: runtime.buildId
  });
  if (runtime.languageOptions?.treeSitter?.enabled !== false) {
    resetTreeSitterStats();
  }
  const featureMetrics = runtime.featureMetrics || null;
  if (featureMetrics?.registerSettings) {
    featureMetrics.registerSettings(mode, buildFeatureSettings(runtime, mode));
  }
  const priorPerfProfile = await loadPerfProfile({
    metricsDir,
    mode,
    configHash: runtime.configHash,
    log
  });
  const shardPerfProfile = priorPerfProfile?.totals?.durationMs
    ? priorPerfProfile
    : null;
  crashLogger.updatePhase(`scan:${mode}`);

  const state = createIndexState({ postingsConfig: runtime.postingsConfig });
  const cacheReporter = createCacheReporter({ enabled: runtime.verboseCache, log });
  const fileTextCache = createLruCache({
    name: 'fileText',
    maxMb: runtime.cacheConfig?.fileText?.maxMb,
    ttlMs: runtime.cacheConfig?.fileText?.ttlMs,
    sizeCalculation: estimateFileTextBytes,
    reporter: cacheReporter
  });
  const fileTextByFile = {
    get: (key) => fileTextCache.get(key),
    set: (key, value) => fileTextCache.set(key, value),
    captureBuffers: true
  };
  const seenFiles = new Set();

  const stagePlan = [
    { id: 'discover', label: 'discovery' },
    { id: 'imports', label: 'imports' },
    { id: 'processing', label: 'processing' },
    { id: 'relations', label: 'relations' },
    { id: 'postings', label: 'postings' },
    { id: 'write', label: 'write' }
  ];
  const stageTotal = stagePlan.length;
  let stageIndex = 0;
  const getSchedulerStats = () => (runtime?.scheduler?.stats ? runtime.scheduler.stats() : null);
  const schedulerTelemetry = runtime?.scheduler
    && typeof runtime.scheduler.setTelemetryOptions === 'function'
    ? runtime.scheduler
    : null;
  const queueDepthSnapshotIntervalMs = Number.isFinite(
    Number(runtime?.indexingConfig?.scheduler?.queueDepthSnapshotIntervalMs)
  )
    ? Math.max(1000, Math.floor(Number(runtime.indexingConfig.scheduler.queueDepthSnapshotIntervalMs)))
    : 5000;
  const queueDepthSnapshotFileThreshold = Number.isFinite(
    Number(runtime?.indexingConfig?.scheduler?.queueDepthSnapshotFileThreshold)
  )
    ? Math.max(1, Math.floor(Number(runtime.indexingConfig.scheduler.queueDepthSnapshotFileThreshold)))
    : 20000;
  let queueDepthSnapshotsEnabled = false;
  const setSchedulerTelemetryStage = (stageId) => {
    if (!schedulerTelemetry || typeof stageId !== 'string') return;
    schedulerTelemetry.setTelemetryOptions({ stage: stageId });
  };
  const enableQueueDepthSnapshots = () => {
    if (!schedulerTelemetry || queueDepthSnapshotsEnabled) return;
    queueDepthSnapshotsEnabled = true;
    schedulerTelemetry.setTelemetryOptions({
      queueDepthSnapshotsEnabled: true,
      queueDepthSnapshotIntervalMs
    });
  };
  if (runtime?.hugeRepoProfileEnabled === true) {
    enableQueueDepthSnapshots();
  }
  let lowUtilizationWarningEmitted = false;
  const utilizationTarget = coerceUnitFraction(runtime?.schedulerConfig?.utilizationAlertTarget)
    ?? 0.75;
  const utilizationAlertWindowMs = Number.isFinite(Number(runtime?.schedulerConfig?.utilizationAlertWindowMs))
    ? Math.max(1000, Math.floor(Number(runtime.schedulerConfig.utilizationAlertWindowMs)))
    : 15000;
  const heavyUtilizationStages = new Set(['processing', 'relations', 'postings', 'write']);
  let utilizationUnderTargetSinceMs = 0;
  let utilizationTargetWarningEmitted = false;
  const queueUtilizationUnderTargetSinceMs = new Map();
  const queueUtilizationWarningEmitted = new Set();
  let lastCpuUsage = process.cpuUsage();
  let lastCpuUsageAtMs = Date.now();

  const resolveProcessBusyPct = (cpuCount) => {
    const usage = process.cpuUsage();
    const nowMs = Date.now();
    const elapsedMs = Math.max(1, nowMs - lastCpuUsageAtMs);
    const previous = lastCpuUsage;
    lastCpuUsage = usage;
    lastCpuUsageAtMs = nowMs;
    if (!previous || !Number.isFinite(cpuCount) || cpuCount <= 0) return null;
    const userDeltaUs = Math.max(0, Number(usage.user) - Number(previous.user));
    const systemDeltaUs = Math.max(0, Number(usage.system) - Number(previous.system));
    const consumedMs = (userDeltaUs + systemDeltaUs) / 1000;
    const capacityMs = elapsedMs * cpuCount;
    if (!Number.isFinite(consumedMs) || !Number.isFinite(capacityMs) || capacityMs <= 0) return null;
    return Math.max(0, Math.min(100, (consumedMs / capacityMs) * 100));
  };
  /**
   * Capture an operational snapshot used for stage checkpoint telemetry.
   *
   * @returns {object}
   */
  const captureRuntimeSnapshot = () => {
    const schedulerStats = getSchedulerStats();
    const schedulerQueueDepth = schedulerStats?.queues
      ? Object.values(schedulerStats.queues).reduce((sum, queue) => (
        sum + (Number.isFinite(Number(queue?.pending)) ? Number(queue.pending) : 0)
      ), 0)
      : null;
    const queueInflightBytes = runtime?.queues
      ? {
        io: Number(runtime.queues.io?.inflightBytes) || 0,
        cpu: Number(runtime.queues.cpu?.inflightBytes) || 0,
        embedding: Number(runtime.queues.embedding?.inflightBytes) || 0,
        proc: Number(runtime.queues.proc?.inflightBytes) || 0
      }
      : null;
    const telemetryInflightBytes = runtime?.telemetry?.readInFlightBytes
      ? runtime.telemetry.readInFlightBytes()
      : null;
    const workerStats = runtime?.workerPool?.stats ? runtime.workerPool.stats() : null;
    const quantizeWorkerStats = runtime?.quantizePool
      && runtime.quantizePool !== runtime.workerPool
      && runtime.quantizePool?.stats
      ? runtime.quantizePool.stats()
      : null;
    const cpuCount = Array.isArray(runtime?.cpuList) && runtime.cpuList.length
      ? runtime.cpuList.length
      : (Array.isArray(os.cpus()) ? os.cpus().length : null);
    const loadAvg = typeof os.loadavg === 'function' ? os.loadavg() : null;
    const oneMinuteLoad = Array.isArray(loadAvg) && Number.isFinite(loadAvg[0]) ? loadAvg[0] : null;
    const normalizedCpuLoad = Number.isFinite(oneMinuteLoad) && Number.isFinite(cpuCount) && cpuCount > 0
      ? Math.max(0, Math.min(1, oneMinuteLoad / cpuCount))
      : null;
    const processBusyPct = resolveProcessBusyPct(cpuCount);
    const resolvedBusyPct = Number.isFinite(normalizedCpuLoad)
      ? Math.max(0, Math.min(100, Math.round(normalizedCpuLoad * 1000) / 10))
      : (Number.isFinite(processBusyPct)
        ? Math.max(0, Math.min(100, Math.round(processBusyPct * 10) / 10))
        : null);
    const totalMem = Number(os.totalmem()) || 0;
    const freeMem = Number(os.freemem()) || 0;
    const memoryUtilization = totalMem > 0
      ? Math.max(0, Math.min(1, (totalMem - freeMem) / totalMem))
      : null;
    return {
      scheduler: schedulerStats,
      cpu: {
        cores: Number.isFinite(cpuCount) ? cpuCount : null,
        loadAvg1m: oneMinuteLoad,
        normalizedLoad: normalizedCpuLoad,
        busyPct: resolvedBusyPct
      },
      memory: {
        totalBytes: totalMem > 0 ? totalMem : null,
        freeBytes: freeMem > 0 ? freeMem : null,
        utilization: memoryUtilization
      },
      queues: runtime?.queues
        ? {
          ioPending: Number.isFinite(runtime.queues.io?.size) ? runtime.queues.io.size : null,
          cpuPending: Number.isFinite(runtime.queues.cpu?.size) ? runtime.queues.cpu.size : null,
          embeddingPending: Number.isFinite(runtime.queues.embedding?.size) ? runtime.queues.embedding.size : null,
          procPending: Number.isFinite(runtime.queues.proc?.size) ? runtime.queues.proc.size : null,
          schedulerPending: schedulerQueueDepth
        }
        : null,
      inFlightBytes: {
        queue: queueInflightBytes,
        telemetry: telemetryInflightBytes,
        total: Number(
          (queueInflightBytes?.io || 0)
          + (queueInflightBytes?.cpu || 0)
          + (queueInflightBytes?.embedding || 0)
          + (queueInflightBytes?.proc || 0)
          + (telemetryInflightBytes?.total || 0)
        ) || 0
      },
      workers: {
        tokenize: workerStats || null,
        quantize: quantizeWorkerStats || null
      }
    };
  };
  const maybeWarnLowSchedulerUtilization = ({ snapshot, stage, step }) => {
    if (lowUtilizationWarningEmitted) return;
    const schedulerStats = snapshot?.scheduler;
    const utilization = Number(schedulerStats?.utilization?.overall);
    const pending = Number(schedulerStats?.activity?.pending);
    const cpuTokens = Number(schedulerStats?.tokens?.cpu?.total);
    const ioTokens = Number(schedulerStats?.tokens?.io?.total);
    const tokenBudget = Math.max(1, Math.floor((cpuTokens || 0) + (ioTokens || 0)));
    if (!Number.isFinite(utilization) || !Number.isFinite(pending)) return;
    if (pending < Math.max(64, tokenBudget * 4)) return;
    if (utilization >= 0.35) return;
    lowUtilizationWarningEmitted = true;
    log(
      `[perf] scheduler under-utilization detected at ${stage}${step ? `/${step}` : ''}: ` +
      `utilization=${utilization.toFixed(2)}, pending=${Math.floor(pending)}, ` +
      `tokens(cpu=${Math.floor(cpuTokens || 0)}, io=${Math.floor(ioTokens || 0)}).`
    );
  };
  const maybeWarnUtilizationTarget = ({ snapshot, stage, step }) => {
    if (!heavyUtilizationStages.has(String(step || stage || '').toLowerCase())) {
      utilizationUnderTargetSinceMs = 0;
      return;
    }
    const schedulerStats = snapshot?.scheduler;
    const utilization = Number(schedulerStats?.utilization?.overall);
    const pending = Number(schedulerStats?.activity?.pending);
    const cpuTokens = Number(schedulerStats?.tokens?.cpu?.total);
    const ioTokens = Number(schedulerStats?.tokens?.io?.total);
    const tokenBudget = Math.max(1, Math.floor((cpuTokens || 0) + (ioTokens || 0)));
    if (!Number.isFinite(utilization) || !Number.isFinite(pending)) {
      utilizationUnderTargetSinceMs = 0;
      return;
    }
    if (pending < Math.max(16, tokenBudget * 2)) {
      utilizationUnderTargetSinceMs = 0;
      return;
    }
    if (utilization >= utilizationTarget) {
      utilizationUnderTargetSinceMs = 0;
      return;
    }
    const now = Date.now();
    if (!utilizationUnderTargetSinceMs) {
      utilizationUnderTargetSinceMs = now;
      return;
    }
    if (utilizationTargetWarningEmitted) return;
    const underMs = now - utilizationUnderTargetSinceMs;
    if (underMs < utilizationAlertWindowMs) return;
    utilizationTargetWarningEmitted = true;
    const underSeconds = Math.max(1, Math.round(underMs / 1000));
    log(
      `[perf] sustained scheduler utilization below target at ${stage}${step ? `/${step}` : ''}: ` +
      `utilization=${utilization.toFixed(2)}, target=${utilizationTarget.toFixed(2)}, ` +
      `pending=${Math.floor(pending)}, duration=${underSeconds}s.`
    );
    stageCheckpoints.record({
      stage: 'scheduler',
      step: 'utilization-target-breach',
      label: `${stage}${step ? `/${step}` : ''}`,
      extra: {
        utilization,
        target: utilizationTarget,
        pending: Math.floor(pending),
        durationMs: underMs
      }
    });
  };
  const maybeWarnQueueUtilizationTarget = ({ snapshot, stage, step }) => {
    const schedulerStats = snapshot?.scheduler;
    const queues = schedulerStats?.queues && typeof schedulerStats.queues === 'object'
      ? schedulerStats.queues
      : null;
    if (!queues) return;
    const now = Date.now();
    for (const [queueName, queueStats] of Object.entries(queues)) {
      const pending = Math.max(0, Number(queueStats?.pending) || 0);
      const running = Math.max(0, Number(queueStats?.running) || 0);
      const demand = pending + running;
      const key = String(queueName || '');
      const warningKey = `${stage || 'unknown'}:${key}`;
      if (!key || demand < 4) {
        queueUtilizationUnderTargetSinceMs.delete(key);
        queueUtilizationWarningEmitted.delete(warningKey);
        continue;
      }
      const utilization = running / Math.max(1, demand);
      if (!Number.isFinite(utilization) || utilization >= utilizationTarget) {
        queueUtilizationUnderTargetSinceMs.delete(key);
        queueUtilizationWarningEmitted.delete(warningKey);
        continue;
      }
      const since = queueUtilizationUnderTargetSinceMs.get(key) || now;
      queueUtilizationUnderTargetSinceMs.set(key, since);
      const underMs = now - since;
      if (underMs < utilizationAlertWindowMs) continue;
      if (queueUtilizationWarningEmitted.has(warningKey)) continue;
      queueUtilizationWarningEmitted.add(warningKey);
      log(
        `[perf] sustained queue utilization below target at ${stage}${step ? `/${step}` : ''}: ` +
        `queue=${key}, utilization=${utilization.toFixed(2)}, target=${utilizationTarget.toFixed(2)}, ` +
        `pending=${pending}, running=${running}, durationMs=${underMs}.`
      );
      stageCheckpoints.record({
        stage: 'scheduler',
        step: 'queue-utilization-target-breach',
        label: `${stage}${step ? `/${step}` : ''}:${key}`,
        extra: {
          queue: key,
          utilization,
          target: utilizationTarget,
          pending,
          running,
          durationMs: underMs
        }
      });
    }
  };
  /**
   * Record a stage checkpoint enriched with the current runtime snapshot.
   *
   * @param {object} input
   * @param {string} input.stage
   * @param {string|null} [input.step]
   * @param {string|null} [input.label]
   * @param {object|null} [input.extra]
   */
  const recordStageCheckpoint = ({
    stage,
    step = null,
    label = null,
    extra = null
  }) => {
    const safeExtra = extra && typeof extra === 'object' ? extra : {};
    const runtimeSnapshot = captureRuntimeSnapshot();
    stageCheckpoints.record({
      stage,
      step,
      label,
      extra: {
        ...safeExtra,
        runtime: runtimeSnapshot
      }
    });
    maybeWarnLowSchedulerUtilization({
      snapshot: runtimeSnapshot,
      stage,
      step
    });
    maybeWarnUtilizationTarget({
      snapshot: runtimeSnapshot,
      stage,
      step
    });
    maybeWarnQueueUtilizationTarget({
      snapshot: runtimeSnapshot,
      stage,
      step
    });
  };
  const advanceStage = (stage) => {
    if (runtime?.overallProgress?.advance && stageIndex > 0) {
      const prevStage = stagePlan[stageIndex - 1];
      runtime.overallProgress.advance({ message: `${mode} ${prevStage.label}` });
    }
    stageIndex += 1;
    setSchedulerTelemetryStage(stage.id);
    showProgress('Stage', stageIndex, stageTotal, {
      taskId: `stage:${mode}`,
      stage: stage.id,
      mode,
      message: stage.label,
      scheduler: getSchedulerStats()
    });
  };

  advanceStage(stagePlan[0]);
  const discoveryResult = await runWithOperationalFailurePolicy({
    target: 'indexing.hotpath',
    operation: 'discovery',
    log,
    execute: async () => runDiscovery({
      runtime,
      mode,
      discovery,
      state,
      timing,
      stageNumber: stageIndex,
      abortSignal
    })
  });
  const allEntries = discoveryResult.value;
  if (!queueDepthSnapshotsEnabled && allEntries.length >= queueDepthSnapshotFileThreshold) {
    enableQueueDepthSnapshots();
  }
  recordStageCheckpoint({
    stage: 'stage1',
    step: 'discovery',
    extra: {
      files: allEntries.length,
      skipped: state.skippedFiles?.length || 0
    }
  });
  await recordOrderingSeedInputs(runtime.buildRoot, {
    discoveryHash: state.discoveryHash,
    fileListHash: state.fileListHash,
    fileCount: allEntries.length
  }, { stage: 'stage1', mode });
  throwIfAborted(abortSignal);
  const dictConfig = applyAdaptiveDictConfig(runtime.dictConfig, allEntries.length);
  const runtimeRef = dictConfig === runtime.dictConfig
    ? runtime
    : { ...runtime, dictConfig };
  const vectorOnlyShortcuts = resolveVectorOnlyShortcutPolicy(runtimeRef);
  state.vectorOnlyShortcuts = vectorOnlyShortcuts.enabled
    ? {
      disableImportGraph: vectorOnlyShortcuts.disableImportGraph,
      disableCrossFileInference: vectorOnlyShortcuts.disableCrossFileInference
    }
    : null;
  if (vectorOnlyShortcuts.enabled) {
    log(
      '[vector_only] analysis shortcuts: '
      + `disableImportGraph=${vectorOnlyShortcuts.disableImportGraph}, `
      + `disableCrossFileInference=${vectorOnlyShortcuts.disableCrossFileInference}.`
    );
  }
  await updateBuildState(runtimeRef.buildRoot, {
    analysisShortcuts: {
      [mode]: {
        profileId: vectorOnlyShortcuts.profileId,
        disableImportGraph: vectorOnlyShortcuts.disableImportGraph,
        disableCrossFileInference: vectorOnlyShortcuts.disableCrossFileInference
      }
    }
  });
  const vectorOnlyProfile = runtimeRef?.profile?.id === INDEX_PROFILE_VECTOR_ONLY;
  if (vectorOnlyProfile && !hasVectorEmbeddingBuildCapability(runtimeRef)) {
    throw new Error(
      'indexing.profile=vector_only requires embeddings to be available during index build. ' +
      'Enable inline/stub embeddings or service-mode embedding queueing and rebuild.'
    );
  }
  const tokenizationKey = buildTokenizationKey(runtimeRef, mode);
  const cacheSignature = buildIncrementalSignature(runtimeRef, mode, tokenizationKey);
  const cacheSignatureSummary = buildIncrementalSignatureSummary(runtimeRef, mode, tokenizationKey);
  await updateBuildState(runtimeRef.buildRoot, {
    signatures: {
      [mode]: {
        tokenizationKey,
        cacheSignature,
        signatureVersion: SIGNATURE_VERSION
      }
    }
  });
  const {
    profilePath: modalitySparsityProfilePath,
    profile: modalitySparsityProfile
  } = await readModalitySparsityProfile(runtimeRef);
  const modalitySparsityKey = buildModalitySparsityEntryKey({ mode, cacheSignature });
  const cachedModalitySparsity = modalitySparsityProfile?.entries?.[modalitySparsityKey] || null;
  const cachedZeroModality = shouldElideModalityProcessingStage({
    fileCount: cachedModalitySparsity?.fileCount ?? null,
    chunkCount: cachedModalitySparsity?.chunkCount ?? null
  });
  const { incrementalState, reused } = await loadIncrementalPlan({
    runtime: runtimeRef,
    mode,
    outDir,
    entries: allEntries,
    tokenizationKey,
    cacheSignature,
    cacheSignatureSummary,
    cacheReporter
  });
  if (reused) {
    recordStageCheckpoint({
      stage: 'stage1',
      step: 'incremental',
      label: 'reused',
      extra: { files: allEntries.length }
    });
    await stageCheckpoints.flush();
    cacheReporter.report();
    return;
  }

  const relationsEnabled = runtimeRef.stage !== 'stage1';
  const importGraphEnabled = relationsEnabled && !vectorOnlyShortcuts.disableImportGraph;
  const crossFileInferenceEnabled = relationsEnabled && !vectorOnlyShortcuts.disableCrossFileInference;
  advanceStage(stagePlan[1]);
  let { importResult, scanPlan } = await preScanImports({
    runtime: runtimeRef,
    mode,
    relationsEnabled: importGraphEnabled,
    entries: allEntries,
    crashLogger,
    timing,
    incrementalState,
    fileTextByFile,
    abortSignal
  });
  recordStageCheckpoint({
    stage: 'stage1',
    step: 'imports',
    extra: {
      imports: importResult?.stats
        ? {
          modules: Number(importResult.stats.modules) || 0,
          edges: Number(importResult.stats.edges) || 0,
          files: Number(importResult.stats.files) || 0
        }
        : { modules: 0, edges: 0, files: 0 }
    }
  });
  throwIfAborted(abortSignal);

  const shouldElideProcessingStage = shouldElideModalityProcessingStage({
    fileCount: allEntries.length,
    chunkCount: state?.chunks?.length || 0
  });

  let processResult = {
    tokenizationStats: null,
    shardSummary: null,
    postingsQueueStats: null,
    stageElided: false
  };
  if (shouldElideProcessingStage) {
    const elisionSource = cachedZeroModality ? 'sparsity-cache-hit' : 'discovery';
    advanceStage(stagePlan[2]);
    processResult = {
      ...processResult,
      stageElided: true
    };
    log(
      `[stage1:${mode}] processing stage elided (zero modality: files=0, chunks=0; source=${elisionSource}).`
    );
    state.modalityStageElisions = {
      ...(state.modalityStageElisions || {}),
      [mode]: {
        source: elisionSource,
        cacheSignature,
        fileCount: 0,
        chunkCount: 0
      }
    };
  } else {
    const contextWin = await estimateContextWindow({
      files: allEntries.map((entry) => entry.abs),
      root: runtimeRef.root,
      mode,
      languageOptions: runtimeRef.languageOptions
    });
    log(`Auto-selected context window: ${contextWin} lines`);

    advanceStage(stagePlan[2]);
    processResult = await processFiles({
      mode,
      runtime: runtimeRef,
      discovery,
      outDir,
      entries: allEntries,
      contextWin,
      timing,
      crashLogger,
      state,
      perfProfile,
      cacheReporter,
      seenFiles,
      incrementalState,
      relationsEnabled,
      shardPerfProfile,
      fileTextCache,
      abortSignal
    });
  }
  throwIfAborted(abortSignal);
  const { tokenizationStats, shardSummary, postingsQueueStats } = processResult;
  const summarizePostingsQueue = (stats) => {
    if (!stats || typeof stats !== 'object') return null;
    return {
      limits: stats.limits || null,
      highWater: stats.highWater || null,
      backpressure: stats.backpressure || null,
      oversize: stats.oversize || null,
      memory: stats.memory || null
    };
  };
  recordStageCheckpoint({
    stage: 'stage1',
    step: 'processing',
    extra: {
      files: allEntries.length,
      chunks: state.chunks?.length || 0,
      tokens: state.totalTokens || 0,
      tokenPostings: state.tokenPostings?.size || 0,
      phrasePostings: state.phrasePost?.size || 0,
      chargramPostings: state.triPost?.size || 0,
      fieldPostings: countFieldEntries(state.fieldPostings),
      fieldDocLengths: countFieldArrayEntries(state.fieldDocLengths),
      treeSitter: getTreeSitterStats(),
      postingsQueue: summarizePostingsQueue(postingsQueueStats),
      stageElided: processResult?.stageElided === true,
      sparsityCacheHit: processResult?.stageElided === true && cachedZeroModality === true
    }
  });
  await updateBuildState(runtimeRef.buildRoot, {
    counts: {
      [mode]: {
        files: allEntries.length,
        chunks: state.chunks?.length || 0,
        skipped: state.skippedFiles?.length || 0
      }
    }
  });
  await writeModalitySparsityEntry({
    runtime: runtimeRef,
    profilePath: modalitySparsityProfilePath,
    profile: modalitySparsityProfile,
    mode,
    cacheSignature,
    fileCount: allEntries.length,
    chunkCount: state.chunks?.length || 0,
    elided: processResult?.stageElided === true,
    source: processResult?.stageElided === true
      ? (cachedZeroModality ? 'sparsity-cache-hit' : 'discovery')
      : 'observed'
  });
  if (mode === 'extracted-prose') {
    const extractionSummary = summarizeDocumentExtractionForMode(state);
    if (extractionSummary) {
      await updateBuildState(runtimeRef.buildRoot, {
        documentExtraction: {
          [mode]: extractionSummary
        }
      });
    }
  }

  const postImportResult = await postScanImports({
    mode,
    relationsEnabled: importGraphEnabled,
    scanPlan,
    state,
    timing,
    runtime: runtimeRef,
    entries: allEntries,
    importResult,
    incrementalState,
    fileTextByFile
  });
  if (postImportResult) importResult = postImportResult;

  const incrementalBundleVfsRowsPromise = mode === 'code'
    && crossFileInferenceEnabled
    && runtimeRef.incrementalEnabled === true
    ? prepareIncrementalBundleVfsRows({
      runtime: runtimeRef,
      incrementalState,
      enabled: true
    })
    : null;

  const overlapConfig = runtimeRef?.indexingConfig?.pipelineOverlap
    && typeof runtimeRef.indexingConfig.pipelineOverlap === 'object'
    ? runtimeRef.indexingConfig.pipelineOverlap
    : {};
  const overlapInferPostings = mode === 'code'
    && overlapConfig.enabled !== false
    && overlapConfig.inferPostings !== false
    && crossFileInferenceEnabled;
  const runPostingsBuild = () => (runtimeRef.scheduler?.schedule
    ? runtimeRef.scheduler.schedule(
      SCHEDULER_QUEUE_NAMES.stage1Postings,
      { cpu: 1 },
      () => buildIndexPostings({ runtime: runtimeRef, state, incrementalState })
    )
    : buildIndexPostings({ runtime: runtimeRef, state, incrementalState }));
  const postingsPromise = overlapInferPostings ? runPostingsBuild() : null;
  if (postingsPromise) {
    // Avoid transient unhandled-rejection noise before the awaited join point.
    postingsPromise.catch(() => {});
  }

  advanceStage(stagePlan[3]);
  const { crossFileEnabled, graphRelations } = await (runtimeRef.scheduler?.schedule
    ? runtimeRef.scheduler.schedule(
      SCHEDULER_QUEUE_NAMES.stage2Relations,
      { cpu: 1, mem: 1 },
      () => runCrossFileInference({
        runtime: runtimeRef,
        mode,
        state,
        crashLogger,
        featureMetrics,
        relationsEnabled: crossFileInferenceEnabled,
        abortSignal
      })
    )
    : runCrossFileInference({
      runtime: runtimeRef,
      mode,
      state,
      crashLogger,
      featureMetrics,
      relationsEnabled: crossFileInferenceEnabled,
      abortSignal
    }));
  throwIfAborted(abortSignal);
  recordStageCheckpoint({
    stage: 'stage2',
    step: 'relations',
    extra: {
      fileRelations: state.fileRelations?.size || 0,
      importGraphCache: postImportResult?.cacheStats
        ? {
          files: Number(postImportResult.cacheStats.files) || 0,
          filesHashed: Number(postImportResult.cacheStats.filesHashed) || 0,
          filesReused: Number(postImportResult.cacheStats.filesReused) || 0,
          filesInvalidated: Number(postImportResult.cacheStats.filesInvalidated) || 0,
          specs: Number(postImportResult.cacheStats.specs) || 0,
          specsReused: Number(postImportResult.cacheStats.specsReused) || 0,
          specsComputed: Number(postImportResult.cacheStats.specsComputed) || 0,
          packageInvalidated: postImportResult.cacheStats.packageInvalidated === true,
          reuseRatio: postImportResult.cacheStats.files
            ? Number(postImportResult.cacheStats.filesReused || 0) / Number(postImportResult.cacheStats.files || 1)
            : 0
        }
        : null,
      importGraph: state.importResolutionGraph?.stats
        ? {
          files: Number(state.importResolutionGraph.stats.files) || 0,
          nodes: Number(state.importResolutionGraph.stats.nodes) || 0,
          edges: Number(state.importResolutionGraph.stats.edges) || 0,
          resolved: Number(state.importResolutionGraph.stats.resolved) || 0,
          external: Number(state.importResolutionGraph.stats.external) || 0,
          unresolved: Number(state.importResolutionGraph.stats.unresolved) || 0,
          truncatedEdges: Number(state.importResolutionGraph.stats.truncatedEdges) || 0,
          truncatedNodes: Number(state.importResolutionGraph.stats.truncatedNodes) || 0,
          warningSuppressed: Number(state.importResolutionGraph.stats.warningSuppressed) || 0
        }
        : null,
      graphs: summarizeGraphRelations(graphRelations),
      shortcuts: {
        importGraphEnabled,
        crossFileInferenceEnabled
      }
    }
  });
  const envConfig = getEnvConfig();
  if (envConfig.verbose === true && tokenizationStats.chunks) {
    const avgTokens = (tokenizationStats.tokens / tokenizationStats.chunks).toFixed(1);
    const avgChargrams = (tokenizationStats.chargrams / tokenizationStats.chunks).toFixed(1);
    log(`[tokenization] ${mode}: chunks=${tokenizationStats.chunks}, tokens=${tokenizationStats.tokens}, avgTokens=${avgTokens}, avgChargrams=${avgChargrams}`);
  }

  await pruneIncrementalState({
    runtime: runtimeRef,
    incrementalState,
    seenFiles
  });

  log(`   → Indexed ${state.chunks.length} chunks, total tokens: ${state.totalTokens.toLocaleString()}`);

  advanceStage(stagePlan[4]);
  throwIfAborted(abortSignal);
  const postings = postingsPromise
    ? await postingsPromise
    : await runPostingsBuild();
  recordStageCheckpoint({
    stage: 'stage1',
    step: 'postings',
    extra: {
      tokenVocab: postings.tokenVocab?.length || 0,
      phraseVocab: postings.phraseVocab?.length || 0,
      chargramVocab: postings.chargramVocab?.length || 0,
      chargramStats: postings.chargramStats || null,
      postingsMerge: postings.postingsMergeStats || null,
      denseVectors: postings.quantizedVectors?.length || 0,
      docVectors: postings.quantizedDocVectors?.length || 0,
      codeVectors: postings.quantizedCodeVectors?.length || 0,
      overlapInferPostings
    }
  });

  advanceStage(stagePlan[5]);
  throwIfAborted(abortSignal);
  await writeIndexArtifactsForMode({
    runtime: runtimeRef,
    mode,
    outDir,
    state,
    postings,
    timing,
    entries: allEntries,
    perfProfile,
    graphRelations,
    shardSummary,
    stageCheckpoints
  });
  if (runtimeRef.incrementalEnabled === true) {
    // Write incremental bundles after artifact finalization so bundle metaV2
    // stays byte-for-byte aligned with emitted chunk_meta.
    const existingVfsManifestRowsByFile = mode === 'code' && crossFileEnabled && incrementalBundleVfsRowsPromise
      ? await incrementalBundleVfsRowsPromise
      : null;
    await updateIncrementalBundles({
      runtime: runtimeRef,
      incrementalState,
      state,
      existingVfsManifestRowsByFile,
      log
    });
  }
  const vfsStats = state.vfsManifestStats || state.vfsManifestCollector?.stats || null;
  const vfsExtra = vfsStats
    ? {
      rows: vfsStats.totalRecords || 0,
      bytes: vfsStats.totalBytes || 0,
      maxLineBytes: vfsStats.maxLineBytes || 0,
      trimmedRows: vfsStats.trimmedRows || 0,
      droppedRows: vfsStats.droppedRows || 0,
      runsSpilled: vfsStats.runsSpilled || 0
    }
    : null;
  recordStageCheckpoint({
    stage: 'stage2',
    step: 'write',
    extra: {
      chunks: state.chunks?.length || 0,
      tokens: state.totalTokens || 0,
      tokenVocab: postings.tokenVocab?.length || 0,
      vfsManifest: vfsExtra
    }
  });
  const indexSizeCurrentBytes = await readIndexArtifactBytes(outDir);
  const indexGrowth = evaluateResourceGrowth({
    baselineBytes: indexSizeBaselineBytes,
    currentBytes: indexSizeCurrentBytes,
    ratioThreshold: RESOURCE_GROWTH_THRESHOLDS.indexSizeRatio,
    deltaThresholdBytes: RESOURCE_GROWTH_THRESHOLDS.indexSizeDeltaBytes
  });
  if (indexGrowth.abnormal) {
    log(formatResourceGrowthWarning({
      code: RESOURCE_WARNING_CODES.INDEX_SIZE_GROWTH_ABNORMAL,
      component: 'indexing',
      metric: `${mode}.artifact_bytes`,
      growth: indexGrowth,
      nextAction: 'Review indexing inputs or profile artifact bloat before release.'
    }));
  }
  throwIfAborted(abortSignal);
  if (runtimeRef?.overallProgress?.advance) {
    const finalStage = stagePlan[stagePlan.length - 1];
    runtimeRef.overallProgress.advance({ message: `${mode} ${finalStage.label}` });
  }
  await writeSchedulerAutoTuneProfile({
    repoCacheRoot: runtimeRef.repoCacheRoot,
    schedulerStats: getSchedulerStats(),
    schedulerConfig: runtimeRef.schedulerConfig,
    buildId: runtimeRef.buildId,
    log
  });
  await enqueueEmbeddingJob({ runtime: runtimeRef, mode, indexDir: outDir, abortSignal });
  crashLogger.updatePhase('done');
  cacheReporter.report();
  await stageCheckpoints.flush();
}

export const indexerPipelineInternals = Object.freeze({
  resolveModalitySparsityProfilePath,
  buildModalitySparsityEntryKey,
  readModalitySparsityProfile,
  writeModalitySparsityEntry,
  shouldElideModalityProcessingStage
});
