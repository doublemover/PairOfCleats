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
import { log } from '../../../shared/progress.js';
import { getEnvConfig, isTestingEnv } from '../../../shared/env.js';
import { isAbsolutePathNative } from '../../../shared/files.js';
import { resolveCacheFilesystemProfile } from '../../../shared/cache-roots.js';
import { buildAutoPolicy } from '../../../shared/auto-policy.js';
import { normalizePostingsConfig } from '../../../shared/postings-config.js';
import { mergeConfig } from '../../../shared/config.js';
import { setXxhashBackend } from '../../../shared/hash.js';
import { resolveScmConfig } from '../../scm/registry.js';
import { setScmRuntimeConfig } from '../../scm/runtime.js';
import { normalizeRecordsConfig } from '../records.js';
import { buildContentConfigHash } from './hash.js';
import { normalizeStage, buildStageOverrides } from './stage.js';
import {
  configureRuntimeLogger,
  logRuntimeFeatureStatus,
  logRuntimePostTreeSitterFeatureStatus
} from './logging.js';
import { applyTreeSitterJsCaps, resolveFileCapsAndGuardrails } from './caps.js';
import {
  applyAutoPolicyIndexingConfig,
  buildAnalysisPolicy,
  buildLexiconConfig,
  resolveBaseEmbeddingPlan
} from './policy.js';
import {
  buildFileScanConfig,
  buildGeneratedIndexingPolicyConfig,
  buildShardConfig,
  resolveRuntimeBuildRoot
} from './config.js';
import { resolveEmbeddingRuntime } from './embeddings.js';
import { resolveTreeSitterRuntime } from './tree-sitter.js';
import {
  createRuntimeDaemonJobContext
} from './daemon-session.js';
import { resolveLearnedAutoProfileSelection } from './learned-auto-profile.js';
import {
  createRuntimeWorkerPools
} from './workers.js';
import {
  buildStage1SubprocessOwnershipPrefix,
  createRuntimeTelemetry
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
import { preloadTreeSitterWithDaemonCache } from './tree-sitter-preload.js';
import { createRuntimeInitTracer, startRuntimeEnvelopeInitialization } from './bootstrap.js';
import {
  createRuntimeSchedulerSetup,
  prefetchSchedulerAutoTuneProfile,
  resolveRuntimeConcurrency,
  resolveRuntimeQueueSetup
} from './queue-bootstrap.js';
import {
  buildRuntimeDaemonState,
  prewarmRuntimeDaemonEmbeddings,
  resolveRuntimeDaemonSession
} from './runtime-daemon-init.js';
import {
  configureScmRuntimeConcurrency,
  logRuntimeScmPolicy,
  resolveRuntimeScmAnnotatePolicy,
  resolveRuntimeScmSelection
} from './runtime-scm-init.js';
import { resolveRuntimeDictionaryIgnoreState } from './runtime-dictionary-ignore-init.js';
import {
  createRuntimeSqlDialectResolver,
  resolveRuntimeLanguageInitConfig
} from './runtime-language-init.js';
import { resolveRuntimeAnalysisConfig } from './runtime-analysis-init.js';

export {
  applyLearnedAutoProfileSelection,
  normalizeIndexOptimizationProfile,
  resolvePlatformRuntimePreset,
  runStartupCalibrationProbe
};

/**
 * Create runtime configuration for build_index.
 * @param {{root:string,argv:object,rawArgv:string[]}} input
 * @returns {Promise<object>}
 */
export async function createBuildRuntime({ root, argv, rawArgv, policy, indexRoot: indexRootOverride = null } = {}) {
  const initStartedAt = Date.now();
  const { logInit, timeInit } = createRuntimeInitTracer({ log });

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
  const autoPolicyResolution = applyAutoPolicyIndexingConfig({
    indexingConfig,
    autoPolicy
  });
  indexingConfig = autoPolicyResolution.indexingConfig;
  const autoPolicyProfile = autoPolicyResolution.autoPolicyProfile;
  const hugeRepoProfileEnabled = autoPolicyResolution.hugeRepoProfileEnabled;
  const { baseEmbeddingsPlanned } = resolveBaseEmbeddingPlan(indexingConfig);
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
  const systemCpuCount = os.cpus().length;
  const repoCacheRoot = getRepoCacheRoot(root, userConfig);
  const cacheRootCandidate = (userConfig.cache && userConfig.cache.root) || getCacheRoot();
  const filesystemProfile = resolveCacheFilesystemProfile(cacheRootCandidate, process.platform);
  const platformRuntimePreset = resolvePlatformRuntimePreset({
    platform: process.platform,
    filesystemProfile,
    cpuCount: systemCpuCount,
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
  const toolVersion = getToolVersion();
  const runtimeEnvelopeInit = startRuntimeEnvelopeInitialization({
    argv,
    rawArgv,
    userConfig,
    autoPolicy,
    env: process.env,
    execArgv: process.execArgv,
    cpuCount: systemCpuCount,
    processInfo: {
      pid: process.pid,
      argv: process.argv,
      execPath: process.execPath,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCount: systemCpuCount
    },
    toolVersion
  });
  const schedulerAutoTuneProfilePromise = prefetchSchedulerAutoTuneProfile({
    repoCacheRoot,
    log
  });
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
  const { daemonConfig, daemonSession } = resolveRuntimeDaemonSession({
    argv,
    envConfig,
    indexingConfig,
    profileId: profile.id,
    cacheRoot,
    root,
    log
  });
  const envelope = await runtimeEnvelopeInit.promise;
  logInit('runtime envelope', runtimeEnvelopeInit.startedAt);
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
  const {
    schedulerConfig,
    scheduler,
    stage1Queues
  } = await createRuntimeSchedulerSetup({
    argv,
    rawArgv,
    envConfig,
    indexingConfig,
    runtimeConfig: userConfig.runtime || null,
    envelope,
    repoCacheRoot,
    log,
    schedulerAutoTuneProfilePromise
  });
  const triageConfig = getTriageConfig(root, userConfig);
  const recordsConfig = normalizeRecordsConfig(userConfig.records || {});
  const currentIndexRoot = resolveIndexRoot(root, userConfig);
  const configHash = getEffectiveConfigHash(root, policyConfig);
  const contentConfigHash = buildContentConfigHash(policyConfig, envConfig);
  const {
    scmSelection,
    repoProvenance,
    scmHeadId
  } = await resolveRuntimeScmSelection({
    argv,
    root,
    scmConfig,
    log,
    timeInit
  });
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
  const {
    astDataflowEnabled,
    controlFlowEnabled,
    typeInferenceEnabled,
    typeInferenceCrossFileEnabled,
    riskAnalysisEnabled,
    riskAnalysisCrossFileEnabled,
    riskConfig,
    riskInterproceduralConfig,
    riskInterproceduralEnabled
  } = resolveRuntimeAnalysisConfig({
    indexingConfig,
    rootDir: root
  });
  const scmAnnotatePolicy = resolveRuntimeScmAnnotatePolicy({
    scmConfig,
    scmProvider: scmSelection.provider,
    log
  });
  const gitBlameEnabled = scmAnnotatePolicy.gitBlameEnabled;
  logRuntimeScmPolicy({
    log,
    scmProvider: scmSelection.provider,
    benchRun: envConfig.benchRun === true,
    scmTimeoutMs: scmAnnotatePolicy.scmTimeoutMs,
    scmAnnotateTimeoutMs: scmAnnotatePolicy.scmAnnotateTimeoutMs,
    scmAnnotateTimeoutLadder: scmAnnotatePolicy.scmAnnotateTimeoutLadder,
    gitBlameEnabled
  });
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
  const {
    parserConfig,
    flowConfig,
    typescriptImportsOnly,
    embeddingBatchMultipliers,
    pythonAstConfig,
    segmentsConfig,
    commentsConfig,
    tokenizationFileStream,
    chunking,
    yamlChunkingMode,
    yamlTopLevelMaxBytes,
    kotlinFlowMaxBytes,
    kotlinFlowMaxLines,
    kotlinRelationsMaxBytes,
    kotlinRelationsMaxLines
  } = resolveRuntimeLanguageInitConfig(indexingConfig);
  const pythonAstEnabled = pythonAstConfig.enabled !== false;
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
  const resolveSqlDialect = createRuntimeSqlDialectResolver(userConfig.sql || {});
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
  } = resolveRuntimeConcurrency(envelope);
  configureScmRuntimeConcurrency({
    scmConfig,
    scmHeadId,
    repoProvenance,
    cpuCount,
    maxConcurrencyCap,
    fileConcurrency,
    ioConcurrency,
    cpuConcurrency
  });

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
  await prewarmRuntimeDaemonEmbeddings({
    daemonSession,
    daemonConfig,
    embeddingEnabled,
    useStubEmbeddings,
    embeddingProvider,
    modelId,
    modelsDir,
    embeddingNormalize,
    embeddingOnnx,
    root,
    timeInit
  });
  const pythonAstRuntimeConfig = {
    ...pythonAstConfig,
    defaultMaxWorkers: Math.min(4, fileConcurrency),
    hardMaxWorkers: 8
  };
  const runtimeQueueSetup = resolveRuntimeQueueSetup({
    indexingConfig,
    envConfig,
    envelope,
    scheduler,
    stage1Queues,
    embeddingConcurrency
  });
  indexingConfig = runtimeQueueSetup.indexingConfig;
  const runtimeMemoryPolicy = runtimeQueueSetup.runtimeMemoryPolicy;
  const workerPoolConfig = runtimeQueueSetup.workerPoolConfig;
  const procConcurrency = runtimeQueueSetup.procConcurrency;
  const { queues } = runtimeQueueSetup;

  const incrementalEnabled = argv.incremental === true;
  const incrementalBundlesConfig = indexingConfig.incrementalBundles || {};
  const incrementalBundleFormat = typeof incrementalBundlesConfig.format === 'string'
    ? normalizeBundleFormat(incrementalBundlesConfig.format)
    : null;
  const debugCrash = argv['debug-crash'] === true
    || envConfig.debugCrash === true
    || indexingConfig.debugCrash === true
    || isTestingEnv();

  const generatedPolicy = buildGeneratedIndexingPolicyConfig(indexingConfig);
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
    codeDictLanguages,
    ignoreMatcher,
    ignoreConfig,
    ignoreFiles,
    ignoreWarnings
  } = await resolveRuntimeDictionaryIgnoreState({
    root,
    userConfig,
    generatedPolicy,
    workerPoolConfig,
    daemonSession,
    log,
    logInit
  });
  const codeDictEnabled = codeDictLanguages.size > 0;
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
    daemon: buildRuntimeDaemonState({
      daemonSession,
      daemonJobContext
    }),
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
