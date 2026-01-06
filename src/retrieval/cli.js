/**
 * Ultra-Complete Search Utility for Rich Semantic Index (Pretty Output)
 * By: ChatGPT & Nick, 2025
 *   [--calls function]  Filter for call relationships (calls to/from function)
 *   [--uses ident]      Filter for usage of identifier
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import simpleGit from 'simple-git';
import {
  applyAdaptiveDictConfig,
  DEFAULT_MODEL_ID,
  getCacheRuntimeConfig,
  getDictConfig,
  getIndexDir,
  getMetricsDir,
  getModelConfig,
  loadUserConfig,
  resolveRepoRoot,
  resolveLmdbPaths,
  resolveSqlitePaths
} from '../../tools/dict-utils.js';
import { getEnvConfig } from '../shared/env.js';
import { createError, ERROR_CODES, isErrorCode } from '../shared/error-codes.js';
import { normalizeEmbeddingProvider, normalizeOnnxConfig } from '../shared/onnx-embeddings.js';
import { normalizeHnswConfig } from '../shared/hnsw.js';
import { resolveBackendPolicy } from '../storage/backend-policy.js';
import { getVectorExtensionConfig, queryVectorAnn } from '../../tools/vector-extension.js';
import { getSearchUsage, parseSearchArgs, resolveSearchMode } from './cli-args.js';
import { loadDictionary } from './cli-dictionary.js';
import { buildQueryCacheKey, getIndexSignature, loadIndex, requireIndexDir, resolveIndexDir } from './cli-index.js';
import { createLmdbBackend } from './cli-lmdb.js';
import { createSqliteBackend, getSqliteChunkCount } from './cli-sqlite.js';
import { resolveFtsWeights } from './fts.js';
import { getQueryEmbedding } from './embedding.js';
import { loadQueryCache, parseJson, pruneQueryCache } from './query-cache.js';
import { hasActiveFilters, mergeExtFilters, normalizeExtFilter, normalizeLangFilter, parseMetaFilters } from './filters.js';
import { configureOutputCaches, filterChunks, formatFullChunk, formatShortChunk, getOutputCacheReporter } from './output.js';
import { parseChurnArg, parseModifiedArgs, parseQueryInput, tokenizePhrase, tokenizeQueryTerms, buildPhraseNgrams } from './query-parse.js';
import { classifyQuery, resolveIntentFieldWeights, resolveIntentVectorMode } from './query-intent.js';
import { normalizePostingsConfig } from '../shared/postings-config.js';
import { expandContext } from './context-expansion.js';
import { createLmdbHelpers } from './lmdb-helpers.js';
import { createSqliteHelpers } from './sqlite-helpers.js';
import { createSearchPipeline } from './pipeline.js';
import { createSearchTelemetry } from './cli/telemetry.js';
import { incCacheEvent } from '../shared/metrics.js';
import { buildHighlightRegex } from './cli/highlight.js';
import { estimateIndexBytes, getMissingFlagMessages, loadBranchFromMetrics, resolveBm25Defaults, resolveIndexedFileCount } from './cli/options.js';
import { hasIndexMeta, hasLmdbStore, loadFileRelations, loadIndexCached, loadRepoMap, resolveDenseVector, warnPendingState } from './cli/index-loader.js';
import { compactHit } from './cli/render-output.js';
import { runSearchByMode } from './cli/search-runner.js';

export async function runSearchCli(rawArgs = process.argv.slice(2), options = {}) {
  const argv = parseSearchArgs(rawArgs);
  const jsonCompact = argv['json-compact'] === true;
  const jsonOutput = argv.json || jsonCompact;
  const telemetry = createSearchTelemetry();
  const recordSearchMetrics = (status) => telemetry.record(status);
  const emitOutput = options.emitOutput !== false;
  const exitOnError = options.exitOnError !== false;
  const indexCache = options.indexCache || null;
  const sqliteCache = options.sqliteCache || null;
  const t0 = Date.now();
  const rootOverride = options.root ? path.resolve(options.root) : null;
  const rootArg = rootOverride || (argv.repo ? path.resolve(argv.repo) : null);
  const ROOT = rootArg || resolveRepoRoot(process.cwd());
  const userConfig = loadUserConfig(ROOT);
  const emitError = (message, errorCode) => {
    if (!emitOutput || !message) return;
    if (jsonOutput) {
      console.log(JSON.stringify({ ok: false, code: errorCode, message }, null, 2));
    } else {
      console.error(message);
    }
  };
  const bail = (message, code = 1, errorCode = ERROR_CODES.INTERNAL) => {
    const resolvedCode = isErrorCode(errorCode) ? errorCode : ERROR_CODES.INTERNAL;
    emitError(message, resolvedCode);
    if (exitOnError) process.exit(code);
    recordSearchMetrics('error');
    const error = createError(resolvedCode, message || 'Search failed.');
    error.emitted = true;
    throw error;
  };
  const missingValueMessages = getMissingFlagMessages(argv);
  if (missingValueMessages.length) {
    return bail(missingValueMessages.join('\n'), 1, ERROR_CODES.INVALID_REQUEST);
  }
  const cacheConfig = getCacheRuntimeConfig(ROOT, userConfig);
  const envConfig = getEnvConfig();
  const embeddingsConfig = userConfig.indexing?.embeddings || {};
  const embeddingProvider = normalizeEmbeddingProvider(embeddingsConfig.provider);
  const embeddingOnnx = normalizeOnnxConfig(embeddingsConfig.onnx || {});
  const hnswConfig = normalizeHnswConfig(embeddingsConfig.hnsw || {});
  const verboseCache = envConfig.verbose === true;
  const cacheLog = verboseCache ? (msg) => process.stderr.write(`\n${msg}\n`) : null;
  configureOutputCaches({ cacheConfig, verbose: verboseCache, log: cacheLog });
const modelConfig = getModelConfig(ROOT, userConfig);
const modelIdDefault = argv.model || modelConfig.id || DEFAULT_MODEL_ID;
const sqliteConfig = userConfig.sqlite || {};
const sqliteAutoChunkThresholdRaw = userConfig.search?.sqliteAutoChunkThreshold;
const sqliteAutoChunkThreshold = Number.isFinite(Number(sqliteAutoChunkThresholdRaw))
  ? Math.max(0, Number(sqliteAutoChunkThresholdRaw))
  : 0;
const postingsConfig = normalizePostingsConfig(userConfig.indexing?.postings || {});
const filePrefilterConfig = userConfig.search?.filePrefilter || {};
const filePrefilterEnabled = filePrefilterConfig.enabled !== false;
const searchRegexConfig = userConfig.search?.regex || null;
const fileChargramN = Number.isFinite(Number(filePrefilterConfig.chargramN))
  ? Math.max(2, Math.floor(Number(filePrefilterConfig.chargramN)))
  : postingsConfig.chargramMinN;
const vectorExtension = getVectorExtensionConfig(ROOT, userConfig);
const bm25Config = userConfig.search?.bm25 || {};
const bm25K1Arg = Number.isFinite(Number(argv['bm25-k1'])) ? Number(argv['bm25-k1']) : null;
const bm25BArg = Number.isFinite(Number(argv['bm25-b'])) ? Number(argv['bm25-b']) : null;
const rrfConfig = userConfig.search?.rrf || {};
const rrfEnabled = rrfConfig.enabled !== false;
const rrfK = Number.isFinite(Number(rrfConfig.k)) ? Math.max(1, Number(rrfConfig.k)) : 60;
const fieldWeightsConfig = userConfig.search?.fieldWeights;
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
const sqliteFtsProfile = (argv['fts-profile'] || envConfig.ftsProfile || userConfig.search?.sqliteFtsProfile || 'balanced').toLowerCase();
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
const metricsDir = getMetricsDir(ROOT, userConfig);
const useStubEmbeddings = envConfig.embeddings === 'stub';
const query = argv._.join(' ').trim();
if (!query) {
  return bail(getSearchUsage(), 1, ERROR_CODES.INVALID_REQUEST);
}
const contextLines = Math.max(0, parseInt(argv.context, 10) || 0);
const searchType = argv.type || null;
const searchAuthor = argv.author || null;
const searchImport = argv.import || null;
const chunkAuthorFilter = argv['chunk-author'] || null;
let searchModeInfo;
try {
  searchModeInfo = resolveSearchMode(argv.mode);
} catch (err) {
  return bail(err.message, 1, ERROR_CODES.INVALID_REQUEST);
}
  const {
    searchMode,
    runCode,
    runProse,
    runRecords,
    runExtractedProse: runExtractedProseRaw
  } = searchModeInfo;
  telemetry.setMode(searchMode);
  let runExtractedProse = runExtractedProseRaw;
  const bm25Defaults = resolveBm25Defaults(metricsDir, { runCode, runProse, runExtractedProse });
const bm25K1 = bm25K1Arg
  ?? (Number.isFinite(Number(bm25Config.k1)) ? Number(bm25Config.k1) : null)
  ?? (bm25Defaults ? bm25Defaults.k1 : null)
  ?? 1.2;
const bm25B = bm25BArg
  ?? (Number.isFinite(Number(bm25Config.b)) ? Number(bm25Config.b) : null)
  ?? (bm25Defaults ? bm25Defaults.b : null)
  ?? 0.75;
const branchesMin = Number.isFinite(Number(argv.branches)) ? Number(argv.branches) : null;
const loopsMin = Number.isFinite(Number(argv.loops)) ? Number(argv.loops) : null;
const breaksMin = Number.isFinite(Number(argv.breaks)) ? Number(argv.breaks) : null;
const continuesMin = Number.isFinite(Number(argv.continues)) ? Number(argv.continues) : null;
let churnMin = null;
try {
  churnMin = parseChurnArg(argv.churn);
} catch (err) {
  return bail(err.message, 1, ERROR_CODES.INVALID_REQUEST);
}
let modifiedArgs;
try {
  modifiedArgs = parseModifiedArgs(argv['modified-after'], argv['modified-since']);
} catch (err) {
  return bail(err.message, 1, ERROR_CODES.INVALID_REQUEST);
}
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
  const lmdbPaths = resolveLmdbPaths(ROOT, userConfig);
  const lmdbCodePath = lmdbPaths.codePath;
  const lmdbProsePath = lmdbPaths.prosePath;
  const sqlitePaths = resolveSqlitePaths(ROOT, userConfig);
  const sqliteCodePath = sqlitePaths.codePath;
  const sqliteProsePath = sqlitePaths.prosePath;
  const loadIndexState = (mode) => {
    try {
      const dir = resolveIndexDir(ROOT, mode, userConfig);
      const statePath = path.join(dir, 'index_state.json');
      if (!fsSync.existsSync(statePath)) return null;
      return JSON.parse(fsSync.readFileSync(statePath, 'utf8'));
    } catch {
      return null;
    }
  };
  const isSqliteReady = (state) => {
    if (!state?.sqlite) return true;
    return state.sqlite.ready !== false && state.sqlite.pending !== true;
  };
  const isLmdbReady = (state) => {
    if (!state?.lmdb) return true;
    return state.lmdb.ready !== false && state.lmdb.pending !== true;
  };

  const needsCode = runCode;
  const needsProse = runProse;
  const backendArg = typeof argv.backend === 'string' ? argv.backend.toLowerCase() : '';
  const sqliteScoreModeConfig = sqliteConfig.scoreMode === 'fts';
  const sqliteConfigured = sqliteConfig.use !== false;
  const sqliteStateCode = needsCode ? loadIndexState('code') : null;
  const sqliteStateProse = needsProse ? loadIndexState('prose') : null;
  const sqliteCodeAvailable = fsSync.existsSync(sqliteCodePath) && isSqliteReady(sqliteStateCode);
  const sqliteProseAvailable = fsSync.existsSync(sqliteProsePath) && isSqliteReady(sqliteStateProse);
  const sqliteAvailable = (!needsCode || sqliteCodeAvailable) && (!needsProse || sqliteProseAvailable);
  const lmdbConfigured = userConfig.lmdb?.use !== false;
  const lmdbStateCode = sqliteStateCode;
  const lmdbStateProse = sqliteStateProse;
  const lmdbCodeAvailable = hasLmdbStore(lmdbCodePath) && isLmdbReady(lmdbStateCode);
  const lmdbProseAvailable = hasLmdbStore(lmdbProsePath) && isLmdbReady(lmdbStateProse);
  const lmdbAvailable = (!needsCode || lmdbCodeAvailable) && (!needsProse || lmdbProseAvailable);
const annFlagPresent = rawArgs.includes('--ann') || rawArgs.includes('--no-ann');
const annDefault = userConfig.search?.annDefault !== false;
const annEnabled = annFlagPresent ? argv.ann : annDefault;
telemetry.setAnn(annEnabled ? 'on' : 'off');
const vectorAnnEnabled = annEnabled && vectorExtension.enabled;
const scoreBlendConfig = userConfig.search?.scoreBlend || {};
const scoreBlendEnabled = scoreBlendConfig.enabled === true;
const scoreBlendSparseWeight = Number.isFinite(Number(scoreBlendConfig.sparseWeight))
  ? Number(scoreBlendConfig.sparseWeight)
  : 1;
const scoreBlendAnnWeight = Number.isFinite(Number(scoreBlendConfig.annWeight))
  ? Number(scoreBlendConfig.annWeight)
  : 1;
const symbolBoostConfig = userConfig.search?.symbolBoost || {};
const symbolBoostEnabled = symbolBoostConfig.enabled !== false;
const symbolBoostDefinitionWeight = Number.isFinite(Number(symbolBoostConfig.definitionWeight))
  ? Number(symbolBoostConfig.definitionWeight)
  : 1.2;
const symbolBoostExportWeight = Number.isFinite(Number(symbolBoostConfig.exportWeight))
  ? Number(symbolBoostConfig.exportWeight)
  : 1.1;
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
const queryCachePath = path.join(metricsDir, 'queryCache.json');
const explain = argv.explain === true || argv.why === true;
const denseVectorMode = typeof userConfig.search?.denseVectorMode === 'string'
  ? userConfig.search.denseVectorMode.toLowerCase()
  : 'merged';

const sqliteAutoArtifactBytesRaw = userConfig.search?.sqliteAutoArtifactBytes;
const sqliteAutoArtifactBytes = Number.isFinite(Number(sqliteAutoArtifactBytesRaw))
  ? Math.max(0, Number(sqliteAutoArtifactBytesRaw))
  : 0;
const sqliteFtsWeights = resolveFtsWeights(sqliteFtsProfile, sqliteFtsWeightsConfig);
const needsSqlite = runCode || runProse;
let chunkCounts = [];
let artifactBytes = [];
if (needsSqlite && (!backendArg || backendArg === 'auto')) {
  if (sqliteAutoChunkThreshold > 0) {
    if (needsCode) chunkCounts.push(await getSqliteChunkCount(sqliteCodePath, 'code'));
    if (needsProse) chunkCounts.push(await getSqliteChunkCount(sqliteProsePath, 'prose'));
  }
  if (sqliteAutoArtifactBytes > 0) {
    if (needsCode) artifactBytes.push(estimateIndexBytes(getIndexDir(ROOT, 'code', userConfig)));
    if (needsProse) artifactBytes.push(estimateIndexBytes(getIndexDir(ROOT, 'prose', userConfig)));
  }
}
const backendPolicy = resolveBackendPolicy({
  backendArg,
  sqliteScoreModeConfig,
  sqliteConfigured,
  sqliteAvailable,
  lmdbConfigured,
  lmdbAvailable,
  sqliteAutoChunkThreshold,
  sqliteAutoArtifactBytes,
  needsSqlite,
  chunkCounts,
  artifactBytes
});
if (backendPolicy.error) {
  const missing = [];
  if (backendPolicy.backendLabel === 'lmdb') {
    if (needsCode && !lmdbCodeAvailable) missing.push(`code=${lmdbCodePath}`);
    if (needsProse && !lmdbProseAvailable) missing.push(`prose=${lmdbProsePath}`);
  } else {
    if (needsCode && !sqliteCodeAvailable) missing.push(`code=${sqliteCodePath}`);
    if (needsProse && !sqliteProseAvailable) missing.push(`prose=${sqliteProsePath}`);
  }
  const suffix = missing.length
    ? missing.join(', ')
    : (backendPolicy.backendLabel === 'lmdb' ? 'missing lmdb index' : 'missing sqlite index');
  return bail(`${backendPolicy.error} (${suffix}).`);
}
if (!needsSqlite && backendPolicy.backendForcedSqlite) {
  console.warn('SQLite backend requested, but records-only mode selected; using file-backed records index.');
}
if (!needsSqlite && backendPolicy.backendForcedLmdb) {
  console.warn('LMDB backend requested, but records-only mode selected; using file-backed records index.');
}
if (backendPolicy.backendDisabled) {
  console.warn(`Unknown backend "${backendArg}". Falling back to memory.`);
}
let useSqlite = backendPolicy.useSqlite;
let useLmdb = backendPolicy.useLmdb;
const sqliteFtsRequested = backendPolicy.sqliteFtsRequested;
const backendForcedSqlite = backendPolicy.backendForcedSqlite;
const backendForcedLmdb = backendPolicy.backendForcedLmdb;
if (useLmdb) {
  useSqlite = false;
}
const lmdbBackend = await createLmdbBackend({
  useLmdb,
  needsCode,
  needsProse,
  lmdbCodePath,
  lmdbProsePath,
  backendForcedLmdb,
  lmdbStates: {
    code: lmdbStateCode,
    prose: lmdbStateProse
  }
});
useLmdb = lmdbBackend.useLmdb;

const sqliteBackend = await createSqliteBackend({
  useSqlite,
  needsCode,
  needsProse,
  sqliteCodePath,
  sqliteProsePath,
  sqliteFtsRequested,
  backendForcedSqlite,
  vectorExtension,
  vectorAnnEnabled,
  dbCache: sqliteCache,
  sqliteStates: {
    code: sqliteStateCode,
    prose: sqliteStateProse
  }
});
useSqlite = sqliteBackend.useSqlite;
let dbCode = sqliteBackend.dbCode;
let dbProse = sqliteBackend.dbProse;
let lmdbCode = lmdbBackend.dbCode;
let lmdbProse = lmdbBackend.dbProse;
if (useSqlite) {
  useLmdb = false;
  lmdbCode = null;
  lmdbProse = null;
}
const vectorAnnState = sqliteBackend.vectorAnnState;
const vectorAnnUsed = sqliteBackend.vectorAnnUsed;
const backendLabel = useSqlite
  ? (sqliteFtsRequested ? 'sqlite-fts' : 'sqlite')
  : (useLmdb ? 'lmdb' : 'memory');
telemetry.setBackend(backendLabel);
const backendPolicyInfo = { ...backendPolicy, backendLabel };
let modelIdForCode = null;
let modelIdForProse = null;
let modelIdForExtractedProse = null;
let modelIdForRecords = null;

async function resolveRepoBranch() {
  const fromMetrics = runCode ? loadBranchFromMetrics(metricsDir, 'code') : null;
  const fromProse = !fromMetrics && runProse ? loadBranchFromMetrics(metricsDir, 'prose') : null;
  if (fromMetrics || fromProse) return fromMetrics || fromProse;
  try {
    const git = simpleGit(ROOT);
    const status = await git.status();
    return status.current || null;
  } catch {
    return null;
  }
}

const repoBranch = branchFilter ? await resolveRepoBranch() : null;
if (branchFilter) {
  const normalizedBranch = caseFile ? branchFilter : branchFilter.toLowerCase();
  const normalizedRepo = repoBranch ? (caseFile ? repoBranch : repoBranch.toLowerCase()) : null;
  const branchMatches = normalizedRepo ? normalizedRepo === normalizedBranch : true;
  if (repoBranch && !branchMatches) {
    const payload = {
      backend: backendLabel,
      prose: [],
      code: [],
      records: [],
      stats: {
        branch: repoBranch,
        branchFilter,
        branchMatch: false,
        backendPolicy: backendPolicyInfo
      }
    };
    if (emitOutput) {
      if (jsonOutput) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(`Branch filter ${branchFilter} did not match current branch ${repoBranch}; returning no results.`);
      }
    }
    recordSearchMetrics('ok');
    return payload;
  }
  if (!repoBranch) {
    console.warn('Branch filter requested but repo branch is unavailable; continuing without branch validation.');
  }
}

/**
 * Return the active SQLite connection for a mode.
 * @param {'code'|'prose'|'extracted-prose'} mode
 * @returns {import('better-sqlite3').Database|null}
 */
