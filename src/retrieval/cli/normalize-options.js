import { getVectorExtensionConfig } from '../../../tools/sqlite/vector-extension.js';
import { normalizeHnswConfig } from '../../shared/hnsw.js';
import { normalizeLanceDbConfig } from '../../shared/lancedb.js';
import { normalizeEmbeddingProvider, normalizeOnnxConfig } from '../../shared/onnx-embeddings.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';
import { resolveFtsWeights } from '../fts.js';
import { parseJson } from '../query-cache.js';
import { parseChurnArg, parseModifiedArgs } from '../query-parse.js';
import { normalizeAnnBackend } from '../ann/normalize-backend.js';
import {
  mergeExtFilters,
  mergeLangFilters,
  normalizeExtFilter,
  normalizeLangFilter,
  parseFilterExpression,
  parseMetaFilters
} from '../filters.js';
import { resolveSearchMode } from '../cli-args.js';
import { getMissingFlagMessages, resolveBm25Defaults } from './options.js';
import { normalizeOptionalNumber } from '../../shared/limits.js';

export const OP_CONFIG_GUARDRAIL_CODES = Object.freeze({
  ANN_CANDIDATE_BOUNDS_INVALID: 'op_guardrail_ann_candidate_bounds_invalid',
  ANN_CANDIDATE_CAP_OUT_OF_RANGE: 'op_guardrail_ann_candidate_cap_out_of_range',
  RRF_K_INVALID: 'op_guardrail_rrf_k_invalid'
});

export const OP_RETRIEVAL_DEFAULTS = Object.freeze({
  annCandidateCap: 20000,
  annCandidateMinDocCount: 100,
  annCandidateMaxDocCount: 20000,
  queryCacheMaxEntries: 200,
  queryCacheTtlMs: 0,
  rrfK: 60
});

const buildGuardrailError = (code, message) => {
  const error = new Error(`[${code}] ${message}`);
  error.guardrailCode = code;
  return error;
};

/**
 * Reject risky retrieval knob combinations early with stable guardrail codes.
 * @param {{
 *   annCandidateCap:number,
 *   annCandidateMinDocCount:number,
 *   annCandidateMaxDocCount:number,
 *   rrfK:number
 * }} input
 */
const validateOperationalGuardrails = ({
  annCandidateCap,
  annCandidateMinDocCount,
  annCandidateMaxDocCount,
  rrfK
}) => {
  if (annCandidateMinDocCount > annCandidateMaxDocCount) {
    throw buildGuardrailError(
      OP_CONFIG_GUARDRAIL_CODES.ANN_CANDIDATE_BOUNDS_INVALID,
      'retrieval.annCandidateMinDocCount cannot exceed retrieval.annCandidateMaxDocCount.'
    );
  }
  if (annCandidateCap < annCandidateMinDocCount || annCandidateCap > annCandidateMaxDocCount) {
    throw buildGuardrailError(
      OP_CONFIG_GUARDRAIL_CODES.ANN_CANDIDATE_CAP_OUT_OF_RANGE,
      'retrieval.annCandidateCap must stay within [annCandidateMinDocCount, annCandidateMaxDocCount].'
    );
  }
  if (!Number.isFinite(rrfK) || rrfK <= 0) {
    throw buildGuardrailError(
      OP_CONFIG_GUARDRAIL_CODES.RRF_K_INVALID,
      'search.rrf.k must be a positive number.'
    );
  }
};

const normalizeDenseVectorMode = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed === 'merged' || trimmed === 'code' || trimmed === 'doc' || trimmed === 'auto') {
    return trimmed;
  }
  return null;
};

