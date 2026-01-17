import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getCacheRuntimeConfig,
  getDictionaryPaths,
  getDictConfig,
  getEffectiveConfigHash,
  getBuildsRoot,
  getRepoCacheRoot,
  getToolVersion,
  getToolingConfig,
  loadUserConfig,
  resolveIndexRoot
} from '../../../../tools/dict-utils.js';
import { normalizeBundleFormat } from '../../../shared/bundle-io.js';
import { normalizeCommentConfig } from '../../comments.js';
import { normalizeSegmentsConfig } from '../../segments.js';
import { log } from '../../../shared/progress.js';
import { getEnvConfig } from '../../../shared/env.js';
import { buildIgnoreMatcher } from '../ignore.js';
import { normalizePostingsConfig } from '../../../shared/postings-config.js';
import { createSharedDictionary, createSharedDictionaryView } from '../../../shared/dictionary.js';
import { normalizeEmbeddingBatchMultipliers } from '../embedding-batch.js';
import { mergeConfig } from '../../../shared/config.js';
import { sha1, setXxhashBackend } from '../../../shared/hash.js';
import { getRepoProvenance } from '../../git.js';
import { normalizeRiskConfig } from '../../risk.js';
import { buildContentConfigHash } from './hash.js';
import { normalizeStage, buildStageOverrides } from './stage.js';
import { configureRuntimeLogger } from './logging.js';
import { normalizeLimit, normalizeRatio, normalizeDepth, resolveFileCapsAndGuardrails } from './caps.js';
import { resolveEmbeddingRuntime } from './embeddings.js';
import { resolveTreeSitterRuntime, preloadTreeSitterRuntimeLanguages } from './tree-sitter.js';
import {
  resolveThreadLimitsConfig,
  createRuntimeQueues,
  resolveWorkerPoolRuntimeConfig,
  createRuntimeWorkerPools
} from './workers.js';

const formatBuildTimestamp = (date) => (
  date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '')
);

/**
 * Create runtime configuration for build_index.
 * @param {{root:string,argv:object,rawArgv:string[]}} input
 * @returns {Promise<object>}
 */
