import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getCacheRuntimeConfig,
  getEffectiveConfigHash,
  getBuildsRoot,
  getCacheRoot,
  getRepoCacheRoot,
  getToolVersion,
  getToolingConfig,
  getTriageConfig,
  loadUserConfig,
  resolveIndexRoot
} from '../../../shared/dict-utils.js';
import { normalizeBundleFormat } from '../../../shared/bundle-io.js';
import { normalizeCommentConfig } from '../../comments.js';
import { normalizeSegmentsConfig } from '../../segments.js';
import { log } from '../../../shared/progress.js';
import { getEnvConfig, isTestingEnv } from '../../../shared/env.js';
import { isAbsolutePathNative } from '../../../shared/files.js';
import { resolveCacheFilesystemProfile } from '../../../shared/cache-roots.js';
import { buildAutoPolicy } from '../../../shared/auto-policy.js';
import { warmEmbeddingAdapter } from '../../../shared/embedding-adapter.js';
import { buildIgnoreMatcher } from '../ignore.js';
import { normalizePostingsConfig } from '../../../shared/postings-config.js';
import { normalizeEmbeddingBatchMultipliers } from '../embedding-batch.js';
import { mergeConfig } from '../../../shared/config.js';
import { setXxhashBackend } from '../../../shared/hash.js';
import { getScmProvider, getScmProviderAndRoot, resolveScmConfig } from '../../scm/registry.js';
import { setScmRuntimeConfig } from '../../scm/runtime.js';
import { normalizeRiskConfig } from '../../risk.js';
import { normalizeRiskInterproceduralConfig } from '../../risk-interprocedural/config.js';
import { normalizeRecordsConfig } from '../records.js';
import { resolveRuntimeEnvelope } from '../../../shared/runtime-envelope.js';
import { buildContentConfigHash } from './hash.js';
import { normalizeStage, buildStageOverrides } from './stage.js';
import {
  configureRuntimeLogger,
  logRuntimeFeatureStatus,
  logRuntimePostTreeSitterFeatureStatus
} from './logging.js';
import { applyTreeSitterJsCaps, normalizeLimit, resolveFileCapsAndGuardrails } from './caps.js';
import {
  normalizeLanguageParserConfig,
  normalizeLanguageFlowConfig
} from './normalize.js';
import { buildAnalysisPolicy, buildLexiconConfig } from './policy.js';
import {
  buildFileScanConfig,
  buildGeneratedIndexingPolicyConfig,
  buildShardConfig,
  resolveRuntimeBuildRoot
} from './config.js';
import { resolveEmbeddingRuntime } from './embeddings.js';
import { createBuildScheduler } from '../../../shared/concurrency.js';
import { resolveSchedulerConfig } from './scheduler.js';
import { loadSchedulerAutoTuneProfile } from './scheduler-autotune-profile.js';
import { resolveTreeSitterRuntime } from './tree-sitter.js';
import {
  acquireRuntimeDaemonSession,
  createRuntimeDaemonJobContext,
  hasDaemonEmbeddingWarmKey,
  addDaemonEmbeddingWarmKey
} from './daemon-session.js';
import { resolveLearnedAutoProfileSelection } from './learned-auto-profile.js';
import {
  createRuntimeQueues,
  resolveRuntimeMemoryPolicy,
  resolveWorkerPoolRuntimeConfig,
  createRuntimeWorkerPools
} from './workers.js';
import {
  buildStage1SubprocessOwnershipPrefix,
  createRuntimeTelemetry,
  resolveStage1Queues
} from './queues.js';
import {
  applyLearnedAutoProfileSelection,
  normalizeIndexOptimizationProfile,
  resolvePlatformRuntimePreset,
  runStartupCalibrationProbe
} from './platform-preset.js';
import {
  assertKnownIndexProfileId,
  buildIndexProfileState
} from '../../../contracts/index-profile.js';
import { resolveRuntimeDictionaries } from './dictionaries.js';
import { preloadTreeSitterWithDaemonCache } from './tree-sitter-preload.js';

export {
  applyLearnedAutoProfileSelection,
  normalizeIndexOptimizationProfile,
  resolvePlatformRuntimePreset,
  runStartupCalibrationProbe
};

/**
 * Narrow values to plain object records (excluding arrays).
 *
 * @param {unknown} value
 * @returns {boolean}
 */
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Create runtime configuration for build_index.
 * @param {{root:string,argv:object,rawArgv:string[]}} input
 * @returns {Promise<object>}
 */