function getSqliteDb(mode) {
  if (!useSqlite) return null;
  if (mode === 'code') return dbCode;
  if (mode === 'prose') return dbProse;
  return null;
}

function getLmdbDb(mode) {
  if (!useLmdb) return null;
  if (mode === 'code') return lmdbCode;
  if (mode === 'prose') return lmdbProse;
  return null;
}

const sqliteHelpers = createSqliteHelpers({
  getDb: getSqliteDb,
  postingsConfig,
  sqliteFtsWeights,
  vectorExtension,
  vectorAnnState,
  queryVectorAnn,
  modelIdDefault,
  fileChargramN
});
const lmdbIndexDirs = {
  code: resolveIndexDir(ROOT, 'code', userConfig),
  prose: resolveIndexDir(ROOT, 'prose', userConfig)
};
const lmdbHelpers = createLmdbHelpers({
  getDb: getLmdbDb,
  hnswConfig,
  modelIdDefault,
  fileChargramN,
  indexDirs: lmdbIndexDirs
});
const {
  loadIndexFromSqlite,
  buildCandidateSetSqlite,
  getTokenIndexForQuery,
  rankSqliteFts,
  rankVectorAnnSqlite
} = sqliteHelpers;
const { loadIndexFromLmdb } = lmdbHelpers;


