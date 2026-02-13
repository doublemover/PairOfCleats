import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getCacheRuntimeConfig,
  getCodeDictionaryPaths,
  getDictionaryPaths,
  getDictConfig,
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
import { buildAutoPolicy } from '../../../shared/auto-policy.js';
import { buildIgnoreMatcher } from '../ignore.js';
import { normalizePostingsConfig } from '../../../shared/postings-config.js';
import { createSharedDictionary, createSharedDictionaryView } from '../../../shared/dictionary.js';
import { normalizeEmbeddingBatchMultipliers } from '../embedding-batch.js';
import { mergeConfig } from '../../../shared/config.js';
import { sha1, setXxhashBackend } from '../../../shared/hash.js';
import { getScmProvider, getScmProviderAndRoot, resolveScmConfig } from '../../scm/registry.js';
import { setScmRuntimeConfig } from '../../scm/runtime.js';
import { normalizeRiskConfig } from '../../risk.js';
import { normalizeRiskInterproceduralConfig } from '../../risk-interprocedural/config.js';
import { normalizeRecordsConfig } from '../records.js';
import { DEFAULT_CODE_DICT_LANGUAGES, normalizeCodeDictLanguages } from '../../../shared/code-dictionaries.js';
import { resolveRuntimeEnvelope } from '../../../shared/runtime-envelope.js';
import { buildContentConfigHash } from './hash.js';
import { normalizeStage, buildStageOverrides } from './stage.js';
import { configureRuntimeLogger } from './logging.js';
import { normalizeLimit, resolveFileCapsAndGuardrails } from './caps.js';
import {
  normalizeParser,
  normalizeFlowSetting,
  normalizeDictSignaturePath
} from './normalize.js';
import { buildAnalysisPolicy } from './policy.js';
import { buildFileScanConfig, buildShardConfig, formatBuildNonce, formatBuildTimestamp } from './config.js';
import { resolveEmbeddingRuntime } from './embeddings.js';
import { createBuildScheduler } from '../../../shared/concurrency.js';
import { resolveSchedulerConfig } from './scheduler.js';
import { resolveTreeSitterRuntime, preloadTreeSitterRuntimeLanguages } from './tree-sitter.js';
import {
  createRuntimeQueues,
  resolveWorkerPoolRuntimeConfig,
  createRuntimeWorkerPools
} from './workers.js';
import {
  assertKnownIndexProfileId,
  buildIndexProfileState
} from '../../../contracts/index-profile.js';

const coercePositiveInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

const coerceFraction = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(1, parsed);
};

const resolveStage1Queues = (indexingConfig = {}) => {
  const stage1 = indexingConfig?.stage1 && typeof indexingConfig.stage1 === 'object'
    ? indexingConfig.stage1
    : {};
  const tokenize = stage1?.tokenize && typeof stage1.tokenize === 'object'
    ? stage1.tokenize
    : {};
  const postings = stage1?.postings && typeof stage1.postings === 'object'
    ? stage1.postings
    : {};

  const tokenizeConcurrency = coercePositiveInt(tokenize.concurrency);
  const tokenizeMaxPending = coercePositiveInt(tokenize.maxPending);

  const postingsMaxPending = coercePositiveInt(
    postings.maxPending ?? postings.concurrency
  );
  const postingsMaxPendingRows = coercePositiveInt(postings.maxPendingRows);
  const postingsMaxPendingBytes = coercePositiveInt(postings.maxPendingBytes);
  const postingsMaxHeapFraction = coerceFraction(postings.maxHeapFraction);

  return {
    tokenize: {
      concurrency: tokenizeConcurrency,
      maxPending: tokenizeMaxPending
    },
    postings: {
      maxPending: postingsMaxPending,
      maxPendingRows: postingsMaxPendingRows,
      maxPendingBytes: postingsMaxPendingBytes,
      maxHeapFraction: postingsMaxHeapFraction
    }
  };
};

/**
 * Create runtime configuration for build_index.
 * @param {{root:string,argv:object,rawArgv:string[]}} input
 * @returns {Promise<object>}
 */