export async function createBuildRuntime({ root, argv, rawArgv, policy, indexRoot: indexRootOverride = null } = {}) {
  const initStartedAt = Date.now();
  /**
   * Emit a timed initialization step log entry.
   *
   * @param {string} label
   * @param {number} startedAt
   * @returns {void}
   */
  const logInit = (label, startedAt) => {
    const elapsed = Math.max(0, Date.now() - startedAt);
    log(`[init] ${label} (${elapsed}ms)`);
  };
  /**
   * Run one initialization phase and log elapsed time.
   *
   * @template T
   * @param {string} label
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  const timeInit = async (label, fn) => {
    const startedAt = Date.now();
    const result = await fn();
    logInit(label, startedAt);
    return result;
  };

  const userConfig = await timeInit('load config', () => loadUserConfig(root));
  const envConfig = getEnvConfig();
  const importGraphEnabled = envConfig.importGraph == null ? true : envConfig.importGraph;
  const rawIndexingConfig = userConfig.indexing || {};
  let indexingConfig = rawIndexingConfig;
  const qualityOverride = typeof argv.quality === 'string' ? argv.quality.trim().toLowerCase() : '';
  const policyConfig = qualityOverride ? { ...userConfig, quality: qualityOverride } : userConfig;
  const autoPolicy = policy
    ? policy
    : await timeInit('auto policy', () => buildAutoPolicy({ repoRoot: root, config: policyConfig }));
  if (policy) {
    log('[init] auto policy (provided)');
  }
  const policyConcurrency = autoPolicy?.indexing?.concurrency || null;
  const policyEmbeddings = autoPolicy?.indexing?.embeddings || null;
  const policyWorkerPool = autoPolicy?.runtime?.workerPool || null;
  const autoPolicyProfile = isObject(autoPolicy?.profile)
    ? autoPolicy.profile
    : { id: 'default', enabled: false };
  const policyHugeRepoProfile = isObject(autoPolicy?.indexing?.hugeRepoProfile)
    ? autoPolicy.indexing.hugeRepoProfile
    : null;
  const explicitHugeRepoProfile = isObject(indexingConfig?.hugeRepoProfile)
    ? indexingConfig.hugeRepoProfile
    : {};
  const hugeRepoProfileEnabled = typeof explicitHugeRepoProfile.enabled === 'boolean'
    ? explicitHugeRepoProfile.enabled
    : policyHugeRepoProfile?.enabled === true;
  if (hugeRepoProfileEnabled && isObject(policyHugeRepoProfile?.overrides)) {
    indexingConfig = mergeConfig(indexingConfig, policyHugeRepoProfile.overrides);
  }
  if (policyConcurrency) {
    indexingConfig = mergeConfig(indexingConfig, {
      concurrency: policyConcurrency.files,
      importConcurrency: policyConcurrency.imports,
      ioConcurrencyCap: policyConcurrency.io
    });
  }
  if (policyEmbeddings && typeof policyEmbeddings.enabled === 'boolean') {
    indexingConfig = mergeConfig(indexingConfig, {
      embeddings: { enabled: policyEmbeddings.enabled }
    });
  }
  if (policyWorkerPool) {
    indexingConfig = mergeConfig(indexingConfig, {
      workerPool: {
        enabled: policyWorkerPool.enabled !== false ? 'auto' : false,
        maxWorkers: policyWorkerPool.maxThreads
      }
    });
  }
  if (hugeRepoProfileEnabled) {
    indexingConfig = mergeConfig(indexingConfig, {
      hugeRepoProfile: {
        enabled: true,
        id: autoPolicyProfile.id || 'huge-repo'
      }
    });
  }
  const baseEmbeddingsConfig = indexingConfig.embeddings || {};
  const baseEmbeddingModeRaw = typeof baseEmbeddingsConfig.mode === 'string'
    ? baseEmbeddingsConfig.mode.trim().toLowerCase()
    : 'auto';
  const baseEmbeddingMode = ['auto', 'inline', 'service', 'stub', 'off'].includes(baseEmbeddingModeRaw)
    ? baseEmbeddingModeRaw
    : 'auto';
  const baseEmbeddingsPlanned = baseEmbeddingsConfig.enabled !== false && baseEmbeddingMode !== 'off';
  const requestedHashBackend = typeof indexingConfig?.hash?.backend === 'string'
    ? indexingConfig.hash.backend.trim().toLowerCase()
    : '';
  if (requestedHashBackend && !envConfig.xxhashBackend) {
    setXxhashBackend(requestedHashBackend);
  }
  const stage = normalizeStage(argv.stage || envConfig.stage);
  const twoStageConfig = indexingConfig.twoStage || {};
  const stageOverrides = buildStageOverrides(twoStageConfig, stage);
  if (stageOverrides) {
    indexingConfig = mergeConfig(indexingConfig, stageOverrides);
  }
  const repoCacheRoot = getRepoCacheRoot(root, userConfig);
  const cacheRootCandidate = (userConfig.cache && userConfig.cache.root) || getCacheRoot();
  const filesystemProfile = resolveCacheFilesystemProfile(cacheRootCandidate, process.platform);
  const platformRuntimePreset = resolvePlatformRuntimePreset({
    platform: process.platform,
    filesystemProfile,
    cpuCount: os.cpus().length,
    indexingConfig
  });
  if (platformRuntimePreset?.overrides) {
    indexingConfig = mergeConfig(indexingConfig, platformRuntimePreset.overrides);
  }
  const learnedAutoProfile = await timeInit('learned auto profile', () => resolveLearnedAutoProfileSelection({
    root,
    repoCacheRoot,
    indexingConfig,
    log
  }));
  indexingConfig = applyLearnedAutoProfileSelection({
    indexingConfig,
    learnedAutoProfile
  });
  const profileId = assertKnownIndexProfileId(indexingConfig.profile);
  const profile = buildIndexProfileState(profileId);
  const indexOptimizationProfile = normalizeIndexOptimizationProfile(
    indexingConfig.indexOptimizationProfile
  );
  indexingConfig = {
    ...indexingConfig,
    profile: profile.id,
    indexOptimizationProfile
  };
  const rawArgs = Array.isArray(rawArgv) ? rawArgv : [];
  const scmAnnotateOverride = rawArgs.includes('--scm-annotate')
    ? true
    : (rawArgs.includes('--no-scm-annotate') ? false : null);
  if (scmAnnotateOverride != null) {
    indexingConfig = mergeConfig(indexingConfig, {
      scm: { annotate: { enabled: scmAnnotateOverride } }
    });
  }
  const scmConfig = resolveScmConfig({
    indexingConfig,
    analysisPolicy: userConfig.analysisPolicy || null,
    benchRun: envConfig.benchRun === true
  });
  setScmRuntimeConfig(scmConfig);
  const cacheRoot = cacheRootCandidate;
  const cacheRootSource = userConfig.cache?.root
    ? 'config'
    : (envConfig.cacheRoot ? 'env' : 'default');
  log(`[init] cache root (${cacheRootSource}): ${path.resolve(cacheRoot)}`);
  log(`[init] repo cache root: ${path.resolve(repoCacheRoot)}`);
  if (platformRuntimePreset?.enabled !== false) {
    const fanoutHint = platformRuntimePreset?.subprocessFanout?.maxParallelismHint;
    const fanoutReason = platformRuntimePreset?.subprocessFanout?.reason || 'unknown';
    log(
      `[init] platform preset: ${platformRuntimePreset?.presetId || 'default'} ` +
      `(fs=${filesystemProfile}, subprocessFanout=${fanoutHint || 'n/a'}, reason=${fanoutReason}).`
    );
  }
  const startupCalibrationEnabled = indexingConfig?.platformPresets?.startupCalibration !== false;
  const startupCalibration = await timeInit('startup calibration', () => runStartupCalibrationProbe({
    cacheRoot,
    enabled: startupCalibrationEnabled
  }));
  if (startupCalibration?.enabled) {
    if (startupCalibration?.error) {
      log(`[init] startup calibration probe degraded: ${startupCalibration.error}`);
    } else {
      log(
        `[init] startup calibration: io=${startupCalibration.writeReadMs}ms ` +
        `(bytes=${startupCalibration.probeBytes}).`
      );
    }
  }
  const daemonConfig = indexingConfig?.daemon && typeof indexingConfig.daemon === 'object'
    ? indexingConfig.daemon
    : {};
  const daemonEnabledFromArg = argv.daemon === true || argv.daemonEnabled === true;
  const daemonSessionKeyFromArg = typeof argv.daemonSessionKey === 'string'
    ? argv.daemonSessionKey.trim()
    : '';
  const daemonDeterministicArg = typeof argv.daemonDeterministic === 'boolean'
    ? argv.daemonDeterministic
    : null;
  const daemonHealthArg = argv.daemonHealth && typeof argv.daemonHealth === 'object'
    ? argv.daemonHealth
    : null;
  const daemonEnabled = daemonEnabledFromArg
    || daemonConfig.enabled === true
    || envConfig.indexDaemon === true;
  const daemonDeterministic = daemonDeterministicArg === null
    ? daemonConfig.deterministic !== false
    : daemonDeterministicArg !== false;
  const daemonHealthConfig = daemonHealthArg || (
    daemonConfig.health && typeof daemonConfig.health === 'object'
      ? daemonConfig.health
      : null
  );
  const daemonSession = acquireRuntimeDaemonSession({
    enabled: daemonEnabled,
    sessionKey: daemonSessionKeyFromArg || daemonConfig.sessionKey || envConfig.indexDaemonSession || null,
    cacheRoot,
    repoRoot: root,
    deterministic: daemonDeterministic,
    profile: profile.id,
    health: daemonHealthConfig
  });
  if (daemonSession) {
    log(`[init] daemon session: ${daemonSession.key} (jobs=${daemonSession.jobsProcessed}, deterministic=${daemonSession.deterministic !== false}).`);
  }
  const envelope = await timeInit('runtime envelope', () => resolveRuntimeEnvelope({
    argv,
    rawArgv,
    userConfig,
    autoPolicy,
    env: process.env,
    execArgv: process.execArgv,
    cpuCount: os.cpus().length,
    processInfo: {
      pid: process.pid,
      argv: process.argv,
      execPath: process.execPath,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCount: os.cpus().length
    },
    toolVersion: getToolVersion()
  }));
  const logFileRaw = typeof argv['log-file'] === 'string' ? argv['log-file'].trim() : '';
  const logFormatRaw = typeof argv['log-format'] === 'string' ? argv['log-format'].trim() : '';
  const logFormatOverride = logFormatRaw ? logFormatRaw.toLowerCase() : null;
  const logDestination = logFileRaw
    ? (isAbsolutePathNative(logFileRaw) ? logFileRaw : path.resolve(root, logFileRaw))
    : null;
  if (logDestination) {
    try {
      await fs.mkdir(path.dirname(logDestination), { recursive: true });
    } catch {}
  }
  if (Array.isArray(envelope.warnings) && envelope.warnings.length) {
    for (const warning of envelope.warnings) {
      if (!warning?.message) continue;
      log(`[warn] ${warning.message}`);
    }
  }
  const telemetry = createRuntimeTelemetry();
  const preRuntimeMemoryPolicy = resolveRuntimeMemoryPolicy({
    indexingConfig,
    cpuConcurrency: envelope?.concurrency?.cpuConcurrency?.value
  });
  const schedulerAutoTuneProfile = await loadSchedulerAutoTuneProfile({
    repoCacheRoot,
    log: (line) => log(line)
  });
  const schedulerConfig = resolveSchedulerConfig({
    argv,
    rawArgv,
    envConfig,
    indexingConfig,
    runtimeConfig: userConfig.runtime || null,
    envelope,
    autoTuneProfile: schedulerAutoTuneProfile
  });
  const scheduler = createBuildScheduler({
    enabled: schedulerConfig.enabled,
    lowResourceMode: schedulerConfig.lowResourceMode,
    cpuTokens: schedulerConfig.cpuTokens,
    ioTokens: schedulerConfig.ioTokens,
    memoryTokens: schedulerConfig.memoryTokens,
    adaptive: schedulerConfig.adaptive,
    adaptiveTargetUtilization: schedulerConfig.adaptiveTargetUtilization,
    adaptiveStep: schedulerConfig.adaptiveStep,
    adaptiveMemoryReserveMb: Math.max(
      schedulerConfig.adaptiveMemoryReserveMb,
      preRuntimeMemoryPolicy?.reserveRssMb || 0
    ),
    adaptiveMemoryPerTokenMb: schedulerConfig.adaptiveMemoryPerTokenMb,
    maxCpuTokens: schedulerConfig.maxCpuTokens,
    maxIoTokens: schedulerConfig.maxIoTokens,
    maxMemoryTokens: schedulerConfig.maxMemoryTokens,
    starvationMs: schedulerConfig.starvationMs,
    queues: schedulerConfig.queues,
    writeBackpressure: schedulerConfig.writeBackpressure,
    adaptiveSurfaces: schedulerConfig.adaptiveSurfaces
  });
  const stage1Queues = resolveStage1Queues(indexingConfig);
  const triageConfig = getTriageConfig(root, userConfig);
  const recordsConfig = normalizeRecordsConfig(userConfig.records || {});
  const currentIndexRoot = resolveIndexRoot(root, userConfig);
  const configHash = getEffectiveConfigHash(root, policyConfig);
  const contentConfigHash = buildContentConfigHash(policyConfig, envConfig);
  const scmProviderOverride = typeof argv['scm-provider'] === 'string'
    ? argv['scm-provider']
    : (typeof argv.scmProvider === 'string' ? argv.scmProvider : null);
  const scmProviderSetting = scmProviderOverride || scmConfig?.provider || 'auto';
  let scmSelection = getScmProviderAndRoot({
    provider: scmProviderSetting,
    startPath: root,
    log
  });
  if (scmSelection.provider === 'none') {
    log('[scm] provider=none; SCM provenance unavailable.');
  }
  let scmProvenanceFailed = false;
  const repoProvenance = await timeInit('repo provenance', async () => {
    try {
      const provenance = await scmSelection.providerImpl.getRepoProvenance({
        repoRoot: scmSelection.repoRoot
      });
      return {
        ...provenance,
        provider: provenance?.provider || scmSelection.provider,
        root: provenance?.root || scmSelection.repoRoot,
        detectedBy: provenance?.detectedBy ?? scmSelection.detectedBy
      };
    } catch (err) {
      const message = err?.message || String(err);
      log(`[scm] Failed to read repo provenance; falling back to provider=none. (${message})`);
      scmProvenanceFailed = true;
      return {
        provider: 'none',
        root: scmSelection.repoRoot,
        head: null,
        dirty: null,
        detectedBy: scmSelection.detectedBy || 'none',
        isRepo: false
      };
    }
  });
  if (scmProvenanceFailed && scmSelection.provider !== 'none') {
    log('[scm] disabling provider after provenance failure; falling back to provider=none.');
    scmSelection = {
      ...scmSelection,
      provider: 'none',
      providerImpl: getScmProvider('none'),
      detectedBy: scmSelection.detectedBy || 'none'
    };
  }
  const toolVersion = getToolVersion();
  const scmHeadId = repoProvenance?.head?.changeId
    || repoProvenance?.head?.commitId
    || repoProvenance?.commit
    || null;
  const resolvedIndexRoot = indexRootOverride ? path.resolve(indexRootOverride) : null;
  const buildsRoot = getBuildsRoot(root, userConfig);
  const { buildId, buildRoot } = resolveRuntimeBuildRoot({
    resolvedIndexRoot,
    buildsRoot,
    scmHeadId,
    configHash,
    existsSync: fsSync.existsSync
  });
  const stage1SubprocessOwnershipPrefix = buildStage1SubprocessOwnershipPrefix({ buildId });
  const daemonJobContext = createRuntimeDaemonJobContext(daemonSession, {
    root,
    buildId
  });
  if (buildRoot) {
    const suffix = resolvedIndexRoot ? ' (override)' : '';
    log(`[init] build root: ${buildRoot}${suffix}`);
  }
  if (currentIndexRoot) {
    log(`[init] current index root: ${currentIndexRoot}`);
  }
  const loggingConfig = userConfig.logging || {};
  configureRuntimeLogger({
    envConfig,
    loggingConfig,
    buildId,
    configHash,
    stage,
    root,
    logDestination,
    logFormatOverride
  });
  const toolingConfig = getToolingConfig(root, userConfig);
  const toolingEnabled = toolingConfig.autoEnableOnDetect !== false;
  const postingsConfig = normalizePostingsConfig(indexingConfig.postings || {});
  const lexiconConfig = buildLexiconConfig({ indexingConfig, autoPolicy });
  const { maxFileBytes, fileCaps, guardrails } = resolveFileCapsAndGuardrails(indexingConfig);
  const astDataflowEnabled = indexingConfig.astDataflow !== false;
  const controlFlowEnabled = indexingConfig.controlFlow !== false;
  const typeInferenceEnabled = indexingConfig.typeInference !== false;
  const typeInferenceCrossFileEnabled = indexingConfig.typeInferenceCrossFile !== false;
  const riskAnalysisEnabled = indexingConfig.riskAnalysis !== false;
  const riskAnalysisCrossFileEnabled = riskAnalysisEnabled
    && indexingConfig.riskAnalysisCrossFile !== false;
  const riskConfig = normalizeRiskConfig({
    enabled: riskAnalysisEnabled,
    rules: indexingConfig.riskRules,
    caps: indexingConfig.riskCaps,
    regex: indexingConfig.riskRegex || indexingConfig.riskRules?.regex
  }, { rootDir: root });
  const riskInterproceduralConfig = normalizeRiskInterproceduralConfig(
    indexingConfig.riskInterprocedural,
    {}
  );
  const riskInterproceduralEnabled = riskAnalysisEnabled && riskInterproceduralConfig.enabled;
  const scmAnnotateEnabled = scmConfig?.annotate?.enabled !== false;
  const effectiveScmAnnotateEnabled = scmAnnotateEnabled && scmSelection.provider !== 'none';
  const scmAnnotateTimeoutMs = Number.isFinite(Number(scmConfig?.annotate?.timeoutMs))
    ? Math.max(0, Math.floor(Number(scmConfig.annotate.timeoutMs)))
    : null;
  const scmAnnotateTimeoutLadder = Array.isArray(scmConfig?.annotate?.timeoutLadderMs)
    ? scmConfig.annotate.timeoutLadderMs
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.max(1, Math.floor(value)))
    : [];
  if (scmAnnotateEnabled && scmSelection.provider === 'none') {
    log('[scm] annotate disabled: provider=none.');
  }
  const gitBlameEnabled = effectiveScmAnnotateEnabled;
  const scmTimeoutMs = Number.isFinite(Number(scmConfig?.timeoutMs))
    ? Math.max(0, Math.floor(Number(scmConfig.timeoutMs)))
    : null;
  log(
    `[scm] policy provider=${scmSelection.provider} annotate=${gitBlameEnabled ? 'on' : 'off'} ` +
      `benchRun=${envConfig.benchRun === true ? '1' : '0'} ` +
      `metaTimeoutMs=${scmTimeoutMs ?? 'default'} ` +
      `annotateTimeoutMs=${scmAnnotateTimeoutMs ?? 'default'} ` +
      `annotateLadder=${scmAnnotateTimeoutLadder.length ? scmAnnotateTimeoutLadder.join('>') : 'default'}`
  );
  const lintEnabled = indexingConfig.lint !== false;
  const complexityEnabled = indexingConfig.complexity !== false;
  const analysisPolicy = buildAnalysisPolicy({
    toolingEnabled,
    typeInferenceEnabled,
    typeInferenceCrossFileEnabled,
    riskAnalysisEnabled,
    riskAnalysisCrossFileEnabled,
    riskInterproceduralEnabled,
    riskInterproceduralSummaryOnly: riskInterproceduralConfig.summaryOnly,
    gitBlameEnabled
  });
  const skipUnknownLanguages = indexingConfig.skipUnknownLanguages === true;
  const skipOnParseError = indexingConfig.skipOnParseError === true;
  const yamlChunkingModeRaw = typeof indexingConfig.yamlChunking === 'string'
    ? indexingConfig.yamlChunking.trim().toLowerCase()
    : '';
  const yamlChunkingMode = ['auto', 'root', 'top-level'].includes(yamlChunkingModeRaw)
    ? yamlChunkingModeRaw
    : 'auto';
  const yamlTopLevelMaxBytesRaw = Number(indexingConfig.yamlTopLevelMaxBytes);
  const yamlTopLevelMaxBytes = Number.isFinite(yamlTopLevelMaxBytesRaw)
    ? Math.max(0, Math.floor(yamlTopLevelMaxBytesRaw))
    : 200 * 1024;
  const kotlinConfig = indexingConfig.kotlin || {};
  const kotlinFlowMaxBytes = normalizeLimit(kotlinConfig.flowMaxBytes, 200 * 1024);
  const kotlinFlowMaxLines = normalizeLimit(kotlinConfig.flowMaxLines, 3000);
  const kotlinRelationsMaxBytes = normalizeLimit(kotlinConfig.relationsMaxBytes, 200 * 1024);
  const kotlinRelationsMaxLines = normalizeLimit(kotlinConfig.relationsMaxLines, 2000);
  const parserConfig = normalizeLanguageParserConfig(indexingConfig);
  const typescriptConfig = indexingConfig.typescript || {};
  const typescriptImportsOnly = typescriptConfig.importsOnly === true;
  const typescriptEmbeddingBatchRaw = Number(typescriptConfig.embeddingBatchMultiplier);
  const typescriptEmbeddingBatchMultiplier = Number.isFinite(typescriptEmbeddingBatchRaw)
    && typescriptEmbeddingBatchRaw > 0
    ? typescriptEmbeddingBatchRaw
    : null;
  const embeddingBatchMultipliers = normalizeEmbeddingBatchMultipliers(
    indexingConfig.embeddingBatchMultipliers || {},
    typescriptEmbeddingBatchMultiplier ? { typescript: typescriptEmbeddingBatchMultiplier } : {}
  );
  const flowConfig = normalizeLanguageFlowConfig(indexingConfig);
  const pythonAstConfig = indexingConfig.pythonAst || {};
  const pythonAstEnabled = pythonAstConfig.enabled !== false;
  const segmentsConfig = normalizeSegmentsConfig(indexingConfig.segments || {});
  const commentsConfig = normalizeCommentConfig(indexingConfig.comments || {});
  const chunkingConfig = indexingConfig.chunking || {};
  const tokenizationConfig = indexingConfig.tokenization || {};
  const tokenizationFileStream = tokenizationConfig.fileStream !== false;
  const chunking = {
    maxBytes: normalizeLimit(chunkingConfig.maxBytes, null),
    maxLines: normalizeLimit(chunkingConfig.maxLines, null)
  };
  const treeSitterStart = Date.now();
  const {
    treeSitterEnabled,
    treeSitterLanguages,
    treeSitterConfigChunking,
    treeSitterMaxBytes,
    treeSitterMaxLines,
    treeSitterMaxParseMs,
    treeSitterByLanguage,
    treeSitterPreload,
    treeSitterPreloadConcurrency,
    treeSitterBatchByLanguage,
    treeSitterBatchEmbeddedLanguages,
    treeSitterLanguagePasses,
    treeSitterDeferMissing,
    treeSitterDeferMissingMax,
    treeSitterWorker,
    treeSitterScheduler,
    treeSitterCachePersistent,
    treeSitterCachePersistentDir
  } = resolveTreeSitterRuntime(indexingConfig);
  const resolvedTreeSitterCachePersistentDir = treeSitterCachePersistent
    ? (treeSitterCachePersistentDir
      ? (isAbsolutePathNative(treeSitterCachePersistentDir)
        ? treeSitterCachePersistentDir
        : path.resolve(root, treeSitterCachePersistentDir))
      : path.join(repoCacheRoot, 'tree-sitter-chunk-cache'))
    : null;
  logInit('tree-sitter config', treeSitterStart);
  if (applyTreeSitterJsCaps(fileCaps, treeSitterMaxBytes)) {
    log(`JS file caps default to tree-sitter maxBytes (${treeSitterMaxBytes}).`);
  }
  const sqlConfig = userConfig.sql || {};
  const defaultSqlDialects = {
    '.psql': 'postgres',
    '.pgsql': 'postgres',
    '.mysql': 'mysql',
    '.sqlite': 'sqlite'
  };
  const sqlDialectByExt = { ...defaultSqlDialects, ...(sqlConfig.dialectByExt || {}) };
  const sqlDialectOverride = typeof sqlConfig.dialect === 'string' && sqlConfig.dialect.trim()
    ? sqlConfig.dialect.trim()
    : '';
  /**
   * Resolve effective SQL dialect for a file extension, honoring explicit
   * global override first, then extension mapping fallback.
   *
   * @param {string} ext
   * @returns {string}
   */
  const resolveSqlDialect = (ext) => (sqlDialectOverride || sqlDialectByExt[ext] || 'generic');
  const twoStageEnabled = twoStageConfig.enabled === true;
  const twoStageBackground = twoStageConfig.background === true;
  const twoStageQueue = twoStageConfig.queue !== false && twoStageBackground;

  const {
    cpuCount,
    maxConcurrencyCap,
    fileConcurrency,
    importConcurrency,
    ioConcurrency,
    cpuConcurrency
  } = {
    cpuCount: envelope.concurrency.cpuCount,
    maxConcurrencyCap: envelope.concurrency.maxConcurrencyCap,
    fileConcurrency: envelope.concurrency.fileConcurrency.value,
    importConcurrency: envelope.concurrency.importConcurrency.value,
    ioConcurrency: envelope.concurrency.ioConcurrency.value,
    cpuConcurrency: envelope.concurrency.cpuConcurrency.value
  };
  const normalizedScmMaxConcurrentProcesses = Number.isFinite(Number(scmConfig?.maxConcurrentProcesses))
    ? Math.max(1, Math.floor(Number(scmConfig.maxConcurrentProcesses)))
    : Math.max(
      1,
      Math.floor(
        cpuConcurrency
        || fileConcurrency
        || ioConcurrency
        || 1
      )
    );
  setScmRuntimeConfig({
    ...scmConfig,
    repoHeadId: scmHeadId || null,
    repoProvenance,
    maxConcurrentProcesses: normalizedScmMaxConcurrentProcesses,
    runtime: {
      cpuCount,
      maxConcurrencyCap,
      fileConcurrency,
      ioConcurrency,
      cpuConcurrency
    }
  });
  const runtimeMemoryPolicy = resolveRuntimeMemoryPolicy({
    indexingConfig,
    cpuConcurrency
  });
  const rawWorkerPoolConfig = indexingConfig.workerPool && typeof indexingConfig.workerPool === 'object'
    ? indexingConfig.workerPool
    : {};
  if (rawWorkerPoolConfig.heapTargetMb == null || rawWorkerPoolConfig.heapMinMb == null || rawWorkerPoolConfig.heapMaxMb == null) {
    indexingConfig = mergeConfig(indexingConfig, {
      workerPool: {
        ...(rawWorkerPoolConfig.heapTargetMb == null
          ? { heapTargetMb: runtimeMemoryPolicy.workerHeapPolicy.targetPerWorkerMb }
          : {}),
        ...(rawWorkerPoolConfig.heapMinMb == null
          ? { heapMinMb: runtimeMemoryPolicy.workerHeapPolicy.minPerWorkerMb }
          : {}),
        ...(rawWorkerPoolConfig.heapMaxMb == null
          ? { heapMaxMb: runtimeMemoryPolicy.workerHeapPolicy.maxPerWorkerMb }
          : {})
      }
    });
  }

  const embeddingRuntime = await timeInit('embedding runtime', () => resolveEmbeddingRuntime({
    rootDir: root,
    userConfig,
    recordsDir: triageConfig.recordsDir,
    recordsConfig,
    indexingConfig,
    envConfig,
    argv,
    cpuConcurrency
  }));
  const {
    embeddingBatchSize,
    embeddingConcurrency,
    embeddingEnabled,
    embeddingMode: resolvedEmbeddingMode,
    embeddingService,
    embeddingProvider,
    embeddingOnnx,
    embeddingNormalize,
    embeddingQueue,
    embeddingIdentity,
    embeddingIdentityKey,
    embeddingCache,
    useStubEmbeddings,
    modelConfig,
    modelId,
    modelsDir,
    getChunkEmbedding,
    getChunkEmbeddings
  } = embeddingRuntime;
  const daemonPrewarmEmbeddings = daemonConfig.prewarmEmbeddings !== false;
  const embeddingPrewarmTokenizer = embeddingProvider === 'onnx' && embeddingOnnx?.prewarmTokenizer === true;
  const embeddingPrewarmModel = embeddingProvider === 'onnx' && embeddingOnnx?.prewarmModel === true;
  const embeddingPrewarmTexts = Array.isArray(embeddingOnnx?.prewarmTexts)
    ? embeddingOnnx.prewarmTexts
    : [];
  const embeddingWarmModelPath = embeddingProvider === 'onnx'
    ? (embeddingOnnx?.resolvedModelPath || embeddingOnnx?.modelPath || 'none')
    : 'none';
  const embeddingWarmOnnxCacheDir = embeddingProvider === 'onnx'
    ? (embeddingOnnx?.cacheDir || 'default-cache')
    : 'none';
  const embeddingWarmOnnxThreads = embeddingProvider === 'onnx'
    ? `${embeddingOnnx?.intraOpNumThreads ?? 'd'}:${embeddingOnnx?.interOpNumThreads ?? 'd'}`
    : 'none';
  const embeddingWarmKey = [
    embeddingProvider || 'unknown',
    modelId || 'none',
    modelsDir || 'none',
    embeddingWarmModelPath,
    embeddingWarmOnnxCacheDir,
    embeddingWarmOnnxThreads,
    embeddingNormalize !== false ? 'normalize' : 'raw',
    embeddingPrewarmTokenizer ? 'tok' : 'no-tok',
    embeddingPrewarmModel ? 'model' : 'no-model',
    embeddingPrewarmTexts.join('|')
  ].join(':');
  const daemonEmbeddingWarmHit = daemonSession
    ? hasDaemonEmbeddingWarmKey(daemonSession, embeddingWarmKey)
    : false;
  if (
    daemonSession
    && daemonPrewarmEmbeddings
    && embeddingEnabled
    && useStubEmbeddings !== true
    && !daemonEmbeddingWarmHit
  ) {
    await timeInit('embedding prewarm', () => warmEmbeddingAdapter({
      rootDir: root,
      provider: embeddingProvider,
      onnxConfig: embeddingOnnx,
      normalize: embeddingNormalize,
      useStub: false,
      modelId,
      modelsDir
    }));
    addDaemonEmbeddingWarmKey(daemonSession, embeddingWarmKey);
  }
  const pythonAstRuntimeConfig = {
    ...pythonAstConfig,
    defaultMaxWorkers: Math.min(4, fileConcurrency),
    hardMaxWorkers: 8
  };
  const workerPoolConfig = resolveWorkerPoolRuntimeConfig({
    indexingConfig,
    envConfig,
    cpuConcurrency,
    fileConcurrency
  });
  const procConcurrencyCap = Number.isFinite(fileConcurrency)
    ? Math.max(
      Math.max(1, Math.floor(cpuConcurrency || 1)),
      Math.floor(fileConcurrency / 2)
    )
    : Math.max(1, Math.floor(cpuConcurrency || 1));
  const procConcurrency = workerPoolConfig?.enabled !== false && Number.isFinite(workerPoolConfig?.maxWorkers)
    ? Math.max(1, Math.min(procConcurrencyCap, Math.floor(workerPoolConfig.maxWorkers)))
    : null;
  const queueConfig = createRuntimeQueues({
    ioConcurrency,
    cpuConcurrency,
    fileConcurrency,
    embeddingConcurrency,
    pendingLimits: envelope.queues,
    scheduler,
    stage1Queues,
    procConcurrency,
    memoryPolicy: runtimeMemoryPolicy
  });
  const { queues } = queueConfig;

  const incrementalEnabled = argv.incremental === true;
  const incrementalBundlesConfig = indexingConfig.incrementalBundles || {};
  const incrementalBundleFormat = typeof incrementalBundlesConfig.format === 'string'
    ? normalizeBundleFormat(incrementalBundlesConfig.format)
    : null;
  const debugCrash = argv['debug-crash'] === true
    || envConfig.debugCrash === true
    || indexingConfig.debugCrash === true
    || isTestingEnv();

  const {
    dictConfig,
    dictionaryPaths,
    codeDictPaths,
    dictWords,
    codeDictCommonWords,
    codeDictWordsByLanguage,
    dictSummary,
    dictSignature,
    dictSharedPayload,
    dictShared,
    codeDictLanguages
  } = await resolveRuntimeDictionaries({
    root,
    userConfig,
    workerPoolConfig,
    daemonSession,
    log,
    logInit
  });
  const codeDictEnabled = codeDictLanguages.size > 0;
  const generatedPolicy = buildGeneratedIndexingPolicyConfig(indexingConfig);

  const {
    ignoreMatcher,
    config: ignoreConfig,
    ignoreFiles,
    warnings: ignoreWarnings
  } = await timeInit('ignore rules', () => buildIgnoreMatcher({ root, userConfig, generatedPolicy }));
  const cacheConfig = getCacheRuntimeConfig(root, userConfig);
  const verboseCache = envConfig.verbose === true;

  if (dictSummary.files) {
    log(`Wordlists enabled: ${dictSummary.files} file(s), ${dictSummary.words.toLocaleString()} words for identifier splitting.`);
  } else {
    log('Wordlists disabled: no dictionary files found; identifier splitting will be limited.');
  }
  if (codeDictEnabled && dictSummary.code?.files) {
    const langs = dictSummary.code.languages && dictSummary.code.languages.length
      ? ` (${dictSummary.code.languages.join(', ')})`
      : '';
    const bundleSuffix = dictSummary.code.bundleProfileVersion
      ? ` [bundle=${dictSummary.code.bundleProfileVersion}]`
      : '';
    log(
      `Code dictionaries enabled: ${dictSummary.code.files} file(s), `
      + `${dictSummary.code.words.toLocaleString()} words${langs}${bundleSuffix}.`
    );
  } else if (codeDictEnabled) {
    log('Code dictionaries enabled: no code dictionary files found for gated languages.');
  } else {
    log('Code dictionaries disabled: no gated languages configured.');
  }
  if (ignoreWarnings?.length) {
    for (const warning of ignoreWarnings) {
      const detail = warning?.detail ? ` (${warning.detail})` : '';
      const file = warning?.file ? ` ${warning.file}` : '';
      log(`[ignore] ${warning?.type || 'warning'}${file}${detail}`);
    }
  }
  logRuntimeFeatureStatus({
    log,
    stage,
    profileId: profile.id,
    hugeRepoProfileEnabled,
    autoPolicyProfileId: autoPolicyProfile.id,
    embeddingEnabled,
    embeddingService,
    baseEmbeddingsPlanned,
    useStubEmbeddings,
    modelId,
    embeddingProvider,
    embeddingBatchSize,
    embeddingConcurrency,
    incrementalEnabled,
    repoCacheRoot: path.join(repoCacheRoot, 'incremental'),
    ioConcurrency,
    cpuConcurrency,
    runtimeMemoryPolicy,
    astDataflowEnabled,
    controlFlowEnabled,
    pythonAstEnabled
  });
  await preloadTreeSitterWithDaemonCache({
    daemonSession,
    treeSitterEnabled,
    treeSitterLanguages,
    treeSitterPreload,
    treeSitterPreloadConcurrency,
    log,
    logInit
  });
  logRuntimePostTreeSitterFeatureStatus({
    log,
    typeInferenceEnabled,
    typeInferenceCrossFileEnabled,
    gitBlameEnabled,
    lintEnabled,
    complexityEnabled,
    riskAnalysisEnabled,
    riskAnalysisCrossFileEnabled,
    postingsConfig,
    lexiconConfig
  });

  const workerPoolsResult = await timeInit('worker pools', () => createRuntimeWorkerPools({
    workerPoolConfig,
    repoCacheRoot,
    dictWords,
    dictSharedPayload,
    dictConfig,
    codeDictWords: codeDictCommonWords,
    codeDictWordsByLanguage,
    codeDictLanguages,
    postingsConfig,
    treeSitterConfig: {
      enabled: treeSitterEnabled,
      languages: treeSitterLanguages,
      maxBytes: treeSitterMaxBytes,
      maxLines: treeSitterMaxLines,
      maxParseMs: treeSitterMaxParseMs,
      byLanguage: treeSitterByLanguage,
      deferMissing: treeSitterDeferMissing
    },
    debugCrash,
    log
  }));
  const { workerPools, workerPool, quantizePool } = workerPoolsResult;

  log('Build environment snapshot.', {
    event: 'build.env',
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuCount,
    memoryMb: Math.round(os.totalmem() / (1024 * 1024)),
    configHash,
    stage: stage || null,
    features: {
      embeddings: embeddingEnabled || embeddingService,
      treeSitter: treeSitterEnabled,
      relations: stage !== 'stage1',
      tooling: toolingEnabled,
      typeInference: typeInferenceEnabled,
      riskAnalysis: riskAnalysisEnabled
    }
  });

  const fileScan = buildFileScanConfig(indexingConfig);
  const shardConfig = buildShardConfig(indexingConfig);

  const languageOptions = {
    rootDir: root,
    astDataflowEnabled,
    controlFlowEnabled,
    skipUnknownLanguages,
    skipOnParseError,
    javascript: {
      parser: parserConfig.javascript,
      flow: flowConfig.javascript
    },
    typescript: {
      parser: parserConfig.typescript,
      importsOnly: typescriptImportsOnly
    },
    embeddingBatchMultipliers,
    chunking,
    tokenization: {
      fileStream: tokenizationFileStream
    },
    pythonAst: pythonAstRuntimeConfig,
    kotlin: {
      flowMaxBytes: kotlinFlowMaxBytes,
      flowMaxLines: kotlinFlowMaxLines,
      relationsMaxBytes: kotlinRelationsMaxBytes,
      relationsMaxLines: kotlinRelationsMaxLines
    },
    treeSitter: {
      enabled: treeSitterEnabled,
      languages: treeSitterLanguages,
      configChunking: treeSitterConfigChunking,
      maxBytes: treeSitterMaxBytes,
      maxLines: treeSitterMaxLines,
      maxParseMs: treeSitterMaxParseMs,
      byLanguage: treeSitterByLanguage,
      preload: treeSitterPreload,
      preloadConcurrency: treeSitterPreloadConcurrency,
      batchByLanguage: treeSitterBatchByLanguage,
      batchEmbeddedLanguages: treeSitterBatchEmbeddedLanguages,
      languagePasses: treeSitterLanguagePasses,
      deferMissing: treeSitterDeferMissing,
      deferMissingMax: treeSitterDeferMissingMax,
      cachePersistent: treeSitterCachePersistent,
      cachePersistentDir: resolvedTreeSitterCachePersistentDir,
      worker: treeSitterWorker,
      scheduler: treeSitterScheduler || { transport: 'disk', sharedCache: false }
    },
    resolveSqlDialect,
    yamlChunking: {
      mode: yamlChunkingMode,
      maxBytes: yamlTopLevelMaxBytes
    },
    lexicon: lexiconConfig,
    log
  };

  try {
    await fs.mkdir(buildRoot, { recursive: true });
  } catch {}
  logInit('runtime ready', initStartedAt);

  return {
    envelope,
    root,
    argv,
    rawArgv,
    userConfig,
    repoCacheRoot,
    platformRuntimePreset,
    startupCalibration,
    learnedAutoProfile,
    daemon: daemonSession
      ? {
        enabled: true,
        sessionKey: daemonSession.key,
        deterministic: daemonSession.deterministic !== false,
        jobContext: daemonJobContext,
        generation: daemonSession.generation || 1,
        generationJobsProcessed: daemonSession.generationJobsProcessed || 0,
        jobsProcessed: daemonSession.jobsProcessed,
        recycle: {
          count: daemonSession.recycleCount || 0,
          lastAt: daemonSession.lastRecycleAt || null,
          lastReasons: daemonSession.lastRecycleReasons || []
        },
        warmCaches: {
          dictionaries: daemonSession.dictCache?.size || 0,
          treeSitterPreload: daemonSession.treeSitterPreloadCache?.size || 0,
          embeddings: daemonSession.embeddingWarmKeys?.size || 0
        }
      }
      : {
        enabled: false,
        sessionKey: null,
        deterministic: true,
        jobContext: null,
        jobsProcessed: 0,
        warmCaches: {
          dictionaries: 0,
          treeSitterPreload: 0,
          embeddings: 0
        }
      },
    buildId,
    buildRoot,
    profile,
    indexOptimizationProfile,
    recordsDir: triageConfig.recordsDir,
    recordsConfig,
    currentIndexRoot,
    configHash,
    repoProvenance,
    scmConfig,
    scmProvider: scmSelection.provider,
    scmRepoRoot: scmSelection.repoRoot,
    scmProviderImpl: scmSelection.providerImpl,
    toolInfo: {
      tool: 'pairofcleats',
      version: toolVersion,
      configHash: contentConfigHash || null
    },
    autoPolicyProfile,
    hugeRepoProfileEnabled,
    toolingConfig,
    toolingEnabled,
    indexingConfig,
    postingsConfig,
    segmentsConfig,
    commentsConfig,
    astDataflowEnabled,
    controlFlowEnabled,
    typeInferenceEnabled,
    typeInferenceCrossFileEnabled,
    riskAnalysisEnabled,
    riskAnalysisCrossFileEnabled,
    riskInterproceduralConfig,
    riskInterproceduralEnabled,
    riskConfig,
    embeddingBatchSize,
    embeddingConcurrency,
    embeddingEnabled,
    embeddingMode: resolvedEmbeddingMode,
    embeddingService,
    embeddingProvider,
    embeddingOnnx,
    embeddingNormalize,
    embeddingQueue,
    embeddingIdentity,
    embeddingIdentityKey,
    embeddingCache,
    fileCaps,
    guardrails,
    fileScan,
    shards: shardConfig,
    twoStage: {
      enabled: twoStageEnabled,
      background: twoStageBackground,
      stage,
      queue: twoStageQueue
    },
    stage,
    gitBlameEnabled,
    lintEnabled,
    complexityEnabled,
    analysisPolicy,
    resolveSqlDialect,
    fileConcurrency,
    importConcurrency,
    ioConcurrency,
    cpuConcurrency,
    queues,
    scheduler,
    schedulerConfig,
    memoryPolicy: runtimeMemoryPolicy,
    telemetry,
    stage1Queues,
    subprocessOwnership: {
      stage1FilePrefix: stage1SubprocessOwnershipPrefix
    },
    procConcurrency,
    incrementalEnabled,
    incrementalBundleFormat,
    debugCrash,
    useStubEmbeddings,
    modelConfig,
    modelId,
    modelsDir,
    workerPoolConfig,
    workerPools,
    workerPool,
    quantizePool,
    dictConfig,
    dictionaryPaths,
    dictWords,
    dictShared,
    dictSummary,
    dictSignature,
    codeDictWords: codeDictCommonWords,
    codeDictWordsByLanguage,
    codeDictLanguages,
    codeDictionaryPaths: codeDictPaths,
    getChunkEmbedding,
    getChunkEmbeddings,
    languageOptions,
    generatedPolicy,
    ignoreMatcher,
    ignoreConfig,
    ignoreFiles,
    ignoreWarnings,
    maxFileBytes,
    cacheConfig,
    verboseCache,
    importGraphEnabled
  };
}