const dictConfigBase = getDictConfig(ROOT, userConfig);
const dictConfig = applyAdaptiveDictConfig(
  dictConfigBase,
  resolveIndexedFileCount(metricsDir, { runCode, runProse, runExtractedProse })
);
const { dict } = await loadDictionary(ROOT, dictConfig);

const color = {
  green: (t) => `\x1b[32m${t}\x1b[0m`,
  yellow: (t) => `\x1b[33m${t}\x1b[0m`,
  red: (t) => `\x1b[31m${t}\x1b[0m`,
  cyan: (t) => `\x1b[36m${t}\x1b[0m`,
  magenta: (t) => `\x1b[35m${t}\x1b[0m`,
  blue: (t) => `\x1b[34m${t}\x1b[0m`,
  gray: (t) => `\x1b[90m${t}\x1b[0m`,
  bold: (t) => `\x1b[1m${t}\x1b[0m`,
  underline: (t) => `\x1b[4m${t}\x1b[0m`
};

// --- QUERY TOKENIZATION ---
const parsedQuery = parseQueryInput(query);
const includeTokens = tokenizeQueryTerms(parsedQuery.includeTerms, dict, { ...dictConfig, caseSensitive: caseTokens });
const phraseTokens = parsedQuery.phrases
  .map((phrase) => tokenizePhrase(phrase, dict, { ...dictConfig, caseSensitive: caseTokens }))
  .filter((tokens) => tokens.length);
