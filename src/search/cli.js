/**
 * Ultra-Complete Search Utility for Rich Semantic Index (Pretty Output)
 * By: ChatGPT & Nick, 2025
 *   [--calls function]  Filter for call relationships (calls to/from function)
 *   [--uses ident]      Filter for usage of identifier
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_MODEL_ID,
  getCacheRuntimeConfig,
  getDictConfig,
  getMetricsDir,
  getModelConfig,
  loadUserConfig,
  resolveRepoRoot,
  resolveSqlitePaths
} from '../../tools/dict-utils.js';
import { getVectorExtensionConfig, queryVectorAnn } from '../../tools/vector-extension.js';
import { getSearchUsage, parseSearchArgs, resolveSearchMode } from './cli-args.js';
import { loadDictionary } from './cli-dictionary.js';
import { buildQueryCacheKey, getIndexSignature, loadIndex, requireIndexDir, resolveIndexDir } from './cli-index.js';
import { createSqliteBackend, getSqliteChunkCount } from './cli-sqlite.js';
import { resolveFtsWeights } from './fts.js';
import { getQueryEmbedding } from './embedding.js';
import { loadQueryCache, parseJson, pruneQueryCache } from './query-cache.js';
import { hasActiveFilters, normalizeExtFilter, parseMetaFilters } from './filters.js';
import { configureOutputCaches, formatFullChunk, formatShortChunk, getOutputCacheReporter } from './output.js';
import { parseChurnArg, parseModifiedArgs, parseQueryInput, tokenizePhrase, tokenizeQueryTerms, buildPhraseNgrams } from './query-parse.js';
import { normalizePostingsConfig } from '../shared/postings-config.js';
import { createSqliteHelpers } from './sqlite-helpers.js';
import { createSearchPipeline } from './pipeline.js';

const rawArgs = process.argv.slice(2);
const argv = parseSearchArgs(rawArgs);
const t0 = Date.now();
const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const ROOT = rootArg || resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(ROOT);
const cacheConfig = getCacheRuntimeConfig(ROOT, userConfig);
const verboseCache = process.env.PAIROFCLEATS_VERBOSE === '1';
const cacheLog = verboseCache ? (msg) => process.stderr.write(`\n${msg}\n`) : null;
configureOutputCaches({ cacheConfig, verbose: verboseCache, log: cacheLog });
const modelConfig = getModelConfig(ROOT, userConfig);
const modelIdDefault = argv.model || modelConfig.id || DEFAULT_MODEL_ID;
const sqliteConfig = userConfig.sqlite || {};
const sqliteAutoChunkThresholdRaw = userConfig.search?.sqliteAutoChunkThreshold;
const sqliteAutoChunkThreshold = Number.isFinite(Number(sqliteAutoChunkThresholdRaw))
  ? Math.max(0, Number(sqliteAutoChunkThresholdRaw))
  : 5000;
const postingsConfig = normalizePostingsConfig(userConfig.indexing?.postings || {});
const vectorExtension = getVectorExtensionConfig(ROOT, userConfig);
const bm25Config = userConfig.search?.bm25 || {};
const bm25K1 = Number.isFinite(Number(argv['bm25-k1']))
  ? Number(argv['bm25-k1'])
  : (Number.isFinite(Number(bm25Config.k1)) ? Number(bm25Config.k1) : 1.2);
const bm25B = Number.isFinite(Number(argv['bm25-b']))
  ? Number(argv['bm25-b'])
  : (Number.isFinite(Number(bm25Config.b)) ? Number(bm25Config.b) : 0.75);
const sqliteFtsNormalize = userConfig.search?.sqliteFtsNormalize === true;
const sqliteFtsProfile = (argv['fts-profile'] || process.env.PAIROFCLEATS_FTS_PROFILE || userConfig.search?.sqliteFtsProfile || 'balanced').toLowerCase();
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
const useStubEmbeddings = process.env.PAIROFCLEATS_EMBEDDINGS === 'stub';
const query = argv._.join(' ').trim();
if (!query) {
  console.error(getSearchUsage());
  process.exit(1);
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
  console.error(err.message);
  process.exit(1);
}
const { searchMode, runCode, runProse, runRecords } = searchModeInfo;
const branchesMin = Number.isFinite(Number(argv.branches)) ? Number(argv.branches) : null;
const loopsMin = Number.isFinite(Number(argv.loops)) ? Number(argv.loops) : null;
const breaksMin = Number.isFinite(Number(argv.breaks)) ? Number(argv.breaks) : null;
const continuesMin = Number.isFinite(Number(argv.continues)) ? Number(argv.continues) : null;
let churnMin = null;
try {
  churnMin = parseChurnArg(argv.churn);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
let modifiedArgs;
try {
  modifiedArgs = parseModifiedArgs(argv['modified-after'], argv['modified-since']);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const modifiedAfter = modifiedArgs.modifiedAfter;
const modifiedSinceDays = modifiedArgs.modifiedSinceDays;
const fileFilters = [];
if (argv.path) fileFilters.push(argv.path);
if (argv.file) fileFilters.push(argv.file);
const fileFilter = fileFilters.length ? fileFilters.flat() : null;
const extFilter = normalizeExtFilter(argv.ext);
const metaFilters = parseMetaFilters(argv.meta, argv['meta-json']);
const sqlitePaths = resolveSqlitePaths(ROOT, userConfig);
const sqliteCodePath = sqlitePaths.codePath;
const sqliteProsePath = sqlitePaths.prosePath;
const needsCode = runCode;
const needsProse = runProse;
const backendArg = typeof argv.backend === 'string' ? argv.backend.toLowerCase() : '';
const sqliteScoreModeConfig = sqliteConfig.scoreMode === 'fts';
const sqliteFtsRequested = backendArg === 'sqlite-fts' || backendArg === 'fts' || (!backendArg && sqliteScoreModeConfig);
const backendForcedSqlite = backendArg === 'sqlite' || sqliteFtsRequested;
const backendDisabled = backendArg && !(backendArg === 'sqlite' || sqliteFtsRequested);
const sqliteConfigured = sqliteConfig.use === true;
const sqliteCodeAvailable = fsSync.existsSync(sqliteCodePath);
const sqliteProseAvailable = fsSync.existsSync(sqliteProsePath);
const sqliteAvailable = (!needsCode || sqliteCodeAvailable) && (!needsProse || sqliteProseAvailable);
const annFlagPresent = rawArgs.includes('--ann') || rawArgs.includes('--no-ann');
const annDefault = userConfig.search?.annDefault !== false;
const annEnabled = annFlagPresent ? argv.ann : annDefault;
const vectorAnnEnabled = annEnabled && vectorExtension.enabled;
const scoreBlendConfig = userConfig.search?.scoreBlend || {};
const scoreBlendEnabled = scoreBlendConfig.enabled === true;
const scoreBlendSparseWeight = Number.isFinite(Number(scoreBlendConfig.sparseWeight))
  ? Number(scoreBlendConfig.sparseWeight)
  : 1;
const scoreBlendAnnWeight = Number.isFinite(Number(scoreBlendConfig.annWeight))
  ? Number(scoreBlendConfig.annWeight)
  : 1;
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
const jsonCompact = argv['json-compact'] === true;
const jsonOutput = argv.json || jsonCompact;
const explain = argv.explain === true || argv.why === true;
const denseVectorMode = typeof userConfig.search?.denseVectorMode === 'string'
  ? userConfig.search.denseVectorMode.toLowerCase()
  : 'merged';

const sqliteFtsWeights = resolveFtsWeights(sqliteFtsProfile, sqliteFtsWeightsConfig);

if (backendForcedSqlite && !sqliteAvailable) {
  const missing = [];
  if (needsCode && !sqliteCodeAvailable) missing.push(`code=${sqliteCodePath}`);
  if (needsProse && !sqliteProseAvailable) missing.push(`prose=${sqliteProsePath}`);
  const suffix = missing.length ? missing.join(', ') : 'missing sqlite index';
  console.error(`SQLite backend requested but index not found (${suffix}).`);
  process.exit(1);
}

const needsSqlite = runCode || runProse;
if (!needsSqlite && backendForcedSqlite) {
  console.warn('SQLite backend requested, but records-only mode selected; using file-backed records index.');
}
let autoUseSqlite = true;
if (
  needsSqlite
  && !backendForcedSqlite
  && !backendDisabled
  && sqliteConfigured
  && sqliteAvailable
  && sqliteAutoChunkThreshold > 0
) {
  const counts = [];
  if (needsCode) counts.push(await getSqliteChunkCount(sqliteCodePath, 'code'));
  if (needsProse) counts.push(await getSqliteChunkCount(sqliteProsePath, 'prose'));
  const knownCounts = counts.filter((count) => Number.isFinite(count));
  if (knownCounts.length) {
    const maxCount = Math.max(...knownCounts);
    autoUseSqlite = maxCount >= sqliteAutoChunkThreshold;
  }
}
let useSqlite = needsSqlite
  && (backendForcedSqlite || (!backendDisabled && sqliteConfigured && autoUseSqlite))
  && sqliteAvailable;
const sqliteBackend = await createSqliteBackend({
  useSqlite,
  needsCode,
  needsProse,
  sqliteCodePath,
  sqliteProsePath,
  sqliteFtsRequested,
  backendForcedSqlite,
  vectorExtension,
  vectorAnnEnabled
});
useSqlite = sqliteBackend.useSqlite;
let dbCode = sqliteBackend.dbCode;
let dbProse = sqliteBackend.dbProse;
const vectorAnnState = sqliteBackend.vectorAnnState;
const vectorAnnUsed = sqliteBackend.vectorAnnUsed;

const backendLabel = useSqlite
  ? (sqliteFtsRequested ? 'sqlite-fts' : 'sqlite')
  : 'memory';
let modelIdForCode = null;
let modelIdForProse = null;
let modelIdForRecords = null;

/**
 * Return the active SQLite connection for a mode.
 * @param {'code'|'prose'} mode
 * @returns {import('better-sqlite3').Database|null}
 */
