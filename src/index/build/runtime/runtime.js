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
  getRepoCacheRoot,
  getToolVersion,
  getToolingConfig,
  getTriageConfig,
  loadUserConfig,
  resolveIndexRoot
} from '../../../../tools/dict-utils.js';
import { normalizeBundleFormat } from '../../../shared/bundle-io.js';
import { normalizeCommentConfig } from '../../comments.js';
import { normalizeSegmentsConfig } from '../../segments.js';
import { log } from '../../../shared/progress.js';
import { getEnvConfig, isTestingEnv } from '../../../shared/env.js';
import { buildAutoPolicy } from '../../../shared/auto-policy.js';
import { buildIgnoreMatcher } from '../ignore.js';
import { normalizePostingsConfig } from '../../../shared/postings-config.js';
import { createSharedDictionary, createSharedDictionaryView } from '../../../shared/dictionary.js';
import { normalizeEmbeddingBatchMultipliers } from '../embedding-batch.js';
import { mergeConfig } from '../../../shared/config.js';
import { sha1, setXxhashBackend } from '../../../shared/hash.js';
import { getRepoProvenance } from '../../git.js';
import { normalizeRiskConfig } from '../../risk.js';
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
import { buildFileScanConfig, buildShardConfig, formatBuildTimestamp } from './config.js';
import { resolveEmbeddingRuntime } from './embeddings.js';
import { resolveTreeSitterRuntime, preloadTreeSitterRuntimeLanguages } from './tree-sitter.js';
import {
  createRuntimeQueues,
  resolveWorkerPoolRuntimeConfig,
  createRuntimeWorkerPools
} from './workers.js';

/**
 * Create runtime configuration for build_index.
 * @param {{root:string,argv:object,rawArgv:string[]}} input
 * @returns {Promise<object>}
 */
