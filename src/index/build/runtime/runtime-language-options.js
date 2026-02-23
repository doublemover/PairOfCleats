/**
 * Build language runtime options payload shared by file/language processors.
 *
 * @param {object} input
 * @param {string} input.root
 * @param {boolean} input.astDataflowEnabled
 * @param {boolean} input.controlFlowEnabled
 * @param {boolean} input.skipUnknownLanguages
 * @param {boolean} input.skipOnParseError
 * @param {object} input.parserConfig
 * @param {object} input.flowConfig
 * @param {boolean} input.typescriptImportsOnly
 * @param {object} input.embeddingBatchMultipliers
 * @param {object} input.chunking
 * @param {boolean} input.tokenizationFileStream
 * @param {object} input.pythonAstRuntimeConfig
 * @param {number} input.kotlinFlowMaxBytes
 * @param {number} input.kotlinFlowMaxLines
 * @param {number} input.kotlinRelationsMaxBytes
 * @param {number} input.kotlinRelationsMaxLines
 * @param {boolean} input.treeSitterEnabled
 * @param {string[]} input.treeSitterLanguages
 * @param {boolean} input.treeSitterConfigChunking
 * @param {number} input.treeSitterMaxBytes
 * @param {number} input.treeSitterMaxLines
 * @param {number} input.treeSitterMaxParseMs
 * @param {object} input.treeSitterByLanguage
 * @param {boolean} input.treeSitterPreload
 * @param {number} input.treeSitterPreloadConcurrency
 * @param {boolean} input.treeSitterBatchByLanguage
 * @param {boolean} input.treeSitterBatchEmbeddedLanguages
 * @param {number} input.treeSitterLanguagePasses
 * @param {boolean} input.treeSitterDeferMissing
 * @param {number} input.treeSitterDeferMissingMax
 * @param {boolean} input.treeSitterCachePersistent
 * @param {string|null} input.resolvedTreeSitterCachePersistentDir
 * @param {boolean} input.treeSitterWorker
 * @param {object|null} input.treeSitterScheduler
 * @param {(filePath:string,declaredDialect?:string)=>string} input.resolveSqlDialect
 * @param {string} input.yamlChunkingMode
 * @param {number} input.yamlTopLevelMaxBytes
 * @param {object} input.lexiconConfig
 * @param {(line:string,meta?:object)=>void} input.log
 * @returns {object}
 */
export function buildRuntimeLanguageOptions({
  root,
  astDataflowEnabled,
  controlFlowEnabled,
  skipUnknownLanguages,
  skipOnParseError,
  parserConfig,
  flowConfig,
  typescriptImportsOnly,
  embeddingBatchMultipliers,
  chunking,
  tokenizationFileStream,
  pythonAstRuntimeConfig,
  kotlinFlowMaxBytes,
  kotlinFlowMaxLines,
  kotlinRelationsMaxBytes,
  kotlinRelationsMaxLines,
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
  treeSitterCachePersistent,
  resolvedTreeSitterCachePersistentDir,
  treeSitterWorker,
  treeSitterScheduler,
  resolveSqlDialect,
  yamlChunkingMode,
  yamlTopLevelMaxBytes,
  lexiconConfig,
  log
}) {
  return {
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
}