function getSqliteDb(mode) {
  if (!useSqlite) return null;
  if (mode === 'code') return dbCode;
  if (mode === 'prose') return dbProse;
  return null;
}

const sqliteHelpers = createSqliteHelpers({
  getDb: getSqliteDb,
  postingsConfig,
  sqliteFtsWeights,
  vectorExtension,
  vectorAnnState,
  queryVectorAnn,
  modelIdDefault
});
const {
  loadIndexFromSqlite,
  buildCandidateSetSqlite,
  getTokenIndexForQuery,
  rankSqliteFts,
  rankVectorAnnSqlite
} = sqliteHelpers;


const dictConfig = getDictConfig(ROOT, userConfig);
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
const includeTokens = tokenizeQueryTerms(parsedQuery.includeTerms, dict, dictConfig);
const phraseTokens = parsedQuery.phrases
  .map((phrase) => tokenizePhrase(phrase, dict, dictConfig))
  .filter((tokens) => tokens.length);
const phraseInfo = buildPhraseNgrams(phraseTokens, postingsConfig);
const phraseNgrams = phraseInfo.ngrams;
const phraseNgramSet = phraseNgrams.length ? new Set(phraseNgrams) : null;
const phraseRange = { min: phraseInfo.minLen, max: phraseInfo.maxLen };
const excludeTokens = tokenizeQueryTerms(parsedQuery.excludeTerms, dict, dictConfig);
const excludePhraseTokens = parsedQuery.excludePhrases
  .map((phrase) => tokenizePhrase(phrase, dict, dictConfig))
  .filter((tokens) => tokens.length);