export async function createBuildRuntime({ root, argv, rawArgv, policy }) {
  const userConfig = loadUserConfig(root);
  const envConfig = getEnvConfig();
  const importGraphEnabled = envConfig.importGraph == null ? true : envConfig.importGraph;
  const rawIndexingConfig = userConfig.indexing || {};
  let indexingConfig = rawIndexingConfig;
  const qualityOverride = typeof argv.quality === 'string' ? argv.quality.trim().toLowerCase() : '';
  const policyConfig = qualityOverride ? { ...userConfig, quality: qualityOverride } : userConfig;
  const autoPolicy = policy || await buildAutoPolicy({ repoRoot: root, config: policyConfig });
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
  const envelope = resolveRuntimeEnvelope({
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
  });
  const logFileRaw = typeof argv['log-file'] === 'string' ? argv['log-file'].trim() : '';
  const logFormatRaw = typeof argv['log-format'] === 'string' ? argv['log-format'].trim() : '';
  const logFormatOverride = logFormatRaw ? logFormatRaw.toLowerCase() : null;
  const logDestination = logFileRaw
    ? (path.isAbsolute(logFileRaw) ? logFileRaw : path.resolve(root, logFileRaw))
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
  const triageConfig = getTriageConfig(root, userConfig);
  const recordsConfig = normalizeRecordsConfig(userConfig.records || {});
  const currentIndexRoot = resolveIndexRoot(root, userConfig);
  const configHash = getEffectiveConfigHash(root, policyConfig);
  const contentConfigHash = buildContentConfigHash(policyConfig, envConfig);
  const repoProvenance = await getRepoProvenance(root);
  const toolVersion = getToolVersion();
  const gitShortSha = repoProvenance?.commit ? repoProvenance.commit.slice(0, 7) : 'nogit';
  const configHash8 = configHash ? configHash.slice(0, 8) : 'nohash';
  const buildId = `${formatBuildTimestamp(new Date())}_${gitShortSha}_${configHash8}`;
  const buildRoot = path.join(getBuildsRoot(root, userConfig), buildId);
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
  const typeInferenceCrossFileEnabled = indexingConfig.typeInferenceCrossFile === true;
  const riskAnalysisEnabled = indexingConfig.riskAnalysis !== false;
  const riskAnalysisCrossFileEnabled = riskAnalysisEnabled
    && indexingConfig.riskAnalysisCrossFile !== false;
  const riskConfig = normalizeRiskConfig({
    enabled: riskAnalysisEnabled,
    rules: indexingConfig.riskRules,
    caps: indexingConfig.riskCaps,
    regex: indexingConfig.riskRegex || indexingConfig.riskRules?.regex
  }, { rootDir: root });
  const gitBlameEnabled = indexingConfig.gitBlame !== false;
  const lintEnabled = indexingConfig.lint !== false;
  const complexityEnabled = indexingConfig.complexity !== false;
  const analysisPolicy = buildAnalysisPolicy({
    toolingEnabled,
    typeInferenceEnabled,
    typeInferenceCrossFileEnabled,
    riskAnalysisEnabled,
    riskAnalysisCrossFileEnabled,
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
  const chunking = {
    maxBytes: normalizeLimit(chunkingConfig.maxBytes, null),
    maxLines: normalizeLimit(chunkingConfig.maxLines, null)
  };
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
    treeSitterMaxLoadedLanguages,
    treeSitterBatchByLanguage,
    treeSitterBatchEmbeddedLanguages,
    treeSitterLanguagePasses,
    treeSitterDeferMissing,
    treeSitterDeferMissingMax,
    treeSitterWorker
  } = resolveTreeSitterRuntime(indexingConfig);
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

  const embeddingRuntime = await resolveEmbeddingRuntime({
    rootDir: root,
    userConfig,
    recordsDir: triageConfig.recordsDir,
    recordsConfig,
    indexingConfig,
    envConfig,
    argv,
    cpuConcurrency
  });
  const {
    embeddingBatchSize,
    embeddingConcurrency,
    embeddingEnabled,
    embeddingMode: resolvedEmbeddingMode,
    embeddingService,
    embeddingProvider,
    embeddingOnnx,
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
  const queueConfig = createRuntimeQueues({
    ioConcurrency,
    cpuConcurrency,
    fileConcurrency,
    embeddingConcurrency,
    pendingLimits: envelope.queues
  });
  const { queues } = queueConfig;
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

  const incrementalEnabled = argv.incremental === true;
  const incrementalBundlesConfig = indexingConfig.incrementalBundles || {};
  const incrementalBundleFormat = typeof incrementalBundlesConfig.format === 'string'
    ? normalizeBundleFormat(incrementalBundlesConfig.format)
    : null;
  const debugCrash = argv['debug-crash'] === true
    || envConfig.debugCrash === true
    || indexingConfig.debugCrash === true
    || isTestingEnv();

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

  const {
    ignoreMatcher,
    config: ignoreConfig,
    ignoreFiles,
    warnings: ignoreWarnings
  } = await buildIgnoreMatcher({ root, userConfig });
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
  if (!embeddingEnabled) {
    const label = embeddingService ? 'service queue' : 'disabled';
    log(`Embeddings: ${label}.`);
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
    await preloadTreeSitterRuntimeLanguages({
      treeSitterEnabled,
      treeSitterLanguages,
      treeSitterPreload,
      treeSitterPreloadConcurrency,
      treeSitterMaxLoadedLanguages,
      log
    });
  }
  if (typeInferenceEnabled) {
    log('Type inference metadata enabled via indexing.typeInference.');
  }
  if (typeInferenceCrossFileEnabled && !typeInferenceEnabled) {
    log('Cross-file type inference requested but indexing.typeInference is disabled.');
  }
  if (!gitBlameEnabled) {
    log('Git blame metadata disabled via indexing.gitBlame.');
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

  const workerPoolsResult = await createRuntimeWorkerPools({
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
      deferMissing: treeSitterDeferMissing,
      maxLoadedLanguages: treeSitterMaxLoadedLanguages
    },
    debugCrash,
    log
  });
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
      maxLoadedLanguages: treeSitterMaxLoadedLanguages,
      batchByLanguage: treeSitterBatchByLanguage,
      batchEmbeddedLanguages: treeSitterBatchEmbeddedLanguages,
      languagePasses: treeSitterLanguagePasses,
      deferMissing: treeSitterDeferMissing,
      deferMissingMax: treeSitterDeferMissingMax,
      worker: treeSitterWorker
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

  return {
    envelope,
    root,
    argv,
    rawArgv,
    userConfig,
    repoCacheRoot,
    buildId,
    buildRoot,
    recordsDir: triageConfig.recordsDir,
    recordsConfig,
    currentIndexRoot,
    configHash,
    repoProvenance,
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
    riskConfig,
    embeddingBatchSize,
    embeddingConcurrency,
    embeddingEnabled,
    embeddingMode: resolvedEmbeddingMode,
    embeddingService,
    embeddingProvider,
    embeddingOnnx,
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
