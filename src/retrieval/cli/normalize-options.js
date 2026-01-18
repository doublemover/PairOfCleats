import { getVectorExtensionConfig } from '../../../tools/vector-extension.js';
import { normalizeHnswConfig } from '../../shared/hnsw.js';
import { normalizeLanceDbConfig } from '../../shared/lancedb.js';
import { normalizeTantivyConfig } from '../../shared/tantivy.js';
import { normalizeEmbeddingProvider, normalizeOnnxConfig } from '../../shared/onnx-embeddings.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';
import { resolveFtsWeights } from '../fts.js';
import { parseJson } from '../query-cache.js';
import { parseChurnArg, parseModifiedArgs } from '../query-parse.js';
import { mergeExtFilters, normalizeExtFilter, normalizeLangFilter, parseMetaFilters } from '../filters.js';
import { resolveSearchMode } from '../cli-args.js';
import { getMissingFlagMessages, resolveBm25Defaults } from './options.js';

const normalizeOptionalNumber = (value) => (
  Number.isFinite(Number(value)) ? Number(value) : null
);

const normalizeOptionalPositive = (value, fallback) => {
  const parsed = normalizeOptionalNumber(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
};

const normalizeAnnBackend = (value) => {
  if (typeof value !== 'string') return 'lancedb';
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return 'lancedb';
  if (trimmed === 'sqlite' || trimmed === 'sqlite-extension' || trimmed === 'vector-extension') {
    return 'sqlite-vector';
  }
  if (trimmed === 'dense') return 'js';
  if (['auto', 'lancedb', 'sqlite-vector', 'hnsw', 'js'].includes(trimmed)) {
    return trimmed;
  }
  return 'lancedb';
};

export function normalizeSearchOptions({
  argv,
  rawArgs,
  rootDir,
  userConfig,
  envConfig,
  metricsDir
}) {
  const jsonCompact = argv['json-compact'] === true;
  const jsonOutput = argv.json || jsonCompact;
  const missingValueMessages = getMissingFlagMessages(argv, rawArgs);
  const query = argv._.join(' ').trim();

  const embeddingsConfig = userConfig.indexing?.embeddings || {};
  const embeddingProvider = normalizeEmbeddingProvider(embeddingsConfig.provider, { strict: true });
  const embeddingOnnx = normalizeOnnxConfig(embeddingsConfig.onnx || {});
  const hnswConfig = normalizeHnswConfig(embeddingsConfig.hnsw || {});
  const lancedbConfig = normalizeLanceDbConfig(embeddingsConfig.lancedb || {});
  const tantivyConfig = normalizeTantivyConfig(userConfig.tantivy || {});

  const sqliteConfig = userConfig.sqlite || {};
  const sqliteAutoChunkThresholdRaw = userConfig.search?.sqliteAutoChunkThreshold;
  const sqliteAutoChunkThreshold = normalizeOptionalPositive(sqliteAutoChunkThresholdRaw, 0);
  const sqliteAutoArtifactBytesRaw = userConfig.search?.sqliteAutoArtifactBytes;
  const sqliteAutoArtifactBytes = normalizeOptionalPositive(sqliteAutoArtifactBytesRaw, 0);

  const postingsConfig = normalizePostingsConfig(userConfig.indexing?.postings || {});
  const filePrefilterConfig = userConfig.search?.filePrefilter || {};
  const filePrefilterEnabled = filePrefilterConfig.enabled !== false;
  const searchRegexConfig = userConfig.search?.regex || null;
  const fileChargramN = Number.isFinite(Number(filePrefilterConfig.chargramN))
    ? Math.max(2, Math.floor(Number(filePrefilterConfig.chargramN)))
    : postingsConfig.chargramMinN;

  const vectorExtension = getVectorExtensionConfig(rootDir, userConfig);

  const contextLines = Math.max(0, parseInt(argv.context, 10) || 0);
  const searchType = argv.type || null;
  const searchAuthor = argv.author || null;
  const searchImport = argv.import || null;
  const chunkAuthorFilter = argv['chunk-author'] || null;

  const searchModeInfo = resolveSearchMode(argv.mode);
  const {
    searchMode,
    runCode,
    runProse,
    runRecords,
    runExtractedProse: runExtractedProseRaw
  } = searchModeInfo;
  const runExtractedProse = runExtractedProseRaw;
  const commentsEnabled = argv.comments !== false;

  const bm25Config = userConfig.search?.bm25 || {};
  const bm25K1Arg = normalizeOptionalNumber(argv['bm25-k1']);
  const bm25BArg = normalizeOptionalNumber(argv['bm25-b']);
  const bm25Defaults = resolveBm25Defaults(metricsDir, { runCode, runProse, runExtractedProse });
  const bm25K1 = bm25K1Arg
    ?? normalizeOptionalNumber(bm25Config.k1)
    ?? (bm25Defaults ? bm25Defaults.k1 : null)
    ?? 1.2;
  const bm25B = bm25BArg
    ?? normalizeOptionalNumber(bm25Config.b)
    ?? (bm25Defaults ? bm25Defaults.b : null)
    ?? 0.75;

  const branchesMin = normalizeOptionalNumber(argv.branches);
  const loopsMin = normalizeOptionalNumber(argv.loops);
  const breaksMin = normalizeOptionalNumber(argv.breaks);
  const continuesMin = normalizeOptionalNumber(argv.continues);
  const churnMin = argv.churn ? parseChurnArg(argv.churn) : null;
  const modifiedArgs = parseModifiedArgs(argv['modified-after'], argv['modified-since']);
  const modifiedAfter = modifiedArgs.modifiedAfter;
  const modifiedSinceDays = modifiedArgs.modifiedSinceDays;

  const fileFilters = [];
  if (argv.path) fileFilters.push(argv.path);
  if (argv.file) fileFilters.push(argv.file);
  const fileFilter = fileFilters.length ? fileFilters.flat() : null;
  const caseAll = argv.case === true;
  const caseFile = argv['case-file'] === true || caseAll;
  const caseTokens = argv['case-tokens'] === true || caseAll;
  const branchFilter = argv.branch ? String(argv.branch).trim() : null;

  const extFilterRaw = normalizeExtFilter(argv.ext);
  const langFilter = normalizeLangFilter(argv.lang);
  const extFilter = mergeExtFilters(extFilterRaw, langFilter);
  const metaFilters = parseMetaFilters(argv.meta, argv['meta-json']);

  const annFlagPresent = rawArgs.includes('--ann') || rawArgs.includes('--no-ann');
  const annDefault = userConfig.search?.annDefault !== false;
  const annEnabled = annFlagPresent ? argv.ann : annDefault;
  const annBackendRaw = argv['ann-backend'] ?? userConfig.search?.annBackend ?? 'lancedb';
  const annBackend = normalizeAnnBackend(annBackendRaw);

  const scoreBlendConfig = userConfig.search?.scoreBlend || {};
  const scoreBlendEnabled = scoreBlendConfig.enabled === true;
  const scoreBlendSparseWeight = normalizeOptionalNumber(scoreBlendConfig.sparseWeight) ?? 1;
  const scoreBlendAnnWeight = normalizeOptionalNumber(scoreBlendConfig.annWeight) ?? 1;

  const symbolBoostConfig = userConfig.search?.symbolBoost || {};
  const symbolBoostEnabled = symbolBoostConfig.enabled !== false;
  const symbolBoostDefinitionWeight = normalizeOptionalNumber(symbolBoostConfig.definitionWeight) ?? 1.2;
  const symbolBoostExportWeight = normalizeOptionalNumber(symbolBoostConfig.exportWeight) ?? 1.1;

  const minhashMaxDocs = Number.isFinite(Number(userConfig.search?.minhashMaxDocs))
    ? Math.max(0, Number(userConfig.search.minhashMaxDocs))
    : 5000;

  const queryCacheConfig = userConfig.search?.queryCache || {};
  const queryCacheEnabled = queryCacheConfig.enabled === true;
  const queryCacheMaxEntries = Number.isFinite(Number(queryCacheConfig.maxEntries))
    ? Math.max(1, Number(queryCacheConfig.maxEntries))
    : 200;
  const queryCacheTtlMs = Number.isFinite(Number(queryCacheConfig.ttlMs))
    ? Math.max(0, Number(queryCacheConfig.ttlMs))
    : 0;

  const rrfConfig = userConfig.search?.rrf || {};
  const rrfEnabled = rrfConfig.enabled !== false;
  const rrfK = Number.isFinite(Number(rrfConfig.k)) ? Math.max(1, Number(rrfConfig.k)) : 60;

  const contextExpansionConfig = userConfig.search?.contextExpansion || {};
  const contextExpansionEnabled = contextExpansionConfig.enabled === true;
  const contextExpansionOptions = {
    maxPerHit: contextExpansionConfig.maxPerHit,
    maxTotal: contextExpansionConfig.maxTotal,
    includeCalls: contextExpansionConfig.includeCalls,
    includeImports: contextExpansionConfig.includeImports,
    includeExports: contextExpansionConfig.includeExports,
    includeUsages: contextExpansionConfig.includeUsages
  };
  const contextExpansionRespectFilters = contextExpansionConfig.respectFilters !== false;

  const sqliteFtsNormalize = userConfig.search?.sqliteFtsNormalize === true;
  const sqliteFtsProfile = (argv['fts-profile']
    || envConfig.ftsProfile
    || userConfig.search?.sqliteFtsProfile
    || 'balanced').toLowerCase();
  let sqliteFtsWeightsConfig = userConfig.search?.sqliteFtsWeights || null;
  if (argv['fts-weights']) {
    const parsed = parseJson(argv['fts-weights'], null);
    if (parsed) {
      sqliteFtsWeightsConfig = parsed;
    } else {
      const values = String(argv['fts-weights'])
        .split(/[,\s]+/)
        .filter(Boolean)
        .map((val) => Number(val))
        .filter((val) => Number.isFinite(val));
      sqliteFtsWeightsConfig = values.length ? values : sqliteFtsWeightsConfig;
    }
  }
  const sqliteFtsWeights = resolveFtsWeights(sqliteFtsProfile, sqliteFtsWeightsConfig);

  const explain = argv.explain === true || argv.why === true;
  const denseVectorMode = typeof userConfig.search?.denseVectorMode === 'string'
    ? userConfig.search.denseVectorMode.toLowerCase()
    : 'merged';

  const backendArg = typeof argv.backend === 'string' ? argv.backend.toLowerCase() : '';
  const sparseBackend = backendArg === 'tantivy' ? 'tantivy' : 'auto';

  return {
    jsonCompact,
    jsonOutput,
    missingValueMessages,
    query,
    contextLines,
    searchType,
    searchAuthor,
    searchImport,
    chunkAuthorFilter,
    searchMode,
    runCode,
    runProse,
    runRecords,
    runExtractedProse,
    commentsEnabled,
    embeddingsConfig,
    embeddingProvider,
    embeddingOnnx,
    hnswConfig,
    sqliteConfig,
    sqliteAutoChunkThreshold,
    sqliteAutoArtifactBytes,
    postingsConfig,
    filePrefilterConfig,
    filePrefilterEnabled,
    searchRegexConfig,
    fileChargramN,
    vectorExtension,
    bm25Config,
    bm25K1,
    bm25B,
    branchesMin,
    loopsMin,
    breaksMin,
    continuesMin,
    churnMin,
    modifiedAfter,
    modifiedSinceDays,
    fileFilter,
    caseFile,
    caseTokens,
    branchFilter,
    extFilter,
    metaFilters,
    annEnabled,
    annBackend,
    scoreBlendEnabled,
    scoreBlendSparseWeight,
    scoreBlendAnnWeight,
    symbolBoostEnabled,
    symbolBoostDefinitionWeight,
    symbolBoostExportWeight,
    minhashMaxDocs,
    queryCacheEnabled,
    queryCacheMaxEntries,
    queryCacheTtlMs,
    rrfEnabled,
    rrfK,
    contextExpansionEnabled,
    contextExpansionOptions,
    contextExpansionRespectFilters,
    sqliteFtsNormalize,
    sqliteFtsProfile,
    sqliteFtsWeights,
    fieldWeightsConfig: userConfig.search?.fieldWeights,
    explain,
    denseVectorMode,
    backendArg,
    lancedbConfig,
    tantivyConfig,
    sparseBackend
  };
}