export async function createBuildRuntime({ root, argv, rawArgv, policy, indexRoot: indexRootOverride = null } = {}) {
  const initStartedAt = Date.now();
  const logInit = (label, startedAt) => {
    const elapsed = Math.max(0, Date.now() - startedAt);
    log(`[init] ${label} (${elapsed}ms)`);
  };
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
  const profileId = assertKnownIndexProfileId(indexingConfig.profile);
  const profile = buildIndexProfileState(profileId);
  indexingConfig = {
    ...indexingConfig,
    profile: profile.id
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
    analysisPolicy: userConfig.analysisPolicy || null
  });
  setScmRuntimeConfig(scmConfig);
  const repoCacheRoot = getRepoCacheRoot(root, userConfig);
  const cacheRoot = (userConfig.cache && userConfig.cache.root) || getCacheRoot();
  const cacheRootSource = userConfig.cache?.root
    ? 'config'
    : (envConfig.cacheRoot ? 'env' : 'default');
  log(`[init] cache root (${cacheRootSource}): ${path.resolve(cacheRoot)}`);
  log(`[init] repo cache root: ${path.resolve(repoCacheRoot)}`);
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
  const schedulerConfig = resolveSchedulerConfig({
    argv,
    rawArgv,
    envConfig,
    indexingConfig,
    runtimeConfig: userConfig.runtime || null,
    envelope
  });
  const scheduler = createBuildScheduler({
    enabled: schedulerConfig.enabled,
    lowResourceMode: schedulerConfig.lowResourceMode,
    cpuTokens: schedulerConfig.cpuTokens,
    ioTokens: schedulerConfig.ioTokens,
    memoryTokens: schedulerConfig.memoryTokens,
    starvationMs: schedulerConfig.starvationMs,
    queues: schedulerConfig.queues
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
  const scmHeadShort = scmHeadId ? String(scmHeadId).slice(0, 7) : 'noscm';
  const configHash8 = configHash ? configHash.slice(0, 8) : 'nohash';
  const buildNonce = formatBuildNonce();
  const computedBuildIdBase = `${formatBuildTimestamp(new Date())}_${buildNonce}_${scmHeadShort}_${configHash8}`;
  const resolvedIndexRoot = indexRootOverride ? path.resolve(indexRootOverride) : null;
  const buildsRoot = getBuildsRoot(root, userConfig);
  let computedBuildId = computedBuildIdBase;
  let buildRoot = resolvedIndexRoot || path.join(buildsRoot, computedBuildId);
  if (!resolvedIndexRoot) {
    let suffix = 1;
    while (fsSync.existsSync(buildRoot)) {
      computedBuildId = `${computedBuildIdBase}_${suffix.toString(36)}`;
      buildRoot = path.join(buildsRoot, computedBuildId);
      suffix += 1;
    }
  }
  const buildId = resolvedIndexRoot ? path.basename(buildRoot) : computedBuildId;
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
  if (scmAnnotateEnabled && scmSelection.provider === 'none') {
    log('[scm] annotate disabled: provider=none.');
  }
  const gitBlameEnabled = effectiveScmAnnotateEnabled;
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
  const javascriptParser = normalizeParser(
    indexingConfig.javascriptParser,
    'babel',
    ['auto', 'babel', 'acorn', 'esprima']
  );
  const typescriptParser = normalizeParser(
    indexingConfig.typescriptParser,
    'auto',
    ['auto', 'typescript', 'babel', 'heuristic']
  );
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
  const javascriptFlow = normalizeFlowSetting(indexingConfig.javascriptFlow);
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
  const applyTreeSitterJsCaps = (caps, maxBytes) => {
    if (!caps || !Number.isFinite(maxBytes) || maxBytes <= 0) return false;
    const targets = ['.js', '.jsx', '.mjs', '.cjs', '.jsm'];
    let applied = false;
    for (const ext of targets) {
      const current = caps.byExt?.[ext] || {};
      if (current.maxBytes != null) continue;
      caps.byExt[ext] = { ...current, maxBytes };
      applied = true;
    }
    return applied;
  };
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
  const procConcurrency = workerPoolConfig?.enabled !== false && Number.isFinite(workerPoolConfig?.maxWorkers)
    ? Math.max(1, Math.min(cpuConcurrency, Math.floor(workerPoolConfig.maxWorkers)))
    : null;
  const queueConfig = createRuntimeQueues({
    ioConcurrency,
    cpuConcurrency,
    fileConcurrency,
    embeddingConcurrency,
    pendingLimits: envelope.queues,
    scheduler,
    stage1Queues,
    procConcurrency
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

  const dictStartedAt = Date.now();
  const dictConfig = getDictConfig(root, userConfig);
  const dictDir = dictConfig?.dir;
  const dictionaryPaths = await getDictionaryPaths(root, dictConfig);
  const dictWords = new Set();
  for (const dictFile of dictionaryPaths) {
    try {
      const contents = await fs.readFile(dictFile, 'utf8');
      for (const line of contents.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) dictWords.add(trimmed);
      }
    } catch {}
  }
  const codeDictLanguages = normalizeCodeDictLanguages(DEFAULT_CODE_DICT_LANGUAGES);
  const codeDictEnabled = codeDictLanguages.size > 0;
  const codeDictPaths = codeDictEnabled
    ? await getCodeDictionaryPaths(root, dictConfig, { languages: Array.from(codeDictLanguages) })
    : { baseDir: path.join(dictDir || '', 'code-dicts'), common: [], byLanguage: new Map(), all: [] };
  const codeDictCommonWords = new Set();
  const codeDictWordsByLanguage = new Map();
  const codeDictWordsAll = new Set();
  const addCodeWord = (target, word) => {
    if (!word) return;
    const normalized = word.toLowerCase();
    if (!normalized) return;
    target.add(normalized);
    codeDictWordsAll.add(normalized);
  };
  for (const dictFile of codeDictPaths.common) {
    try {
      const contents = await fs.readFile(dictFile, 'utf8');
      for (const line of contents.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) addCodeWord(codeDictCommonWords, trimmed);
      }
    } catch {}
  }
  for (const [lang, dictFiles] of codeDictPaths.byLanguage.entries()) {
    const words = new Set();
    for (const dictFile of dictFiles) {
      try {
        const contents = await fs.readFile(dictFile, 'utf8');
        for (const line of contents.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed) addCodeWord(words, trimmed);
        }
      } catch {}
    }
    if (words.size) {
      codeDictWordsByLanguage.set(lang, words);
    }
  }
  const dictSignatureParts = [];
  for (const dictFile of dictionaryPaths) {
    const signaturePath = normalizeDictSignaturePath({ dictFile, dictDir, repoRoot: root });
    try {
      const stat = await fs.stat(dictFile);
      dictSignatureParts.push(`${signaturePath}:${stat.size}:${stat.mtimeMs}`);
    } catch {
      dictSignatureParts.push(`${signaturePath}:missing`);
    }
  }
  for (const dictFile of codeDictPaths.all) {
    const signaturePath = normalizeDictSignaturePath({ dictFile, dictDir, repoRoot: root });
    try {
      const stat = await fs.stat(dictFile);
      dictSignatureParts.push(`code:${signaturePath}:${stat.size}:${stat.mtimeMs}`);
    } catch {
      dictSignatureParts.push(`code:${signaturePath}:missing`);
    }
  }
  dictSignatureParts.sort();
  const dictSignature = dictSignatureParts.length
    ? sha1(dictSignatureParts.join('|'))
    : null;
  const dictSummary = {
    files: dictionaryPaths.length,
    words: dictWords.size,
    code: {
      files: codeDictPaths.all.length,
      words: codeDictWordsAll.size,
      languages: Array.from(codeDictWordsByLanguage.keys()).sort()
    }
  };
  const LARGE_DICT_SHARED_THRESHOLD = 200000;
  const shouldShareDict = dictSummary.words
    && (workerPoolConfig.enabled !== false || dictSummary.words >= LARGE_DICT_SHARED_THRESHOLD);
  const dictSharedPayload = shouldShareDict ? createSharedDictionary(dictWords) : null;
  const dictShared = dictSharedPayload ? createSharedDictionaryView(dictSharedPayload) : null;
  logInit('dictionaries', dictStartedAt);

  const {
    ignoreMatcher,
    config: ignoreConfig,
    ignoreFiles,
    warnings: ignoreWarnings
  } = await timeInit('ignore rules', () => buildIgnoreMatcher({ root, userConfig }));
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
    log(`Code dictionaries enabled: ${dictSummary.code.files} file(s), ${dictSummary.code.words.toLocaleString()} words${langs}.`);
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
  if (stage === 'stage1') {
    log('Two-stage indexing: stage1 (sparse) overrides enabled.');
  } else if (stage === 'stage2') {
    log('Two-stage indexing: stage2 (enrichment) running.');
  } else if (stage === 'stage3') {
    log('Indexing stage3 (embeddings pass) running.');
  } else if (stage === 'stage4') {
    log('Indexing stage4 (sqlite/ann pass) running.');
  }
  log(`Index profile: ${profile.id}.`);
  if (!embeddingEnabled) {
    const label = embeddingService ? 'service queue' : 'disabled';
    const deferred = baseEmbeddingsPlanned && (stage === 'stage1' || stage === 'stage2');
    if (deferred) {
      const stageLabel = stage === 'stage1' ? 'stage1' : 'stage2';
      log(`Embeddings: deferred to stage3 (${stageLabel}).`);
    } else {
      log(`Embeddings: ${label}.`);
    }
  } else if (useStubEmbeddings) {
    log('Embeddings: stub mode enabled (no model downloads).');
  } else {
    const providerLabel = embeddingProvider === 'onnx' ? 'onnxruntime' : 'xenova';
    log(`Embeddings: model ${modelId} (${providerLabel}).`);
  }
  if (embeddingEnabled) {
    log(`Embedding batch size: ${embeddingBatchSize}`);
    log(`Embedding concurrency: ${embeddingConcurrency}`);
  }
  if (incrementalEnabled) {
    log(`Incremental cache enabled (root: ${path.join(repoCacheRoot, 'incremental')}).`);
  }
  log(`Queue concurrency: io=${ioConcurrency}, cpu=${cpuConcurrency}.`);
  if (!astDataflowEnabled) {
    log('AST dataflow metadata disabled via indexing.astDataflow.');
  }
  if (!controlFlowEnabled) {
    log('Control-flow metadata disabled via indexing.controlFlow.');
  }
  if (!pythonAstEnabled) {
    log('Python AST metadata disabled via indexing.pythonAst.enabled.');
  }
  if (!treeSitterEnabled) {
    log('Tree-sitter chunking disabled via indexing.treeSitter.enabled.');
  } else {
    const preloadStart = Date.now();
    const preloadCount = await preloadTreeSitterRuntimeLanguages({
      treeSitterEnabled,
      treeSitterLanguages,
      treeSitterPreload,
      treeSitterPreloadConcurrency,
      observedLanguages: null,
      log
    });
    if (preloadCount > 0) {
      logInit('tree-sitter preload', preloadStart);
    }
  }
  if (typeInferenceEnabled) {
    log('Type inference metadata enabled via indexing.typeInference.');
  }
  if (typeInferenceCrossFileEnabled && !typeInferenceEnabled) {
    log('Cross-file type inference requested but indexing.typeInference is disabled.');
  }
  if (!gitBlameEnabled) {
    log('SCM annotate metadata disabled via indexing.scm.annotate.enabled.');
  }
  if (!lintEnabled) {
    log('Lint metadata disabled via indexing.lint.');
  }
  if (!complexityEnabled) {
    log('Complexity metadata disabled via indexing.complexity.');
  }
  if (!riskAnalysisEnabled) {
    log('Risk analysis disabled via indexing.riskAnalysis.');
  }
  if (!riskAnalysisCrossFileEnabled && riskAnalysisEnabled) {
    log('Cross-file risk correlation disabled via indexing.riskAnalysisCrossFile.');
  }
  if (postingsConfig.enablePhraseNgrams === false) {
    log('Phrase n-gram postings disabled via indexing.postings.enablePhraseNgrams.');
  }
  if (postingsConfig.enableChargrams === false) {
    log('Chargram postings disabled via indexing.postings.enableChargrams.');
  }

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
      parser: javascriptParser,
      flow: javascriptFlow
    },
    typescript: {
      parser: typescriptParser,
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
    buildId,
    buildRoot,
    profile,
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
    stage1Queues,
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
