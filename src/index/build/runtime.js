import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_MODEL_ID,
  getCacheRuntimeConfig,
  getDictionaryPaths,
  getDictConfig,
  getModelConfig,
  getRepoCacheRoot,
  getToolingConfig,
  loadUserConfig
} from '../../../tools/dict-utils.js';
import { createEmbedder } from '../embedding.js';
import { log } from '../../shared/progress.js';
import { createTaskQueues } from '../../shared/concurrency.js';
import { buildIgnoreMatcher } from './ignore.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';
import { applyBenchmarkProfile } from '../../shared/bench-profile.js';
import { createIndexerWorkerPool, normalizeWorkerPoolConfig } from './worker-pool.js';
import { createCrashLogger } from './crash-log.js';
import { preloadTreeSitterLanguages, resolveEnabledTreeSitterLanguages } from '../../lang/tree-sitter.js';
import { sha1 } from '../../shared/hash.js';

const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const mergeConfig = (base, overrides) => {
  if (!isPlainObject(base)) return overrides;
  if (!isPlainObject(overrides)) return base;
  const next = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (isPlainObject(value) && isPlainObject(next[key])) {
      next[key] = mergeConfig(next[key], value);
    } else {
      next[key] = value;
    }
  }
  return next;
};

const normalizeStage = (raw) => {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!value) return null;
  if (value === '1' || value === 'stage1' || value === 'sparse') return 'stage1';
  if (value === '2' || value === 'stage2' || value === 'enrich' || value === 'full') return 'stage2';
  return null;
};

const buildStageOverrides = (twoStageConfig, stage) => {
  if (stage !== 'stage1' && stage !== 'stage2') return null;
  if (!isPlainObject(twoStageConfig)) return null;
  const defaults = stage === 'stage1'
    ? {
      embeddings: { enabled: false, mode: 'off' },
      treeSitter: { enabled: false },
      lint: false,
      complexity: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false,
      typeInference: false,
      typeInferenceCrossFile: false
    }
    : {};
  const stageOverrides = stage === 'stage1'
    ? (isPlainObject(twoStageConfig.stage1) ? twoStageConfig.stage1 : {})
    : (isPlainObject(twoStageConfig.stage2) ? twoStageConfig.stage2 : {});
  return mergeConfig(defaults, stageOverrides);
};

/**
 * Create runtime configuration for build_index.
 * @param {{root:string,argv:object,rawArgv:string[]}} input
 * @returns {Promise<object>}
 */