const phraseInfo = buildPhraseNgrams(phraseTokens, postingsConfig);
const phraseNgrams = phraseInfo.ngrams;
const phraseNgramSet = phraseNgrams.length ? new Set(phraseNgrams) : null;
const phraseRange = { min: phraseInfo.minLen, max: phraseInfo.maxLen };
const excludeTokens = tokenizeQueryTerms(parsedQuery.excludeTerms, dict, { ...dictConfig, caseSensitive: caseTokens });
const excludePhraseTokens = parsedQuery.excludePhrases
  .map((phrase) => tokenizePhrase(phrase, dict, { ...dictConfig, caseSensitive: caseTokens }))
  .filter((tokens) => tokens.length);
const excludePhraseInfo = buildPhraseNgrams(excludePhraseTokens, postingsConfig);
const excludePhraseNgrams = excludePhraseInfo.ngrams;
const excludePhraseRange = excludePhraseInfo.minLen && excludePhraseInfo.maxLen
  ? { min: excludePhraseInfo.minLen, max: excludePhraseInfo.maxLen }
  : null;
const queryTokens = [...includeTokens, ...phraseTokens.flat()];
const annActive = annEnabled && queryTokens.length > 0;
const rx = buildHighlightRegex(queryTokens);
const embeddingQueryText = [...parsedQuery.includeTerms, ...parsedQuery.phrases]
  .join(' ')
  .trim() || query;
const intentInfo = classifyQuery({
  query,
  tokens: queryTokens,
  phrases: parsedQuery.phrases,
  filters: { file: fileFilter }
});
const fieldWeights = resolveIntentFieldWeights(fieldWeightsConfig, intentInfo);
const resolvedDenseVectorMode = resolveIntentVectorMode(denseVectorMode, intentInfo);
const filters = {
  type: searchType,
  author: searchAuthor,
  importName: searchImport,
  lint: argv.lint,
  churn: churnMin,
  calls: argv.calls,
  uses: argv.uses,
  signature: argv.signature,
  param: argv.param,
  decorator: argv.decorator,
  inferredType: argv['inferred-type'],
  returnType: argv['return-type'],
  throws: argv.throws,
  reads: argv.reads,
  writes: argv.writes,
  mutates: argv.mutates,
  alias: argv.alias,
  risk: argv.risk,
  riskTag: argv['risk-tag'],
  riskSource: argv['risk-source'],
  riskSink: argv['risk-sink'],
    riskCategory: argv['risk-category'],
    riskFlow: argv['risk-flow'],
    structPack: argv['struct-pack'],
    structRule: argv['struct-rule'],
    structTag: argv['struct-tag'],
    awaits: argv.awaits,
  branches: branchesMin,
  loops: loopsMin,
  breaks: breaksMin,
  continues: continuesMin,
  visibility: argv.visibility,
  extends: argv.extends,
  async: argv.async,
  generator: argv.generator,
  returns: argv.returns,
  file: fileFilter,
  caseFile,
  caseTokens,
  regexConfig: fileFilter ? searchRegexConfig : null,
  filePrefilter: {
    enabled: filePrefilterEnabled,
    chargramN: fileChargramN
  },
  ext: extFilter,
  meta: metaFilters,
  chunkAuthor: chunkAuthorFilter,
  modifiedAfter,
  excludeTokens,
  excludePhrases: excludePhraseNgrams,
  excludePhraseRange
};
const filtersActive = hasActiveFilters(filters);
const cacheFilters = {
  type: searchType,
  author: searchAuthor,
  calls: argv.calls || null,
  uses: argv.uses || null,
  signature: argv.signature || null,
  param: argv.param || null,
  import: searchImport,
  lint: argv.lint || false,
  churn: churnMin,
  decorator: argv.decorator || null,
  inferredType: argv['inferred-type'] || null,
  returnType: argv['return-type'] || null,
  throws: argv.throws || null,
  reads: argv.reads || null,
  writes: argv.writes || null,
  mutates: argv.mutates || null,
  risk: argv.risk || null,
  riskTag: argv['risk-tag'] || null,
  riskSource: argv['risk-source'] || null,
  riskSink: argv['risk-sink'] || null,
    riskCategory: argv['risk-category'] || null,
    riskFlow: argv['risk-flow'] || null,
    structPack: argv['struct-pack'] || null,
    structRule: argv['struct-rule'] || null,
    structTag: argv['struct-tag'] || null,
    awaits: argv.awaits || null,
  visibility: argv.visibility || null,
  extends: argv.extends || null,
  async: argv.async || false,
  generator: argv.generator || false,
  returns: argv.returns || false,
  file: fileFilter || null,
  ext: extFilter || null,
  branch: branchFilter || null,
  caseFile,
  caseTokens,
  regexConfig: fileFilter ? searchRegexConfig : null,
  meta: metaFilters,
  chunkAuthor: chunkAuthorFilter || null,
  modifiedAfter,
  modifiedSinceDays
};
const sqliteLazyChunks = sqliteFtsRequested && !filtersActive;
const sqliteContextChunks = contextExpansionEnabled ? true : !sqliteLazyChunks;
const proseDir = runProse && !useSqlite
  ? requireIndexDir(ROOT, 'prose', userConfig, { emitOutput, exitOnError })
  : null;
