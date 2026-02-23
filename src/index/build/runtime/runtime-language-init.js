import { normalizeCommentConfig } from '../../comments.js';
import { normalizeSegmentsConfig } from '../../segments.js';
import { normalizeEmbeddingBatchMultipliers } from '../embedding-batch.js';
import { normalizeLimit } from './caps.js';
import {
  normalizeLanguageFlowConfig,
  normalizeLanguageParserConfig
} from './normalize.js';

const DEFAULT_SQL_DIALECTS = Object.freeze({
  '.psql': 'postgres',
  '.pgsql': 'postgres',
  '.mysql': 'mysql',
  '.sqlite': 'sqlite'
});

/**
 * Resolve language/runtime parsing knobs from the finalized indexing config.
 *
 * Sequencing contract:
 * - Invoke after auto-policy/stage/platform/learned-profile merges so this
 *   snapshot reflects the effective runtime config.
 * - Invoke before worker/tree-sitter setup so downstream runtime assembly can
 *   consume one stable set of parser/chunking defaults.
 *
 * @param {object} indexingConfig
 * @returns {{
 *   parserConfig:Record<string,string>,
 *   flowConfig:Record<string,'auto'|'on'|'off'>,
 *   typescriptImportsOnly:boolean,
 *   embeddingBatchMultipliers:Record<string,number>,
 *   pythonAstConfig:object,
 *   segmentsConfig:object,
 *   commentsConfig:object,
 *   tokenizationFileStream:boolean,
 *   chunking:{maxBytes:number|null,maxLines:number|null},
 *   yamlChunkingMode:'auto'|'root'|'top-level',
 *   yamlTopLevelMaxBytes:number,
 *   kotlinFlowMaxBytes:number|null,
 *   kotlinFlowMaxLines:number|null,
 *   kotlinRelationsMaxBytes:number|null,
 *   kotlinRelationsMaxLines:number|null
 * }}
 */
export const resolveRuntimeLanguageInitConfig = (indexingConfig) => {
  const parserConfig = normalizeLanguageParserConfig(indexingConfig);
  const flowConfig = normalizeLanguageFlowConfig(indexingConfig);

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

  const pythonAstConfig = indexingConfig.pythonAst || {};
  const segmentsConfig = normalizeSegmentsConfig(indexingConfig.segments || {});
  const commentsConfig = normalizeCommentConfig(indexingConfig.comments || {});

  const chunkingConfig = indexingConfig.chunking || {};
  const tokenizationConfig = indexingConfig.tokenization || {};
  const tokenizationFileStream = tokenizationConfig.fileStream !== false;
  const chunking = {
    maxBytes: normalizeLimit(chunkingConfig.maxBytes, null),
    maxLines: normalizeLimit(chunkingConfig.maxLines, null)
  };

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

  return {
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
  };
};

/**
 * Build SQL dialect resolver closure from runtime SQL config.
 *
 * Sequencing contract:
 * - Create once after user config load and reuse this resolver in both
 *   `runtime.languageOptions` and the top-level runtime export.
 * - Do not reconstruct later in startup to keep dialect behavior stable across
 *   pipeline stages.
 *
 * @param {object} [sqlConfig={}]
 * @returns {(ext:string)=>string}
 */
export const createRuntimeSqlDialectResolver = (sqlConfig = {}) => {
  const sqlDialectByExt = { ...DEFAULT_SQL_DIALECTS, ...(sqlConfig.dialectByExt || {}) };
  const sqlDialectOverride = typeof sqlConfig.dialect === 'string' && sqlConfig.dialect.trim()
    ? sqlConfig.dialect.trim()
    : '';
  return (ext) => (sqlDialectOverride || sqlDialectByExt[ext] || 'generic');
};