export async function createBuildRuntime({ root, argv, rawArgv }) {
  const userConfig = loadUserConfig(root);
  const rawIndexingConfig = userConfig.indexing || {};
  let { indexingConfig, profile: benchmarkProfile } = applyBenchmarkProfile(
    rawIndexingConfig,
    process.env.PAIROFCLEATS_BENCH_PROFILE
  );
  const stage = normalizeStage(argv.stage || process.env.PAIROFCLEATS_STAGE);
  const twoStageConfig = indexingConfig.twoStage || {};
  const stageOverrides = buildStageOverrides(twoStageConfig, stage);
  if (stageOverrides) {
    indexingConfig = mergeConfig(indexingConfig, stageOverrides);
  }
  const repoCacheRoot = getRepoCacheRoot(root, userConfig);
  const toolingConfig = getToolingConfig(root, userConfig);
  const toolingEnabled = toolingConfig.autoEnableOnDetect !== false;
  const postingsConfig = normalizePostingsConfig(indexingConfig.postings || {});
  const maxFileBytesRaw = indexingConfig.maxFileBytes;
  const maxFileBytesParsed = Number(maxFileBytesRaw);
  let maxFileBytes = null;
  if (maxFileBytesRaw === false || maxFileBytesRaw === 0) {
    maxFileBytes = null;
  } else if (Number.isFinite(maxFileBytesParsed) && maxFileBytesParsed > 0) {
    maxFileBytes = maxFileBytesParsed;
  } else {
    maxFileBytes = 5 * 1024 * 1024;
  }
  const astDataflowEnabled = indexingConfig.astDataflow !== false;
  const controlFlowEnabled = indexingConfig.controlFlow !== false;
  const typeInferenceEnabled = indexingConfig.typeInference === true;
  const typeInferenceCrossFileEnabled = indexingConfig.typeInferenceCrossFile === true;
  const riskAnalysisEnabled = indexingConfig.riskAnalysis !== false;
  const riskAnalysisCrossFileEnabled = riskAnalysisEnabled
    && indexingConfig.riskAnalysisCrossFile !== false;
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
  const normalizeLimit = (value, fallback) => {
    if (value === 0 || value === false) return null;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
    return fallback;
  };
  const normalizeDepth = (value, fallback) => {
    if (value === 0) return 0;
    if (value === false) return null;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
    return fallback;
  };
  const normalizeRatio = (value, fallback) => {
    if (value === undefined || value === null || value === false) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(1, Math.max(0, parsed));
  };
  const normalizeCapValue = (value) => {
    if (value === 0 || value === false) return null;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
    return null;
  };
  const normalizeCapEntry = (raw) => {
    const input = raw && typeof raw === 'object' ? raw : {};
    const maxBytes = normalizeCapValue(input.maxBytes);
    const maxLines = normalizeCapValue(input.maxLines);
    return { maxBytes, maxLines };
  };
  const normalizeCapsByExt = (raw) => {
    const input = raw && typeof raw === 'object' ? raw : {};
    const output = {};
    for (const [key, value] of Object.entries(input)) {
      const entry = normalizeCapEntry(value);
      if (entry.maxBytes == null && entry.maxLines == null) continue;
      const normalizedKey = key.startsWith('.') ? key.toLowerCase() : `.${key.toLowerCase()}`;
      output[normalizedKey] = entry;
    }
    return output;
  };
  const normalizeCapsByLanguage = (raw) => {
    const input = raw && typeof raw === 'object' ? raw : {};
    const output = {};
    for (const [key, value] of Object.entries(input)) {
      const entry = normalizeCapEntry(value);
      if (entry.maxBytes == null && entry.maxLines == null) continue;
      output[key.toLowerCase()] = entry;
    }
    return output;
  };
  const kotlinFlowMaxBytes = normalizeLimit(kotlinConfig.flowMaxBytes, 200 * 1024);
  const kotlinFlowMaxLines = normalizeLimit(kotlinConfig.flowMaxLines, 3000);
  const kotlinRelationsMaxBytes = normalizeLimit(kotlinConfig.relationsMaxBytes, 200 * 1024);
  const kotlinRelationsMaxLines = normalizeLimit(kotlinConfig.relationsMaxLines, 3000);
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
  const javascriptFlow = normalizeFlow(indexingConfig.javascriptFlow);
  const pythonAstConfig = indexingConfig.pythonAst || {};
  const pythonAstEnabled = pythonAstConfig.enabled !== false;
  const embeddingBatchRaw = Number(indexingConfig.embeddingBatchSize);
  let embeddingBatchSize = Number.isFinite(embeddingBatchRaw)
    ? Math.max(0, Math.floor(embeddingBatchRaw))
    : 0;
  if (!embeddingBatchSize) {
    const totalGb = os.totalmem() / (1024 ** 3);
    const autoBatch = Math.floor(totalGb * 32);
    embeddingBatchSize = Math.min(128, Math.max(32, autoBatch));
  }
  const embeddingsConfig = indexingConfig.embeddings || {};
  const embeddingQueueConfig = embeddingsConfig.queue || {};
  const embeddingCacheConfig = embeddingsConfig.cache || {};
  const embeddingModeRaw = typeof embeddingsConfig.mode === 'string'
    ? embeddingsConfig.mode.trim().toLowerCase()
    : 'auto';
  const embeddingQueueDir = typeof embeddingQueueConfig.dir === 'string'
    ? embeddingQueueConfig.dir.trim()
    : '';
  const embeddingQueueMaxRaw = Number(embeddingQueueConfig.maxQueued);
  const embeddingQueueMaxQueued = Number.isFinite(embeddingQueueMaxRaw)
    ? Math.max(0, Math.floor(embeddingQueueMaxRaw))
    : null;
  const embeddingCacheDir = typeof embeddingCacheConfig.dir === 'string'
    ? embeddingCacheConfig.dir.trim()
    : '';
  const fileCapsConfig = indexingConfig.fileCaps || {};
  const fileCaps = {
    default: normalizeCapEntry(fileCapsConfig.default || fileCapsConfig.defaults || {}),
    byExt: normalizeCapsByExt(fileCapsConfig.byExt || fileCapsConfig.byExtension),
    byLanguage: normalizeCapsByLanguage(fileCapsConfig.byLanguage || fileCapsConfig.byLang)
  };
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
  const shardsDirDepth = normalizeDepth(shardsConfig.dirDepth, 3);
  const treeSitterConfig = indexingConfig.treeSitter || {};
  const treeSitterEnabled = treeSitterConfig.enabled !== false;
  const treeSitterLanguages = treeSitterConfig.languages || {};
  const treeSitterMaxBytes = normalizeLimit(treeSitterConfig.maxBytes, 512 * 1024);
  const treeSitterMaxLines = normalizeLimit(treeSitterConfig.maxLines, 10000);
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

  const threadsArgPresent = rawArgv.some((arg) => arg === '--threads' || arg.startsWith('--threads='));
  const configConcurrency = Number(indexingConfig.concurrency);
  const cpuCount = os.cpus().length;
  const defaultThreads = Math.max(1, cpuCount * 4);
  const rawCliThreads = Number(argv.threads);
  const envThreadsRaw = process.env.PAIROFCLEATS_THREADS;
  const envThreads = Number(envThreadsRaw);
  const envThreadsProvided = Number.isFinite(envThreads) && envThreads > 0;
  const cliThreadsProvided = threadsArgPresent
    || (Number.isFinite(rawCliThreads) && rawCliThreads !== defaultThreads);
  const cliConcurrency = envThreadsProvided
    ? envThreads
    : (cliThreadsProvided ? rawCliThreads : null);
  const baseConcurrencyCap = defaultThreads;
  const maxConcurrencyCap = Number.isFinite(cliConcurrency)
    ? Math.max(baseConcurrencyCap, Math.floor(cliConcurrency))
    : Number.isFinite(configConcurrency)
      ? Math.max(baseConcurrencyCap, Math.floor(configConcurrency))
      : baseConcurrencyCap;
  const defaultConcurrency = Math.max(1, Math.min(cpuCount, maxConcurrencyCap));
  const fileConcurrency = Math.max(
    1,
    Math.min(
      maxConcurrencyCap,
      Number.isFinite(cliConcurrency)
        ? cliConcurrency
        : Number.isFinite(configConcurrency)
          ? configConcurrency
          : defaultConcurrency
    )
  );
  const importConcurrency = Math.max(
    1,
    Math.min(
      maxConcurrencyCap,
      Number.isFinite(cliConcurrency)
        ? fileConcurrency
        : Number.isFinite(Number(indexingConfig.importConcurrency))
          ? Number(indexingConfig.importConcurrency)
          : fileConcurrency
    )
  );
  const ioConcurrency = Math.max(fileConcurrency, importConcurrency)*2;
  const cpuConcurrency = Math.max(1, Math.min(maxConcurrencyCap, fileConcurrency))*2;
  const embeddingConcurrencyRaw = Number(embeddingsConfig.concurrency);
  let embeddingConcurrency = Number.isFinite(embeddingConcurrencyRaw) && embeddingConcurrencyRaw > 0
    ? Math.floor(embeddingConcurrencyRaw)
    : 0;
  if (!embeddingConcurrency) {
    const defaultEmbedding = process.platform === 'win32'
      ? Math.min(2, cpuConcurrency)
      : Math.min(4, cpuConcurrency);
    embeddingConcurrency = Math.max(1, defaultEmbedding);
  }
  embeddingConcurrency = Math.max(1, Math.min(embeddingConcurrency, cpuConcurrency));
  const queues = createTaskQueues({ ioConcurrency, cpuConcurrency, embeddingConcurrency });
  const workerPoolConfig = normalizeWorkerPoolConfig(
    indexingConfig.workerPool || {},
    { cpuLimit: cpuConcurrency }
  );
  const workerPoolOverride = typeof process.env.PAIROFCLEATS_WORKER_POOL === 'string'
    ? process.env.PAIROFCLEATS_WORKER_POOL.trim().toLowerCase()
    : '';
  if (workerPoolOverride) {
    if (['0', 'false', 'off', 'disable', 'disabled'].includes(workerPoolOverride)) {
      workerPoolConfig.enabled = false;
    } else if (['1', 'true', 'on', 'enable', 'enabled'].includes(workerPoolOverride)) {
      workerPoolConfig.enabled = true;
    } else if (workerPoolOverride === 'auto') {
      workerPoolConfig.enabled = 'auto';
    }
  }

  const incrementalEnabled = argv.incremental === true;
  const debugCrash = argv['debug-crash'] === true
    || process.env.PAIROFCLEATS_DEBUG_CRASH === '1'
    || indexingConfig.debugCrash === true;
  const baseStubEmbeddings = argv['stub-embeddings'] === true
    || process.env.PAIROFCLEATS_EMBEDDINGS === 'stub';
  const normalizedEmbeddingMode = ['auto', 'inline', 'service', 'stub', 'off'].includes(embeddingModeRaw)
    ? embeddingModeRaw
    : 'auto';
  const resolvedEmbeddingMode = normalizedEmbeddingMode === 'auto'
    ? (baseStubEmbeddings ? 'stub' : 'inline')
    : normalizedEmbeddingMode;
  const embeddingService = embeddingsConfig.enabled !== false
    && resolvedEmbeddingMode === 'service';
  const embeddingEnabled = embeddingsConfig.enabled !== false
    && resolvedEmbeddingMode !== 'off'
    && !embeddingService;
  const useStubEmbeddings = resolvedEmbeddingMode === 'stub' || baseStubEmbeddings;
  const modelConfig = getModelConfig(root, userConfig);
  const modelId = argv.model || modelConfig.id || DEFAULT_MODEL_ID;
  const modelsDir = modelConfig.dir;
  if (modelsDir) {
    try {
      await fs.mkdir(modelsDir, { recursive: true });
    } catch {}
  }

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

  let getChunkEmbedding = async () => [];
  let getChunkEmbeddings = async () => [];
  if (embeddingEnabled) {
    const embedder = createEmbedder({
      useStubEmbeddings,
      modelId,
      dims: argv.dims,
      modelsDir
    });
    getChunkEmbedding = embedder.getChunkEmbedding;
    getChunkEmbeddings = embedder.getChunkEmbeddings;
  }

  const { ignoreMatcher, config: ignoreConfig, ignoreFiles } = await buildIgnoreMatcher({ root, userConfig });

  const cacheConfig = getCacheRuntimeConfig(root, userConfig);
  const verboseCache = process.env.PAIROFCLEATS_VERBOSE === '1';

  if (dictSummary.files) {
    log(`Wordlists enabled: ${dictSummary.files} file(s), ${dictSummary.words.toLocaleString()} words for identifier splitting.`);
  } else {
    log('Wordlists disabled: no dictionary files found; identifier splitting will be limited.');
  }
  if (stage === 'stage1') {
    log('Two-stage indexing: stage1 (sparse) overrides enabled.');
  } else if (stage === 'stage2') {
    log('Two-stage indexing: stage2 (enrichment) running.');
  }
  if (!embeddingEnabled) {
    const label = embeddingService ? 'service queue' : 'disabled';
    log(`Embeddings: ${label}.`);
  } else if (useStubEmbeddings) {
    log('Embeddings: stub mode enabled (no model downloads).');
  } else {
    log(`Embeddings: model ${modelId}`);
  }
  if (embeddingEnabled) {
    log(`Embedding batch size: ${embeddingBatchSize}`);
    log(`Embedding concurrency: ${embeddingConcurrency}`);
  }
  if (incrementalEnabled) {
    log(`Incremental cache enabled (root: ${path.join(repoCacheRoot, 'incremental')}).`);
  }
  if (benchmarkProfile.enabled) {
    const disabled = benchmarkProfile.disabled.length
      ? benchmarkProfile.disabled.join(', ')
      : 'none';
    log(`Benchmark profile enabled: disabled ${disabled}.`);
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
    const enabledTreeSitterLanguages = resolveEnabledTreeSitterLanguages({
      enabled: treeSitterEnabled,
      languages: treeSitterLanguages
    });
    await preloadTreeSitterLanguages(enabledTreeSitterLanguages, { log });
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
  const workerCrashLogger = await createCrashLogger({
    repoCacheRoot,
    enabled: debugCrash,
    log: null
  });

  let workerPool = null;
  if (workerPoolConfig.enabled !== false) {
    workerPool = await createIndexerWorkerPool({
      config: workerPoolConfig,
      dictWords,
      dictConfig,
      postingsConfig,
      crashLogger: workerCrashLogger,
      log
    });
    if (workerPool) {
      const modeLabel = workerPoolConfig.enabled === 'auto' ? 'auto' : 'on';
      log(`Worker pool enabled (${modeLabel}, maxThreads=${workerPoolConfig.maxWorkers}).`);
      if (workerPoolConfig.enabled === 'auto') {
        log(`Worker pool auto threshold: maxFileBytes=${workerPoolConfig.maxFileBytes}.`);
      }
    } else {
      log('Worker pool disabled (fallback to main thread).');
    }
  }

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
      importsOnly: typescriptImportsOnly,
      embeddingBatchMultiplier: typescriptEmbeddingBatchMultiplier
    },
    pythonAst: pythonAstConfig,
    kotlin: {
      flowMaxBytes: kotlinFlowMaxBytes,
      flowMaxLines: kotlinFlowMaxLines,
      relationsMaxBytes: kotlinRelationsMaxBytes,
      relationsMaxLines: kotlinRelationsMaxLines
    },
    treeSitter: {
      enabled: treeSitterEnabled,
      languages: treeSitterLanguages,
      maxBytes: treeSitterMaxBytes,
      maxLines: treeSitterMaxLines
    },
    resolveSqlDialect,
    yamlChunking: {
      mode: yamlChunkingMode,
      maxBytes: yamlTopLevelMaxBytes
    },
    log
  };

  return {
    root,
    argv,
    rawArgv,
    userConfig,
    repoCacheRoot,
    toolingConfig,
    toolingEnabled,
    indexingConfig,
    benchmarkProfile,
    postingsConfig,
    astDataflowEnabled,
    controlFlowEnabled,
    typeInferenceEnabled,
    typeInferenceCrossFileEnabled,
    riskAnalysisEnabled,
    riskAnalysisCrossFileEnabled,
    embeddingBatchSize,
    embeddingConcurrency,
    embeddingEnabled,
    embeddingMode: resolvedEmbeddingMode,
    embeddingService,
    embeddingQueue: {
      dir: embeddingQueueDir || null,
      maxQueued: embeddingQueueMaxQueued
    },
    embeddingCache: {
      dir: embeddingCacheDir || null
    },
    fileCaps,
    fileScan,
    shards: {
      enabled: shardsEnabled,
      maxWorkers: shardsMaxWorkers,
      maxShards: shardsMaxShards,
      minFiles: shardsMinFiles,
      dirDepth: shardsDirDepth
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
    debugCrash,
    useStubEmbeddings,
    modelConfig,
    modelId,
    modelsDir,
    workerPoolConfig,
    workerPool,
    dictConfig,
    dictionaryPaths,
    dictWords,
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