const codeDir = runCode && !useSqlite
  ? requireIndexDir(ROOT, 'code', userConfig, { emitOutput, exitOnError })
  : null;
const recordsDir = runRecords
  ? requireIndexDir(ROOT, 'records', userConfig, { emitOutput, exitOnError })
  : null;
const loadIndexCachedLocal = (dir, includeHnsw = true) => loadIndexCached({
  indexCache,
  dir,
  modelIdDefault,
  fileChargramN,
  includeHnsw,
  hnswConfig,
  loadIndex
});
let extractedProseDir = null;
if (runExtractedProse) {
  if (searchMode === 'extracted-prose') {
    extractedProseDir = requireIndexDir(ROOT, 'extracted-prose', userConfig, { emitOutput, exitOnError });
  } else {
    extractedProseDir = resolveIndexDir(ROOT, 'extracted-prose', userConfig);
    if (!hasIndexMeta(extractedProseDir)) {
      runExtractedProse = false;
      if (emitOutput) {
        console.warn('[search] extracted-prose index not found; skipping.');
      }
    }
  }
}
const idxProse = runProse
  ? (useSqlite ? loadIndexFromSqlite('prose', {
    includeDense: annActive,
    includeMinhash: annActive,
    includeChunks: sqliteContextChunks,
    includeFilterIndex: filtersActive
  }) : (useLmdb ? loadIndexFromLmdb('prose', {
    includeDense: annActive,
    includeMinhash: annActive,
    includeChunks: true,
    includeFilterIndex: filtersActive
  }) : loadIndexCachedLocal(proseDir, annActive)))
  : { chunkMeta: [], denseVec: null, minhash: null };
const idxExtractedProse = runExtractedProse
  ? loadIndexCachedLocal(extractedProseDir, annActive)
  : { chunkMeta: [], denseVec: null, minhash: null };
const idxCode = runCode
  ? (useSqlite ? loadIndexFromSqlite('code', {
    includeDense: annActive,
    includeMinhash: annActive,
    includeChunks: sqliteContextChunks,
    includeFilterIndex: filtersActive
  }) : (useLmdb ? loadIndexFromLmdb('code', {
    includeDense: annActive,
    includeMinhash: annActive,
    includeChunks: true,
    includeFilterIndex: filtersActive
  }) : loadIndexCachedLocal(codeDir, annActive)))
  : { chunkMeta: [], denseVec: null, minhash: null };
const idxRecords = runRecords
  ? loadIndexCachedLocal(recordsDir, annActive)
  : { chunkMeta: [], denseVec: null, minhash: null };
warnPendingState(idxCode, 'code', { emitOutput, useSqlite, annActive });
warnPendingState(idxProse, 'prose', { emitOutput, useSqlite, annActive });
warnPendingState(idxExtractedProse, 'extracted-prose', { emitOutput, useSqlite, annActive });
const hnswAnnState = {
  code: { available: Boolean(idxCode?.hnsw?.available) },
  prose: { available: Boolean(idxProse?.hnsw?.available) },
  records: { available: Boolean(idxRecords?.hnsw?.available) },
  'extracted-prose': { available: Boolean(idxExtractedProse?.hnsw?.available) }
};
const hnswAnnUsed = {
  code: false,
  prose: false,
  records: false,
  'extracted-prose': false
};
 
if (runCode) {
  idxCode.denseVec = resolveDenseVector(idxCode, 'code', resolvedDenseVectorMode);
  if ((useSqlite || useLmdb) && !idxCode.fileRelations) {
    idxCode.fileRelations = loadFileRelations(ROOT, userConfig, 'code');
  }
  if ((useSqlite || useLmdb) && !idxCode.repoMap) {
    idxCode.repoMap = loadRepoMap(ROOT, userConfig, 'code');
  }
}
if (runProse) {
  idxProse.denseVec = resolveDenseVector(idxProse, 'prose', resolvedDenseVectorMode);
  if ((useSqlite || useLmdb) && !idxProse.fileRelations) {
    idxProse.fileRelations = loadFileRelations(ROOT, userConfig, 'prose');
  }
  if ((useSqlite || useLmdb) && !idxProse.repoMap) {
    idxProse.repoMap = loadRepoMap(ROOT, userConfig, 'prose');
  }
}
if (runExtractedProse) {
  idxExtractedProse.denseVec = resolveDenseVector(
    idxExtractedProse,
    'extracted-prose',
    resolvedDenseVectorMode
  );
  if (!idxExtractedProse.fileRelations) {
    idxExtractedProse.fileRelations = loadFileRelations(ROOT, userConfig, 'extracted-prose');
  }
  if (!idxExtractedProse.repoMap) {
    idxExtractedProse.repoMap = loadRepoMap(ROOT, userConfig, 'extracted-prose');
  }
}
modelIdForCode = runCode ? (idxCode?.denseVec?.model || modelIdDefault) : null;
modelIdForProse = runProse ? (idxProse?.denseVec?.model || modelIdDefault) : null;
modelIdForExtractedProse = runExtractedProse
  ? (idxExtractedProse?.denseVec?.model || modelIdDefault)
  : null;
