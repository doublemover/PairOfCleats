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

/**
 * Create runtime configuration for build_index.
 * @param {{root:string,argv:object,rawArgv:string[]}} input
 * @returns {Promise<object>}
 */
export async function createBuildRuntime({ root, argv, rawArgv }) {
  const userConfig = loadUserConfig(root);
  const rawIndexingConfig = userConfig.indexing || {};
  const { indexingConfig, profile: benchmarkProfile } = applyBenchmarkProfile(
    rawIndexingConfig,
    process.env.PAIROFCLEATS_BENCH_PROFILE
  );
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
  const javascriptFlow = normalizeFlow(indexingConfig.javascriptFlow);
  const pythonAstConfig = indexingConfig.pythonAst || {};
  const pythonAstEnabled = pythonAstConfig.enabled !== false;
  const embeddingBatchRaw = Number(indexingConfig.embeddingBatchSize);
  const embeddingBatchSize = Number.isFinite(embeddingBatchRaw)
    ? Math.max(0, Math.floor(embeddingBatchRaw))
    : 0;
  const treeSitterConfig = indexingConfig.treeSitter || {};
  const treeSitterEnabled = treeSitterConfig.enabled !== false;
  const treeSitterLanguages = treeSitterConfig.languages || {};
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

  const threadsArgPresent = rawArgv.includes('--threads');
  const configConcurrency = Number(indexingConfig.concurrency);
  const cliConcurrency = threadsArgPresent ? Number(argv.threads) : null;
  const defaultConcurrency = Math.max(1, Math.min(4, os.cpus().length));
  const fileConcurrency = Math.max(
    1,
    Math.min(
      16,
      Number.isFinite(configConcurrency)
        ? configConcurrency
        : Number.isFinite(cliConcurrency)
          ? cliConcurrency
          : defaultConcurrency
    )
  );
  const importConcurrency = Math.max(
    1,
    Math.min(
      16,
      Number.isFinite(Number(indexingConfig.importConcurrency))
        ? Number(indexingConfig.importConcurrency)
        : fileConcurrency
    )
  );
  const ioConcurrency = Math.max(fileConcurrency, importConcurrency);
  const cpuConcurrency = Math.max(1, Math.min(os.cpus().length, fileConcurrency));
  const queues = createTaskQueues({ ioConcurrency, cpuConcurrency });
  const workerPoolConfig = normalizeWorkerPoolConfig(
    indexingConfig.workerPool || {},
    { cpuLimit: cpuConcurrency }
  );

  const incrementalEnabled = argv.incremental === true;
  const useStubEmbeddings = argv['stub-embeddings'] === true || process.env.PAIROFCLEATS_EMBEDDINGS === 'stub';
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
  const dictSummary = { files: dictionaryPaths.length, words: dictWords.size };

  const { getChunkEmbedding, getChunkEmbeddings } = createEmbedder({
    useStubEmbeddings,
    modelId,
    dims: argv.dims,
    modelsDir
  });

  const { ignoreMatcher, config: ignoreConfig, ignoreFiles } = await buildIgnoreMatcher({ root, userConfig });

  const cacheConfig = getCacheRuntimeConfig(root, userConfig);
  const verboseCache = process.env.PAIROFCLEATS_VERBOSE === '1';

  if (dictSummary.files) {
    log(`Wordlists enabled: ${dictSummary.files} file(s), ${dictSummary.words.toLocaleString()} words for identifier splitting.`);
  } else {
    log('Wordlists disabled: no dictionary files found; identifier splitting will be limited.');
  }
  if (useStubEmbeddings) {
    log('Embeddings: stub mode enabled (no model downloads).');
  } else {
    log(`Embeddings: model ${modelId}`);
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
  let workerPool = null;
  if (workerPoolConfig.enabled !== false) {
    workerPool = await createIndexerWorkerPool({
      config: workerPoolConfig,
      dictWords,
      dictConfig,
      postingsConfig,
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
    astDataflowEnabled,
    controlFlowEnabled,
    javascript: {
      parser: javascriptParser,
      flow: javascriptFlow
    },
    typescript: {
      parser: typescriptParser
    },
    pythonAst: pythonAstConfig,
    treeSitter: {
      enabled: treeSitterEnabled,
      languages: treeSitterLanguages
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
    getChunkEmbedding,
    getChunkEmbeddings,
    languageOptions,
    embeddingBatchSize,
    ignoreMatcher,
    ignoreConfig,
    ignoreFiles,
    maxFileBytes,
    cacheConfig,
    verboseCache
  };
}
