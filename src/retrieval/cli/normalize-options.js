import { getVectorExtensionConfig } from '../../../tools/vector-extension.js';
import { normalizeHnswConfig } from '../../shared/hnsw.js';
import { normalizeLanceDbConfig } from '../../shared/lancedb.js';
import { normalizeEmbeddingProvider, normalizeOnnxConfig } from '../../shared/onnx-embeddings.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';
import { resolveFtsWeights } from '../fts.js';
import { parseJson } from '../query-cache.js';
import { parseChurnArg, parseModifiedArgs } from '../query-parse.js';
import {
  mergeExtFilters,
  normalizeExtFilter,
  normalizeLangFilter,
  parseFilterExpression,
  parseMetaFilters
} from '../filters.js';
import { resolveSearchMode } from '../cli-args.js';
import { getMissingFlagMessages, resolveBm25Defaults } from './options.js';

const normalizeOptionalNumber = (value) => (
  Number.isFinite(Number(value)) ? Number(value) : null
);

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
  metricsDir,
  policy
}) {
  const jsonOutput = argv.json === true;
  const missingValueMessages = getMissingFlagMessages(argv, rawArgs);
  const query = argv._.join(' ').trim();

  const embeddingsConfig = {};
  const embeddingProvider = normalizeEmbeddingProvider();
  const embeddingOnnx = normalizeOnnxConfig({});
  const hnswConfig = normalizeHnswConfig({});
  const lancedbConfig = normalizeLanceDbConfig({});

  const sqliteConfig = {};
  const sqliteAutoChunkThreshold = 0;
  const sqliteAutoArtifactBytes = 0;

  const postingsConfig = normalizePostingsConfig({});
  const filePrefilterConfig = {};
  const filePrefilterEnabled = true;
  const searchRegexConfig = null;
  const fileChargramN = postingsConfig.chargramMinN;

  const vectorExtension = getVectorExtensionConfig(rootDir, userConfig);

  const contextLines = Math.max(0, parseInt(argv.context, 10) || 0);
  const filterInfo = parseFilterExpression(argv.filter);
  if (filterInfo.errors && filterInfo.errors.length) {
    throw new Error(`Invalid --filter: ${filterInfo.errors.join(', ')}`);
  }
  const searchTypeEntries = [];
  if (argv.type) searchTypeEntries.push(argv.type);
  if (filterInfo.type) searchTypeEntries.push(filterInfo.type);
  const searchType = searchTypeEntries.length ? searchTypeEntries.flat() : null;
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

  const bm25K1Arg = normalizeOptionalNumber(argv['bm25-k1']);
  const bm25BArg = normalizeOptionalNumber(argv['bm25-b']);
  const bm25Defaults = resolveBm25Defaults(metricsDir, { runCode, runProse, runExtractedProse });
  const bm25K1 = bm25K1Arg
    ?? (bm25Defaults ? bm25Defaults.k1 : null)
    ?? 1.2;
  const bm25B = bm25BArg
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
  if (filterInfo.file) fileFilters.push(filterInfo.file);
  const fileFilter = fileFilters.length ? fileFilters.flat() : null;
  const caseAll = argv.case === true;
  const caseFile = argv['case-file'] === true || caseAll;
  const caseTokens = argv['case-tokens'] === true || caseAll;
  const branchFilter = argv.branch ? String(argv.branch).trim() : null;

  const argvExtFilter = mergeExtFilters(
    normalizeExtFilter(argv.ext),
    normalizeLangFilter(argv.lang)
  );
  const filterExtFilter = mergeExtFilters(
    normalizeExtFilter(filterInfo.ext),
    normalizeLangFilter(filterInfo.lang)
  );
  const extFilter = mergeExtFilters(argvExtFilter, filterExtFilter);
  const metaFilters = parseMetaFilters(argv.meta, argv['meta-json']);

  const annFlagPresent = rawArgs.includes('--ann') || rawArgs.includes('--no-ann');
  const policyAnn = policy?.retrieval?.ann?.enabled;
  const annEnabled = annFlagPresent ? argv.ann : (policyAnn ?? true);
  const annBackendRaw = argv['ann-backend'] ?? 'lancedb';
  const annBackend = normalizeAnnBackend(annBackendRaw);

  const scoreBlendEnabled = false;
  const scoreBlendSparseWeight = 1;
  const scoreBlendAnnWeight = 1;

  const symbolBoostEnabled = true;
  const symbolBoostDefinitionWeight = 1.2;
  const symbolBoostExportWeight = 1.1;

  const minhashMaxDocs = 5000;

  const queryCacheEnabled = policy?.quality?.value ? policy.quality.value !== 'fast' : false;
  const queryCacheMaxEntries = 200;
  const queryCacheTtlMs = 0;

  const rrfEnabled = false;
  const rrfK = 60;

  const contextExpansionEnabled = false;
  const contextExpansionOptions = {
    maxPerHit: null,
    maxTotal: null,
    includeCalls: null,
    includeImports: null,
    includeExports: null,
    includeUsages: null
  };
  const contextExpansionRespectFilters = true;

  const sqliteFtsNormalize = false;
  const policyQuality = policy?.quality?.value;
  const sqliteFtsProfile = String(
    argv['fts-profile']
      || (['fast', 'balanced', 'max'].includes(policyQuality) ? policyQuality : 'balanced')
  ).toLowerCase();
  let sqliteFtsWeightsConfig = null;
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
  const denseVectorMode = 'merged';

  const backendArg = typeof argv.backend === 'string' ? argv.backend.toLowerCase() : '';

  return {
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
    fieldWeightsConfig: null,
    explain,
    denseVectorMode,
    backendArg,
    lancedbConfig
  };
}