modelIdForRecords = runRecords ? (idxRecords?.denseVec?.model || modelIdDefault) : null;
const searchPipeline = createSearchPipeline({
  useSqlite,
  sqliteFtsRequested,
  sqliteFtsNormalize,
  sqliteFtsProfile,
  sqliteFtsWeights,
  bm25K1,
  bm25B,
  fieldWeights,
  postingsConfig,
  queryTokens,
  phraseNgramSet,
  phraseRange,
  symbolBoost: {
    enabled: symbolBoostEnabled,
    definitionWeight: symbolBoostDefinitionWeight,
    exportWeight: symbolBoostExportWeight
  },
  filters,
  filtersActive,
  topN: argv.n,
  annEnabled: annActive,
  scoreBlend: {
    enabled: scoreBlendEnabled,
    sparseWeight: scoreBlendSparseWeight,
    annWeight: scoreBlendAnnWeight
  },
  rrf: {
    enabled: rrfEnabled,
    k: rrfK
  },
  minhashMaxDocs,
  vectorAnnState,
  vectorAnnUsed,
  hnswAnnState,
  hnswAnnUsed,
  buildCandidateSetSqlite,
  getTokenIndexForQuery,
  rankSqliteFts,
  rankVectorAnnSqlite
});
// --- SEARCH BM25 TOKENS/PHRASES ---