const excludePhraseInfo = buildPhraseNgrams(excludePhraseTokens, postingsConfig);
const excludePhraseNgrams = excludePhraseInfo.ngrams;
const excludePhraseRange = excludePhraseInfo.minLen && excludePhraseInfo.maxLen
  ? { min: excludePhraseInfo.minLen, max: excludePhraseInfo.maxLen }
  : null;
const queryTokens = [...includeTokens, ...phraseTokens.flat()];
const annActive = annEnabled && queryTokens.length > 0;
const rx = queryTokens.length ? new RegExp(`(${queryTokens.join('|')})`, 'ig') : null;
const embeddingQueryText = [...parsedQuery.includeTerms, ...parsedQuery.phrases]
  .join(' ')
  .trim() || query;
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
  awaits: argv.awaits || null,
  visibility: argv.visibility || null,
  extends: argv.extends || null,
  async: argv.async || false,
  generator: argv.generator || false,
  returns: argv.returns || false,
  file: fileFilter || null,
  ext: extFilter || null,
  meta: metaFilters,
  chunkAuthor: chunkAuthorFilter || null,
  modifiedAfter,
  modifiedSinceDays
};
const sqliteLazyChunks = sqliteFtsRequested && !filtersActive;
const proseDir = runProse && !useSqlite ? requireIndexDir(ROOT, 'prose', userConfig) : null;
const codeDir = runCode && !useSqlite ? requireIndexDir(ROOT, 'code', userConfig) : null;
const recordsDir = runRecords ? requireIndexDir(ROOT, 'records', userConfig) : null;
const idxProse = runProse
  ? (useSqlite ? loadIndexFromSqlite('prose', {
    includeDense: annActive,
    includeMinhash: annActive,
    includeChunks: !sqliteLazyChunks,
    includeFilterIndex: filtersActive
  }) : loadIndex(proseDir, { modelIdDefault }))
  : { chunkMeta: [], denseVec: null, minhash: null };
