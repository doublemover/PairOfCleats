import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_MODEL_ID,
  getDictionaryPaths,
  getDictConfig,
  getModelConfig,
  getRepoCacheRoot,
  getToolingConfig,
  loadUserConfig
} from '../../../tools/dict-utils.js';
import { createEmbedder } from '../embedding.js';
import { log } from '../../shared/progress.js';
import { buildIgnoreMatcher } from './ignore.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';

/**
 * Create runtime configuration for build_index.
 * @param {{root:string,argv:object,rawArgv:string[]}} input
 * @returns {Promise<object>}
 */
export async function createBuildRuntime({ root, argv, rawArgv }) {
  const userConfig = loadUserConfig(root);
  const repoCacheRoot = getRepoCacheRoot(root, userConfig);
  const toolingConfig = getToolingConfig(root, userConfig);
  const toolingEnabled = toolingConfig.autoEnableOnDetect !== false;
  const indexingConfig = userConfig.indexing || {};
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
  const pythonAstConfig = indexingConfig.pythonAst || {};
  const pythonAstEnabled = pythonAstConfig.enabled !== false;
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

  const { getChunkEmbedding } = createEmbedder({
    useStubEmbeddings,
    modelId,
    dims: argv.dims,
    modelsDir
  });

  const { ignoreMatcher, config: ignoreConfig, ignoreFiles } = await buildIgnoreMatcher({ root, userConfig });

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
  if (!astDataflowEnabled) {
    log('AST dataflow metadata disabled via indexing.astDataflow.');
  }
  if (!controlFlowEnabled) {
    log('Control-flow metadata disabled via indexing.controlFlow.');
  }
  if (!pythonAstEnabled) {
    log('Python AST metadata disabled via indexing.pythonAst.enabled.');
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

  const languageOptions = {
    astDataflowEnabled,
    controlFlowEnabled,
    pythonAst: pythonAstConfig,
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
    postingsConfig,
    astDataflowEnabled,
    controlFlowEnabled,
    typeInferenceEnabled,
    typeInferenceCrossFileEnabled,
    riskAnalysisEnabled,
    riskAnalysisCrossFileEnabled,
    gitBlameEnabled,
    resolveSqlDialect,
    fileConcurrency,
    importConcurrency,
    incrementalEnabled,
    useStubEmbeddings,
    modelConfig,
    modelId,
    modelsDir,
    dictConfig,
    dictionaryPaths,
    dictWords,
    dictSummary,
    getChunkEmbedding,
    languageOptions,
    ignoreMatcher,
    ignoreConfig,
    ignoreFiles,
    maxFileBytes
  };
}