// --- MAIN ---
return await (async () => {
  let cacheHit = false;
  let cacheKey = null;
  let cacheSignature = null;
  let cacheData = null;
  let cachedPayload = null;

  if (queryCacheEnabled) {
    const signature = getIndexSignature({
      useSqlite,
      backendLabel,
      sqliteCodePath,
      sqliteProsePath,
      runRecords,
      runExtractedProse,
      root: ROOT,
      userConfig
    });
    cacheSignature = JSON.stringify(signature);
    const cacheKeyInfo = buildQueryCacheKey({
      query,
      backend: backendLabel,
      mode: searchMode,
      topN: argv.n,
      ann: annActive,
      annMode: vectorExtension.annMode,
      annProvider: vectorExtension.provider,
      annExtension: vectorAnnEnabled,
      scoreBlend: {
        enabled: scoreBlendEnabled,
        sparseWeight: scoreBlendSparseWeight,
        annWeight: scoreBlendAnnWeight
      },
      fieldWeights,
      denseVectorMode: resolvedDenseVectorMode,
      intent: intentInfo?.type || null,
      minhashMaxDocs,
      sqliteFtsNormalize,
      sqliteFtsProfile,
      sqliteFtsWeights,
      models: {
        code: modelIdForCode,
        prose: modelIdForProse,
        extractedProse: modelIdForExtractedProse,
        records: modelIdForRecords
      },
      embeddings: {
        provider: embeddingProvider,
        onnxModel: embeddingOnnx.modelPath || null,
        onnxTokenizer: embeddingOnnx.tokenizerId || null
      },
      contextExpansion: {
        enabled: contextExpansionEnabled,
        maxPerHit: contextExpansionOptions.maxPerHit || null,
        maxTotal: contextExpansionOptions.maxTotal || null,
        includeCalls: contextExpansionOptions.includeCalls !== false,
        includeImports: contextExpansionOptions.includeImports !== false,
        includeExports: contextExpansionOptions.includeExports === true,
        includeUsages: contextExpansionOptions.includeUsages === true,
        respectFilters: contextExpansionRespectFilters
      },
      filters: cacheFilters
    });
    cacheKey = cacheKeyInfo.key;
    cacheData = loadQueryCache(queryCachePath);
    const entry = cacheData.entries.find((e) => e.key === cacheKey && e.signature === cacheSignature);
    if (entry) {
      const ttl = Number.isFinite(Number(entry.ttlMs)) ? Number(entry.ttlMs) : queryCacheTtlMs;
      if (!ttl || (Date.now() - entry.ts) <= ttl) {
        cachedPayload = entry.payload || null;
        if (cachedPayload) {
          const hasCode = !runCode || Array.isArray(cachedPayload.code);
          const hasProse = !runProse || Array.isArray(cachedPayload.prose);
          const hasRecords = !runRecords || Array.isArray(cachedPayload.records);
          if (hasCode && hasProse && hasRecords) {
            cacheHit = true;
            entry.ts = Date.now();
          }
        }
      }
    }
  }
  if (queryCacheEnabled) {
    incCacheEvent({ cache: 'query', result: cacheHit ? 'hit' : 'miss' });
  }

  const needsEmbedding = !cacheHit && annActive && (
    (runProse && (idxProse.denseVec?.vectors?.length || vectorAnnState.prose.available || hnswAnnState.prose.available)) ||
    (runCode && (idxCode.denseVec?.vectors?.length || vectorAnnState.code.available || hnswAnnState.code.available)) ||
    (runExtractedProse && idxExtractedProse?.denseVec?.vectors?.length) ||
    (runRecords && idxRecords.denseVec?.vectors?.length)
  );
  const embeddingCache = new Map();
  const getEmbeddingForModel = async (modelId, dims) => {
    if (!modelId) return null;
    const cacheKey = useStubEmbeddings ? `${modelId}:${dims || 'default'}` : modelId;
    if (embeddingCache.has(cacheKey)) {
      incCacheEvent({ cache: 'embedding', result: 'hit' });
      return embeddingCache.get(cacheKey);
    }
    incCacheEvent({ cache: 'embedding', result: 'miss' });
    const embedding = await getQueryEmbedding({
      text: embeddingQueryText,
      modelId,
      dims,
      modelDir: modelConfig.dir,
      useStub: useStubEmbeddings,
      provider: embeddingProvider,
      onnxConfig: embeddingOnnx,
      rootDir: ROOT
    });
    embeddingCache.set(cacheKey, embedding);
    return embedding;
  };
  const queryEmbeddingCode = needsEmbedding && runCode && (
    idxCode.denseVec?.vectors?.length
    || vectorAnnState.code.available
    || hnswAnnState.code.available
  )
    ? await getEmbeddingForModel(modelIdForCode, idxCode.denseVec?.dims || null)
    : null;
  const queryEmbeddingProse = needsEmbedding && runProse && (
    idxProse.denseVec?.vectors?.length
    || vectorAnnState.prose.available
    || hnswAnnState.prose.available
  )
    ? await getEmbeddingForModel(modelIdForProse, idxProse.denseVec?.dims || null)
    : null;
  const queryEmbeddingExtractedProse = needsEmbedding && runExtractedProse && idxExtractedProse?.denseVec?.vectors?.length
    ? await getEmbeddingForModel(modelIdForExtractedProse, idxExtractedProse.denseVec?.dims || null)
    : null;
  const queryEmbeddingRecords = needsEmbedding && runRecords && idxRecords.denseVec?.vectors?.length
    ? await getEmbeddingForModel(modelIdForRecords, idxRecords.denseVec?.dims || null)
    : null;
  const cachedHits = cacheHit && cachedPayload
    ? {
      proseHits: cachedPayload.prose || [],
      extractedProseHits: cachedPayload.extractedProse || [],
      codeHits: cachedPayload.code || [],
      recordHits: cachedPayload.records || []
    }
    : null;
  const { proseHits, extractedProseHits, codeHits, recordHits } = cachedHits || runSearchByMode({
    searchPipeline,
    runProse,
    runExtractedProse,
    runCode,
    runRecords,
    idxProse,
    idxExtractedProse,
    idxCode,
    idxRecords,
    queryEmbeddingProse,
    queryEmbeddingExtractedProse,
    queryEmbeddingCode,
    queryEmbeddingRecords
  });
  const contextExpansionStats = {
    enabled: contextExpansionEnabled,
    code: 0,
    prose: 0,
    'extracted-prose': 0,
    records: 0
  };
  const expandModeHits = (mode, idx, hits) => {
    if (!contextExpansionEnabled || !hits.length || !idx?.chunkMeta?.length) {
      return { hits, contextHits: [] };
    }
    const allowedIds = contextExpansionRespectFilters && filtersActive
      ? new Set(
        filterChunks(idx.chunkMeta, filters, idx.filterIndex, idx.fileRelations)
          .map((chunk) => chunk.id)
      )
      : null;
    const contextHits = expandContext({
      hits,
      chunkMeta: idx.chunkMeta,
      fileRelations: idx.fileRelations,
      repoMap: idx.repoMap,
      options: contextExpansionOptions,
      allowedIds
    });
    contextExpansionStats[mode] = contextHits.length;
    return { hits: hits.concat(contextHits), contextHits };
  };
  const proseExpanded = runProse ? expandModeHits('prose', idxProse, proseHits) : { hits: proseHits, contextHits: [] };
  const extractedProseExpanded = runExtractedProse
    ? expandModeHits('extracted-prose', idxExtractedProse, extractedProseHits)
    : { hits: extractedProseHits, contextHits: [] };
  const codeExpanded = runCode ? expandModeHits('code', idxCode, codeHits) : { hits: codeHits, contextHits: [] };
  const recordExpanded = runRecords ? expandModeHits('records', idxRecords, recordHits) : { hits: recordHits, contextHits: [] };
  const proseHitsFinal = proseExpanded.hits;
  const extractedProseHitsFinal = extractedProseExpanded.hits;
  const codeHitsFinal = codeExpanded.hits;
  const recordHitsFinal = recordExpanded.hits;
  const hnswActive = Object.values(hnswAnnUsed).some(Boolean);
  const annBackend = vectorAnnEnabled && (vectorAnnUsed.code || vectorAnnUsed.prose)
    ? 'sqlite-extension'
    : (hnswActive ? 'hnsw' : 'js');

  const memory = process.memoryUsage();
  const payload = {
    backend: backendLabel,
    prose: jsonCompact ? proseHitsFinal.map((hit) => compactHit(hit, explain)) : proseHitsFinal,
    extractedProse: jsonCompact
      ? extractedProseHitsFinal.map((hit) => compactHit(hit, explain))
      : extractedProseHitsFinal,
    code: jsonCompact ? codeHitsFinal.map((hit) => compactHit(hit, explain)) : codeHitsFinal,
    records: jsonCompact ? recordHitsFinal.map((hit) => compactHit(hit, explain)) : recordHitsFinal,
    stats: {
      elapsedMs: Date.now() - t0,
      annEnabled,
      annActive,
      annMode: vectorExtension.annMode,
      annBackend,
      backendPolicy: backendPolicyInfo,
      annExtension: vectorAnnEnabled ? {
        provider: vectorExtension.provider,
        table: vectorExtension.table,
        available: {
          code: vectorAnnState.code.available,
          prose: vectorAnnState.prose.available,
          records: vectorAnnState.records.available
        }
      } : null,
      annHnsw: hnswConfig.enabled ? {
        available: {
          code: hnswAnnState.code.available,
          prose: hnswAnnState.prose.available,
          records: hnswAnnState.records.available,
          extractedProse: hnswAnnState['extracted-prose'].available
        },
        space: hnswConfig.space,
        efSearch: hnswConfig.efSearch
      } : null,
      models: {
        code: modelIdForCode,
        prose: modelIdForProse,
        extractedProse: modelIdForExtractedProse,
        records: modelIdForRecords
      },
      embeddings: {
        provider: embeddingProvider,
        onnxModel: embeddingOnnx.modelPath || null,
        onnxTokenizer: embeddingOnnx.tokenizerId || null
      },
      cache: {
        enabled: queryCacheEnabled,
        hit: cacheHit,
        key: cacheKey
      },
      memory: {
        rss: memory.rss,
        heapTotal: memory.heapTotal,
        heapUsed: memory.heapUsed,
        external: memory.external,
        arrayBuffers: memory.arrayBuffers
      }
    }
  };
  if (explain) {
    payload.stats.intent = {
      ...intentInfo,
      denseVectorMode: resolvedDenseVectorMode,
      fieldWeights
    };
    payload.stats.contextExpansion = contextExpansionStats;
  }

  if (emitOutput && jsonOutput) {
    console.log(JSON.stringify(payload, null, 2));
  }

  if (emitOutput && !jsonOutput) {
    let showProse = runProse ? argv.n : 0;
    let showExtractedProse = runExtractedProse ? argv.n : 0;
    let showCode = runCode ? argv.n : 0;
    let showRecords = runRecords ? argv.n : 0;

  if (runProse && runCode) {
    if (proseHits.length < argv.n) {
      showCode += showProse;
    }
    if (codeHits.length < argv.n) {
      showProse += showCode;
    }
  }
  if (contextExpansionEnabled) {
    showProse += proseExpanded.contextHits.length;
    showExtractedProse += extractedProseExpanded.contextHits.length;
    showCode += codeExpanded.contextHits.length;
    showRecords += recordExpanded.contextHits.length;
  }

  // Human output, enhanced formatting and summaries
  if (runProse) {
    console.log(color.bold(`\n===== 📖 Markdown Results (${backendLabel}) =====`));
    const summaryState = { lastCount: 0 };
    proseHitsFinal.slice(0, showProse).forEach((h, i) => {
      if (i < 2) {
        process.stdout.write(formatFullChunk({
          chunk: h,
          index: i,
          mode: 'prose',
          score: h.score,
          scoreType: h.scoreType,
          explain,
          color,
          queryTokens,
          rx,
          matched: argv.matched,
          rootDir: ROOT,
          summaryState
        }));
      } else {
        process.stdout.write(formatShortChunk({
          chunk: h,
          index: i,
          mode: 'prose',
          score: h.score,
          scoreType: h.scoreType,
          explain,
          color,
          queryTokens,
          rx,
          matched: argv.matched
        }));
      }
    });
    console.log('\n');
  }

  if (runExtractedProse) {
    console.log(color.bold(`===== Extracted Prose Results (${backendLabel}) =====`));
    const summaryState = { lastCount: 0 };
    extractedProseHitsFinal.slice(0, showExtractedProse).forEach((h, i) => {
      if (i < 2) {
        process.stdout.write(formatFullChunk({
          chunk: h,
          index: i,
          mode: 'extracted-prose',
          score: h.score,
          scoreType: h.scoreType,
          explain,
          color,
          queryTokens,
          rx,
          matched: argv.matched,
          rootDir: ROOT,
          summaryState
        }));
      } else {
        process.stdout.write(formatShortChunk({
          chunk: h,
          index: i,
          mode: 'extracted-prose',
          score: h.score,
          scoreType: h.scoreType,
          explain,
          color,
          queryTokens,
          rx,
          matched: argv.matched
        }));
      }
    });
    console.log('\n');
  }

  if (runCode) {
    console.log(color.bold(`===== 🔨 Code Results (${backendLabel}) =====`));
    const summaryState = { lastCount: 0 };
    codeHitsFinal.slice(0, showCode).forEach((h, i) => {
      if (i < 1) {
        process.stdout.write(formatFullChunk({
          chunk: h,
          index: i,
          mode: 'code',
          score: h.score,
          scoreType: h.scoreType,
          explain,
          color,
          queryTokens,
          rx,
          matched: argv.matched,
          rootDir: ROOT,
          summaryState
        }));
      } else {
        process.stdout.write(formatShortChunk({
          chunk: h,
          index: i,
          mode: 'code',
          score: h.score,
          scoreType: h.scoreType,
          explain,
          color,
          queryTokens,
          rx,
          matched: argv.matched
        }));
      }
    });
    console.log('\n');
  }

  if (runRecords) {
    console.log(color.bold(`===== 🧾 Records Results (${backendLabel}) =====`));
    recordHitsFinal.slice(0, showRecords).forEach((h, i) => {
      if (i < 2) {
        process.stdout.write(formatFullChunk({
          chunk: h,
          index: i,
          mode: 'records',
          score: h.score,
          scoreType: h.scoreType,
          explain,
          color,
          queryTokens,
          rx,
          matched: argv.matched,
          rootDir: null,
          summaryState: null
        }));
      } else {
        process.stdout.write(formatShortChunk({
          chunk: h,
          index: i,
          mode: 'records',
          score: h.score,
          scoreType: h.scoreType,
          explain,
          color,
          queryTokens,
          rx,
          matched: argv.matched
        }));
      }
    });
    console.log('\n');
  }
 
    // Optionally stats
    if (argv.stats) {
      const proseCount = idxProse?.chunkMeta?.length ?? 0;
      const codeCount = idxCode?.chunkMeta?.length ?? 0;
      const recordsCount = idxRecords?.chunkMeta?.length ?? 0;
      const cacheTag = queryCacheEnabled ? (cacheHit ? 'cache=hit' : 'cache=miss') : 'cache=off';
      const statsParts = [
        `prose chunks=${proseCount}`,
        `code chunks=${codeCount}`,
        runRecords ? `records chunks=${recordsCount}` : null,
        `(${cacheTag})`
      ].filter(Boolean);
      if (explain && backendPolicyInfo?.reason) {
        statsParts.push(`backend=${backendLabel}`);
        statsParts.push(`policy=${backendPolicyInfo.reason}`);
      }
      console.log(color.gray(`Stats: ${statsParts.join(', ')}`));
    }
  }

  const outputCacheReporter = getOutputCacheReporter();
  if (emitOutput && verboseCache && outputCacheReporter) {
    outputCacheReporter.report();
  }

  /* ---------- Update .repoMetrics and .searchHistory ---------- */
  try {
    const metricsPath = path.join(metricsDir, 'metrics.json');
    const historyPath = path.join(metricsDir, 'searchHistory');
    const noResultPath = path.join(metricsDir, 'noResultQueries');
    await fs.mkdir(path.dirname(metricsPath), { recursive: true });

    let metrics = {};
    try {
      metrics = JSON.parse(await fs.readFile(metricsPath, 'utf8'));
    } catch {
      metrics = {};
    }
    const inc = (f, key) => {
      if (!metrics[f]) metrics[f] = { md: 0, code: 0, records: 0, terms: [] };
      metrics[f][key] = (metrics[f][key] || 0) + 1;
      queryTokens.forEach((t) => {
        if (!metrics[f].terms.includes(t)) metrics[f].terms.push(t);
      });
    };
    proseHits.forEach((h) => inc(h.file, 'md'));
    codeHits.forEach((h) => inc(h.file, 'code'));
    recordHits.forEach((h) => inc(h.file, 'records'));
    await fs.writeFile(metricsPath, JSON.stringify(metrics) + '\n');

    await fs.appendFile(
      historyPath,
      JSON.stringify({
        time: new Date().toISOString(),
        query,
        mdFiles: proseHits.length,
        codeFiles: codeHits.length,
        recordFiles: recordHits.length,
        ms: Date.now() - t0,
        cached: cacheHit,
      }) + '\n'
    );

    if (proseHits.length === 0 && codeHits.length === 0 && recordHits.length === 0) {
      await fs.appendFile(
        noResultPath,
        JSON.stringify({ time: new Date().toISOString(), query }) + '\n'
      );
    }
  } catch {}

  if (queryCacheEnabled && cacheKey) {
    if (!cacheData) cacheData = { version: 1, entries: [] };
    if (!cacheHit) {
      cacheData.entries = cacheData.entries.filter((entry) => entry.key !== cacheKey);
      cacheData.entries.push({
        key: cacheKey,
        ts: Date.now(),
        ttlMs: queryCacheTtlMs,
        signature: cacheSignature,
        meta: {
          query,
          backend: backendLabel
        },
        payload: {
          prose: proseHits,
          code: codeHits,
          records: recordHits
        }
      });
    }
    pruneQueryCache(cacheData, queryCacheMaxEntries);
    try {
      await fs.mkdir(path.dirname(queryCachePath), { recursive: true });
      await fs.writeFile(queryCachePath, JSON.stringify(cacheData, null, 2));
    } catch {}
  }
  recordSearchMetrics('ok');
  return payload;
})().catch((err) => {
  recordSearchMetrics('error');
  if (emitOutput && jsonOutput && !err?.emitted) {
    const message = err?.message || 'Search failed.';
    const code = isErrorCode(err?.code) ? err.code : ERROR_CODES.INTERNAL;
    console.log(JSON.stringify({ ok: false, code, message }, null, 2));
    if (err) err.emitted = true;
  }
  throw err;
});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSearchCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