const idxCode = runCode
  ? (useSqlite ? loadIndexFromSqlite('code', {
    includeDense: annActive,
    includeMinhash: annActive,
    includeChunks: !sqliteLazyChunks,
    includeFilterIndex: filtersActive
  }) : loadIndex(codeDir, { modelIdDefault }))
  : { chunkMeta: [], denseVec: null, minhash: null };
const idxRecords = runRecords
  ? loadIndex(recordsDir, { modelIdDefault })
  : { chunkMeta: [], denseVec: null, minhash: null };
const resolveDenseVector = (idx, mode) => {
  if (!idx) return null;
  if (denseVectorMode === 'code') return idx.denseVecCode || idx.denseVec || null;
  if (denseVectorMode === 'doc') return idx.denseVecDoc || idx.denseVec || null;
  if (denseVectorMode === 'auto') {
    if (mode === 'code') return idx.denseVecCode || idx.denseVec || null;
    if (mode === 'prose') return idx.denseVecDoc || idx.denseVec || null;
  }
  return idx.denseVec || null;
};
const loadFileRelations = (mode) => {
  try {
    const dir = resolveIndexDir(ROOT, mode, userConfig);
    const relPath = path.join(dir, 'file_relations.json');
    if (!fsSync.existsSync(relPath)) return null;
    const raw = JSON.parse(fsSync.readFileSync(relPath, 'utf8'));
    if (!Array.isArray(raw)) return null;
    const map = new Map();
    for (const entry of raw) {
      if (!entry?.file) continue;
      map.set(entry.file, entry.relations || null);
    }
    return map;
  } catch {
    return null;
  }
};
if (runCode) {
  idxCode.denseVec = resolveDenseVector(idxCode, 'code');
  if (useSqlite && !idxCode.fileRelations) {
    idxCode.fileRelations = loadFileRelations('code');
  }
}
if (runProse) {
  idxProse.denseVec = resolveDenseVector(idxProse, 'prose');
  if (useSqlite && !idxProse.fileRelations) {
    idxProse.fileRelations = loadFileRelations('prose');
  }
}
modelIdForCode = runCode ? (idxCode?.denseVec?.model || modelIdDefault) : null;
modelIdForProse = runProse ? (idxProse?.denseVec?.model || modelIdDefault) : null;
modelIdForRecords = runRecords ? (idxRecords?.denseVec?.model || modelIdDefault) : null;
const searchPipeline = createSearchPipeline({
  useSqlite,
  sqliteFtsRequested,
  sqliteFtsNormalize,
  sqliteFtsProfile,
  sqliteFtsWeights,
  bm25K1,
  bm25B,
  postingsConfig,
  queryTokens,
  phraseNgramSet,
  phraseRange,
  filters,
  filtersActive,
  topN: argv.n,
  annEnabled: annActive,
  scoreBlend: {
    enabled: scoreBlendEnabled,
    sparseWeight: scoreBlendSparseWeight,
    annWeight: scoreBlendAnnWeight
  },
  minhashMaxDocs,
  vectorAnnState,
  vectorAnnUsed,
  buildCandidateSetSqlite,
  getTokenIndexForQuery,
  rankSqliteFts,
  rankVectorAnnSqlite
});
// --- SEARCH BM25 TOKENS/PHRASES ---

/**
 * Build a compact search hit payload for tooling.
 * @param {object} hit
 * @returns {object}
 */
function compactHit(hit, includeExplain = false) {
  if (!hit || typeof hit !== 'object') return hit;
  const compact = {};
  const fields = [
    'id',
    'file',
    'start',
    'end',
    'startLine',
    'endLine',
    'ext',
    'kind',
    'name',
    'headline',
    'score',
    'scoreType',
    'sparseScore',
    'sparseType',
    'annScore',
    'annSource',
    'annType'
  ];
  for (const field of fields) {
    if (hit[field] !== undefined) compact[field] = hit[field];
  }
  if (includeExplain && hit.scoreBreakdown !== undefined) {
    compact.scoreBreakdown = hit.scoreBreakdown;
  }
  return compact;
}