export async function createBuildRuntime({ root, argv, rawArgv }) {
  const userConfig = loadUserConfig(root);
  const envConfig = getEnvConfig();
  const rawIndexingConfig = userConfig.indexing || {};
  let indexingConfig = rawIndexingConfig;
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
  const currentIndexRoot = resolveIndexRoot(root, userConfig);
  const configHash = getEffectiveConfigHash(root, userConfig);
  const contentConfigHash = buildContentConfigHash(userConfig, envConfig);
  const repoProvenance = await getRepoProvenance(root);
  const toolVersion = getToolVersion();
  const gitShortSha = repoProvenance?.commit ? repoProvenance.commit.slice(0, 7) : 'nogit';
  const configHash8 = configHash ? configHash.slice(0, 8) : 'nohash';
  const buildId = `${formatBuildTimestamp(new Date())}_${gitShortSha}_${configHash8}`;
  const buildRoot = path.join(getBuildsRoot(root, userConfig), buildId);
  const loggingConfig = userConfig.logging || {};
  configureRuntimeLogger({ envConfig, loggingConfig, buildId, configHash, stage, root });
  const toolingConfig = getToolingConfig(root, userConfig);
  const toolingEnabled = toolingConfig.autoEnableOnDetect !== false;
  const postingsConfig = normalizePostingsConfig(indexingConfig.postings || {});
  const { maxFileBytes, fileCaps, guardrails } = resolveFileCapsAndGuardrails(indexingConfig);
  const astDataflowEnabled = indexingConfig.astDataflow !== false;
  const controlFlowEnabled = indexingConfig.controlFlow !== false;
  const typeInferenceEnabled = indexingConfig.typeInference === true;
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
  const yamlChunkingModeRaw = typeof indexingConfig.yamlChunking === 'string'
    ? indexingConfig.yamlChunking.trim().toLowerCase()
    : '';
  const yamlChunkingMode = ['auto', 'root', 'top-level'].includes(yamlChunkingModeRaw)
    ? yamlChunkingModeRaw
    : 'root';
  const yamlTopLevelMaxBytesRaw = Number(indexingConfig.yamlTopLevelMaxBytes);
  const yamlTopLevelMaxBytes = Number.isFinite(yamlTopLevelMaxBytesRaw)
    ? Math.max(0, Math.floor(yamlTopLevelMaxBytesRaw))
    : 200 * 1024;
  const kotlinConfig = indexingConfig.kotlin || {};
  const kotlinFlowMaxBytes = normalizeLimit(kotlinConfig.flowMaxBytes, 200 * 1024);
  const kotlinFlowMaxLines = normalizeLimit(kotlinConfig.flowMaxLines, 3000);
  const kotlinRelationsMaxBytes = normalizeLimit(kotlinConfig.relationsMaxBytes, 200 * 1024);
  const kotlinRelationsMaxLines = normalizeLimit(kotlinConfig.relationsMaxLines, 2000);
  const normalizeParser = (raw, fallback, allowed) => {
    const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return allowed.includes(normalized) ? normalized : fallback;
  };
  const normalizeFlow = (raw) => {
    if (raw === true) return 'on';
    if (raw === false) return 'off';
    const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return ['auto', 'on', 'off'].includes(normalized) ? normalized : 'auto';
  };
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
  const javascriptFlow = normalizeFlow(indexingConfig.javascriptFlow);
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

  const threadLimits = resolveThreadLimitsConfig({ argv, rawArgv, envConfig, indexingConfig, log });
  const {
    cpuCount,
    maxConcurrencyCap,
    fileConcurrency,
    importConcurrency,
    ioConcurrency,
    cpuConcurrency
  } = threadLimits;

  const embeddingRuntime = await resolveEmbeddingRuntime({
    rootDir: root,
    userConfig,
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
    embeddingConcurrency
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
    || indexingConfig.debugCrash === true;

  const dictConfig = getDictConfig(root, userConfig);
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
  const dictSignatureParts = [];
  for (const dictFile of dictionaryPaths) {
    try {
      const stat = await fs.stat(dictFile);
      dictSignatureParts.push(`${dictFile}:${stat.size}:${stat.mtimeMs}`);
    } catch {
      dictSignatureParts.push(`${dictFile}:missing`);
    }
  }
  dictSignatureParts.sort();
  const dictSignature = dictSignatureParts.length
    ? sha1(dictSignatureParts.join('|'))
    : null;
  const dictSummary = { files: dictionaryPaths.length, words: dictWords.size };
  const LARGE_DICT_SHARED_THRESHOLD = 200000;
  const shouldShareDict = dictSummary.words
    && (workerPoolConfig.enabled !== false || dictSummary.words >= LARGE_DICT_SHARED_THRESHOLD);
  const dictSharedPayload = shouldShareDict ? createSharedDictionary(dictWords) : null;
  const dictShared = dictSharedPayload ? createSharedDictionaryView(dictSharedPayload) : null;

  const { ignoreMatcher, config: ignoreConfig, ignoreFiles } = await buildIgnoreMatcher({ root, userConfig });
  const cacheConfig = getCacheRuntimeConfig(root, userConfig);
  const verboseCache = envConfig.verbose === true;

  if (dictSummary.files) {
    log(`Wordlists enabled: ${dictSummary.files} file(s), ${dictSummary.words.toLocaleString()} words for identifier splitting.`);
  } else {
    log('Wordlists disabled: no dictionary files found; identifier splitting will be limited.');
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
    postingsConfig,
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

  const fileScanConfig = indexingConfig.fileScan || {};
  const minifiedScanConfig = fileScanConfig.minified || {};
  const binaryScanConfig = fileScanConfig.binary || {};
  const fileScan = {
    sampleBytes: normalizeLimit(fileScanConfig.sampleBytes, 8192),
    minified: {
      sampleMinBytes: normalizeLimit(minifiedScanConfig.sampleMinBytes, 4096),
      minChars: normalizeLimit(minifiedScanConfig.minChars, 1024),
      singleLineChars: normalizeLimit(minifiedScanConfig.singleLineChars, 4096),
      avgLineThreshold: normalizeLimit(minifiedScanConfig.avgLineThreshold, 300),
      maxLineThreshold: normalizeLimit(minifiedScanConfig.maxLineThreshold, 600),
      maxWhitespaceRatio: normalizeRatio(minifiedScanConfig.maxWhitespaceRatio, 0.2)
    },
    binary: {
      sampleMinBytes: normalizeLimit(binaryScanConfig.sampleMinBytes, 65536),
      maxNonTextRatio: normalizeRatio(binaryScanConfig.maxNonTextRatio, 0.3)
    }
  };
  const shardsConfig = indexingConfig.shards || {};
  const shardsEnabled = shardsConfig.enabled === true;
  const shardsMaxWorkers = normalizeLimit(shardsConfig.maxWorkers, null);
  const shardsMaxShards = normalizeLimit(shardsConfig.maxShards, null);
  const shardsMinFiles = normalizeLimit(shardsConfig.minFiles, null);
  const shardsDirDepth = normalizeDepth(shardsConfig.dirDepth, 0);
  const shardsMaxShardBytes = normalizeLimit(
    shardsConfig.maxShardBytes,
    64 * 1024 * 1024
  );
  const shardsMaxShardLines = normalizeLimit(shardsConfig.maxShardLines, 200000);

  const languageOptions = {
    rootDir: root,
    astDataflowEnabled,
    controlFlowEnabled,
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
    root,
    argv,
    rawArgv,
    userConfig,
    repoCacheRoot,
    buildId,
    buildRoot,
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
    embeddingCache,
    fileCaps,
    guardrails,
    fileScan,
    shards: {
      enabled: shardsEnabled,
      maxWorkers: shardsMaxWorkers,
      maxShards: shardsMaxShards,
      minFiles: shardsMinFiles,
      dirDepth: shardsDirDepth,
      maxShardBytes: shardsMaxShardBytes,
      maxShardLines: shardsMaxShardLines
    },
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
    getChunkEmbedding,
    getChunkEmbeddings,
    languageOptions,
    ignoreMatcher,
    ignoreConfig,
    ignoreFiles,
    maxFileBytes,
    cacheConfig,
    verboseCache
  };
}