/**
 * Normalize raw CLI/config/policy input into a validated retrieval options
 * object consumed by the runtime pipeline.
 * Precedence: explicit CLI flags override config defaults, and policy guards
 * constrain unsafe values before execution.
 *
 * @param {object} input
 * @returns {object}
 */
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

  const embeddingsConfig = userConfig?.indexing?.embeddings || {};
  const embeddingProvider = normalizeEmbeddingProvider(embeddingsConfig.provider, { strict: true });
  const embeddingOnnx = normalizeOnnxConfig(embeddingsConfig.onnx || {});
  const hnswConfig = normalizeHnswConfig(embeddingsConfig.hnsw || {});
  const lancedbConfig = normalizeLanceDbConfig(embeddingsConfig.lancedb || {});

  const sqliteConfig = {};
  const sqliteAutoChunkThreshold = normalizeOptionalNumber(
    userConfig?.search?.sqliteAutoChunkThreshold
  ) ?? 0;
  const sqliteAutoArtifactBytes = normalizeOptionalNumber(
    userConfig?.search?.sqliteAutoArtifactBytes
  ) ?? 0;

  const postingsConfig = normalizePostingsConfig(userConfig?.indexing?.postings || {});
  const filePrefilterConfig = {};
  const filePrefilterEnabled = true;
  const searchRegexConfig = null;
  const fileChargramN = postingsConfig.chargramMinN;

  const vectorExtension = getVectorExtensionConfig(rootDir, userConfig);

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

  const extFilterInfo = mergeExtFilters(
    normalizeExtFilter(argv.ext),
    normalizeExtFilter(filterInfo.ext)
  );
  const langFilterInfo = mergeLangFilters(
    normalizeLangFilter(argv.lang),
    normalizeLangFilter(filterInfo.lang)
  );
  const extFilter = extFilterInfo.values;
  const langFilter = langFilterInfo.values;
  const extImpossible = extFilterInfo.impossible;
  const langImpossible = langFilterInfo.impossible;
  const metaFilters = parseMetaFilters(argv.meta, argv['meta-json']);

  const searchConfig = userConfig?.search || {};
  const retrievalConfig = userConfig?.retrieval || {};
  const normalizePositiveInt = (value, fallback) => {
    const parsed = normalizeOptionalNumber(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.max(1, Math.floor(parsed));
  };
  const maxCandidates = normalizeOptionalNumber(searchConfig.maxCandidates);
  const annFlagPresent = rawArgs.includes('--ann') || rawArgs.includes('--no-ann');
  const policyAnn = policy?.retrieval?.ann?.enabled;
  const annDefault = typeof searchConfig.annDefault === 'boolean'
    ? searchConfig.annDefault
    : null;
  const annEnabled = annFlagPresent ? argv.ann : (annDefault ?? policyAnn ?? true);
  const allowSparseFallback = argv['allow-sparse-fallback'] === true
    || argv.allowSparseFallback === true;
  const allowUnsafeMix = argv['allow-unsafe-mix'] === true
    || argv.allowUnsafeMix === true;
  const annBackendRaw = argv['ann-backend'] ?? argv.annBackend;
  const annBackend = annBackendRaw == null
    ? 'lancedb'
    : normalizeAnnBackend(annBackendRaw, { strict: true, defaultBackend: null });
  if (annBackendRaw != null && !annBackend) {
    throw new Error(`Invalid --ann-backend "${annBackendRaw}". Use auto|lancedb|sqlite|hnsw|js.`);
  }
  if (annBackend === 'hnsw') {
    hnswConfig.enabled = true;
  } else if (annBackend === 'lancedb') {
    lancedbConfig.enabled = true;
  }

  const scoreBlendConfig = searchConfig.scoreBlend || {};
  const scoreBlendEnabled = scoreBlendConfig.enabled === true;
  const scoreBlendSparseWeight = normalizeOptionalNumber(scoreBlendConfig.sparseWeight) ?? 1;
  const scoreBlendAnnWeight = normalizeOptionalNumber(scoreBlendConfig.annWeight) ?? 1;

  const symbolBoostEnabled = true;
  const symbolBoostDefinitionWeight = 1.2;
  const symbolBoostExportWeight = 1.1;
  const relationBoostConfigRaw = retrievalConfig?.relationBoost || {};
  const relationBoostEnabled = relationBoostConfigRaw.enabled === true;
  const relationBoostPerCall = Number.isFinite(Number(relationBoostConfigRaw.perCall))
    && Number(relationBoostConfigRaw.perCall) > 0
    ? Number(relationBoostConfigRaw.perCall)
    : 0.25;
  const relationBoostPerUse = Number.isFinite(Number(relationBoostConfigRaw.perUse))
    && Number(relationBoostConfigRaw.perUse) > 0
    ? Number(relationBoostConfigRaw.perUse)
    : 0.1;
  const relationBoostMaxBoost = Number.isFinite(Number(relationBoostConfigRaw.maxBoost))
    && Number(relationBoostConfigRaw.maxBoost) > 0
    ? Number(relationBoostConfigRaw.maxBoost)
    : 1.5;
  const annCandidateCap = normalizePositiveInt(
    retrievalConfig.annCandidateCap,
    OP_RETRIEVAL_DEFAULTS.annCandidateCap
  );
  const annCandidateMinDocCount = normalizePositiveInt(
    retrievalConfig.annCandidateMinDocCount,
    OP_RETRIEVAL_DEFAULTS.annCandidateMinDocCount
  );
  const annCandidateMaxDocCount = normalizePositiveInt(
    retrievalConfig.annCandidateMaxDocCount,
    OP_RETRIEVAL_DEFAULTS.annCandidateMaxDocCount
  );

  const minhashMaxDocs = 5000;

  const queryCacheEnabled = policy?.quality?.value ? policy.quality.value !== 'fast' : false;
  const queryCacheMaxEntries = OP_RETRIEVAL_DEFAULTS.queryCacheMaxEntries;
  const queryCacheTtlMs = OP_RETRIEVAL_DEFAULTS.queryCacheTtlMs;

  const rrfConfig = searchConfig.rrf || {};
  const policyRrfEnabled = policy?.retrieval?.rrf?.enabled;
  const rrfEnabled = typeof rrfConfig.enabled === 'boolean'
    ? rrfConfig.enabled
    : (policyRrfEnabled ?? true);
  const rrfK = normalizeOptionalNumber(rrfConfig.k)
    ?? normalizeOptionalNumber(policy?.retrieval?.rrf?.k)
    ?? OP_RETRIEVAL_DEFAULTS.rrfK;
  validateOperationalGuardrails({
    annCandidateCap,
    annCandidateMinDocCount,
    annCandidateMaxDocCount,
    rrfK
  });

  const graphRankingRaw = userConfig?.retrieval?.graphRanking || {};
  const graphRankingEnabled = graphRankingRaw.enabled === true;
  const graphRankingWeights = graphRankingRaw.weights || {};
  const graphRankingExpansionRaw = graphRankingRaw.expansion || {};
  const graphRankingSeedSelectionRaw = argv['graph-ranking-seeds'] ?? graphRankingRaw.seedSelection;
  const graphRankingSeedSelection = graphRankingSeedSelectionRaw
    ? String(graphRankingSeedSelectionRaw).trim()
    : null;
  if (graphRankingSeedSelection && !['top1', 'topK', 'none'].includes(graphRankingSeedSelection)) {
    throw new Error(`Invalid --graph-ranking-seeds "${graphRankingSeedSelection}". Use top1|topK|none.`);
  }
  const graphRankingConfig = {
    enabled: graphRankingEnabled,
    weights: graphRankingWeights,
    maxGraphWorkUnits: normalizeOptionalNumber(
      argv['graph-ranking-max-work'] ?? graphRankingRaw.maxGraphWorkUnits
    ),
    maxWallClockMs: normalizeOptionalNumber(
      argv['graph-ranking-max-ms'] ?? graphRankingRaw.maxWallClockMs
    ),
    seedSelection: graphRankingSeedSelection ?? graphRankingRaw.seedSelection ?? 'top1',
    seedK: normalizeOptionalNumber(argv['graph-ranking-seed-k'] ?? graphRankingRaw.seedK),
    expansion: {
      maxDepth: normalizeOptionalNumber(graphRankingExpansionRaw.maxDepth) ?? 2,
      maxWidthPerNode: normalizeOptionalNumber(graphRankingExpansionRaw.maxWidthPerNode) ?? 12,
      maxVisitedNodes: normalizeOptionalNumber(graphRankingExpansionRaw.maxVisitedNodes) ?? 192
    }
  };

  const contextExpansionConfig = userConfig?.retrieval?.contextExpansion || {};
  const contextExpansionEnabled = contextExpansionConfig.enabled === true;
  const contextExpansionOptions = {
    maxPerHit: normalizeOptionalNumber(contextExpansionConfig.maxPerHit),
    maxTotal: normalizeOptionalNumber(contextExpansionConfig.maxTotal),
    includeCalls: contextExpansionConfig.includeCalls ?? null,
    includeImports: contextExpansionConfig.includeImports ?? null,
    includeExports: contextExpansionConfig.includeExports ?? null,
    includeUsages: contextExpansionConfig.includeUsages ?? null,
    maxWorkUnits: normalizeOptionalNumber(contextExpansionConfig.maxWorkUnits),
    maxWallClockMs: normalizeOptionalNumber(contextExpansionConfig.maxWallClockMs),
    maxCallEdges: normalizeOptionalNumber(contextExpansionConfig.maxCallEdges),
    maxUsageEdges: normalizeOptionalNumber(contextExpansionConfig.maxUsageEdges),
    maxImportEdges: normalizeOptionalNumber(contextExpansionConfig.maxImportEdges),
    maxExportEdges: normalizeOptionalNumber(contextExpansionConfig.maxExportEdges),
    maxNameCandidates: normalizeOptionalNumber(contextExpansionConfig.maxNameCandidates),
    maxReasons: normalizeOptionalNumber(contextExpansionConfig.maxReasons)
  };
  const contextExpansionRespectFilters = contextExpansionConfig.respectFilters !== false;

  const sqliteFtsNormalize = false;
  const policyQuality = policy?.quality?.value;
  const sqliteFtsProfile = String(
    argv['fts-profile']
      || (['fast', 'balanced', 'max'].includes(policyQuality) ? policyQuality : 'balanced')
  ).toLowerCase();
  let sqliteFtsWeightsConfig = searchConfig.sqliteFtsWeights ?? null;
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
  const sqliteFtsTrigram = argv['fts-trigram'] === true;
  const sqliteFtsStemming = argv['fts-stemming'] === true
    || userConfig?.search?.sqliteFtsStemming === true;

  const explain = argv.explain === true || argv.why === true;
  const configDenseVectorRaw = userConfig?.search?.denseVectorMode;
  const configDenseVectorMode = normalizeDenseVectorMode(configDenseVectorRaw) || 'merged';
  const cliDenseVectorRaw = argv['dense-vector-mode'];
  const cliDenseVectorMode = cliDenseVectorRaw != null
    ? normalizeDenseVectorMode(cliDenseVectorRaw)
    : null;
  if (cliDenseVectorRaw != null && !cliDenseVectorMode) {
    throw new Error(`Invalid --dense-vector-mode "${cliDenseVectorRaw}". Use merged|code|doc|auto.`);
  }
  const configDenseVectorExplicit = typeof configDenseVectorRaw === 'string' && configDenseVectorRaw.trim();
  if (cliDenseVectorMode && configDenseVectorExplicit && cliDenseVectorMode !== configDenseVectorMode) {
    console.warn(
      `[search] Ignoring config search.denseVectorMode=${configDenseVectorMode}; CLI --dense-vector-mode=${cliDenseVectorMode} takes precedence.`
    );
  }
  const denseVectorMode = cliDenseVectorMode || configDenseVectorMode;
  const strict = argv['non-strict'] ? false : true;

  const backendArg = typeof argv.backend === 'string' ? argv.backend.toLowerCase() : '';

  return {
    jsonOutput,
    missingValueMessages,
    query,
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
    langFilter,
    extImpossible,
    langImpossible,
    metaFilters,
    annEnabled,
    annFlagPresent,
    allowSparseFallback,
    allowUnsafeMix,
    annBackend,
    scoreBlendEnabled,
    scoreBlendSparseWeight,
    scoreBlendAnnWeight,
    symbolBoostEnabled,
    symbolBoostDefinitionWeight,
    symbolBoostExportWeight,
    relationBoostEnabled,
    relationBoostPerCall,
    relationBoostPerUse,
    relationBoostMaxBoost,
    annCandidateCap,
    annCandidateMinDocCount,
    annCandidateMaxDocCount,
    minhashMaxDocs,
    maxCandidates,
    queryCacheEnabled,
    queryCacheMaxEntries,
    queryCacheTtlMs,
    rrfEnabled,
    rrfK,
    graphRankingConfig,
    contextExpansionEnabled,
    contextExpansionOptions,
    contextExpansionRespectFilters,
    sqliteFtsNormalize,
    sqliteFtsProfile,
    sqliteFtsWeights,
    sqliteFtsTrigram,
    sqliteFtsStemming,
    fieldWeightsConfig: searchConfig.fieldWeights || null,
    explain,
    denseVectorMode,
    strict,
    backendArg,
    lancedbConfig
  };
}