// --- MAIN ---
(async () => {
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
      denseVectorMode,
      minhashMaxDocs,
      sqliteFtsNormalize,
      sqliteFtsProfile,
      sqliteFtsWeights,
      models: {
        code: modelIdForCode,
        prose: modelIdForProse,
        records: modelIdForRecords
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

  const needsEmbedding = !cacheHit && annActive && (
    (runProse && (idxProse.denseVec?.vectors?.length || vectorAnnState.prose.available)) ||
    (runCode && (idxCode.denseVec?.vectors?.length || vectorAnnState.code.available)) ||
    (runRecords && idxRecords.denseVec?.vectors?.length)
  );
  const embeddingCache = new Map();
  const getEmbeddingForModel = async (modelId, dims) => {
    if (!modelId) return null;
    const cacheKey = useStubEmbeddings ? `${modelId}:${dims || 'default'}` : modelId;
    if (embeddingCache.has(cacheKey)) return embeddingCache.get(cacheKey);
    const embedding = await getQueryEmbedding({
      text: embeddingQueryText,
      modelId,
      dims,
      modelDir: modelConfig.dir,
      useStub: useStubEmbeddings
    });
    embeddingCache.set(cacheKey, embedding);
    return embedding;
  };
  const queryEmbeddingCode = needsEmbedding && runCode && (idxCode.denseVec?.vectors?.length || vectorAnnState.code.available)
    ? await getEmbeddingForModel(modelIdForCode, idxCode.denseVec?.dims || null)
    : null;
  const queryEmbeddingProse = needsEmbedding && runProse && (idxProse.denseVec?.vectors?.length || vectorAnnState.prose.available)
    ? await getEmbeddingForModel(modelIdForProse, idxProse.denseVec?.dims || null)
    : null;
  const queryEmbeddingRecords = needsEmbedding && runRecords && idxRecords.denseVec?.vectors?.length
    ? await getEmbeddingForModel(modelIdForRecords, idxRecords.denseVec?.dims || null)
    : null;
  const proseHits = cacheHit && cachedPayload
    ? (cachedPayload.prose || [])
    : (runProse ? searchPipeline(idxProse, 'prose', queryEmbeddingProse) : []);
  const codeHits = cacheHit && cachedPayload
    ? (cachedPayload.code || [])
    : (runCode ? searchPipeline(idxCode, 'code', queryEmbeddingCode) : []);
  const recordHits = cacheHit && cachedPayload
    ? (cachedPayload.records || [])
    : (runRecords ? searchPipeline(idxRecords, 'records', queryEmbeddingRecords) : []);
  const annBackend = vectorAnnEnabled && (vectorAnnUsed.code || vectorAnnUsed.prose)
    ? 'sqlite-extension'
    : 'js';

  // Output
  if (jsonOutput) {
    // Full JSON
    const memory = process.memoryUsage();
    console.log(JSON.stringify({
      backend: backendLabel,
      prose: jsonCompact ? proseHits.map((hit) => compactHit(hit, explain)) : proseHits,
      code: jsonCompact ? codeHits.map((hit) => compactHit(hit, explain)) : codeHits,
      records: jsonCompact ? recordHits.map((hit) => compactHit(hit, explain)) : recordHits,
      stats: {
        elapsedMs: Date.now() - t0,
        annEnabled,
        annActive,
        annMode: vectorExtension.annMode,
        annBackend,
        annExtension: vectorAnnEnabled ? {
          provider: vectorExtension.provider,
          table: vectorExtension.table,
          available: {
            code: vectorAnnState.code.available,
            prose: vectorAnnState.prose.available,
            records: vectorAnnState.records.available
          }
        } : null,
        models: {
          code: modelIdForCode,
          prose: modelIdForProse,
          records: modelIdForRecords
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
    }, null, 2));
  }

  if (!jsonOutput) {
    let showProse = runProse ? argv.n : 0;
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

  // Human output, enhanced formatting and summaries
  if (runProse) {
    console.log(color.bold(`\n===== 📖 Markdown Results (${backendLabel}) =====`));
    const summaryState = { lastCount: 0 };
    proseHits.slice(0, showProse).forEach((h, i) => {
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

  if (runCode) {
    console.log(color.bold(`===== 🔨 Code Results (${backendLabel}) =====`));
    const summaryState = { lastCount: 0 };
    codeHits.slice(0, showCode).forEach((h, i) => {
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
    recordHits.slice(0, showRecords).forEach((h, i) => {
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
      const cacheTag = queryCacheEnabled ? (cacheHit ? 'cache=hit' : 'cache=miss') : 'cache=off';
      const statsParts = [
        `prose chunks=${idxProse.chunkMeta.length}`,
        `code chunks=${idxCode.chunkMeta.length}`,
        runRecords ? `records chunks=${idxRecords.chunkMeta.length}` : null,
        `(${cacheTag})`
      ].filter(Boolean);
      console.log(color.gray(`Stats: ${statsParts.join(', ')}`));
    }
  }

  const outputCacheReporter = getOutputCacheReporter();
  if (verboseCache && outputCacheReporter) {
    outputCacheReporter.report();
  }

  /* ---------- Update .repoMetrics and .searchHistory ---------- */
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
})();
