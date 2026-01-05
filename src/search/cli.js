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
  resolveSqlitePaths
} from '../../tools/dict-utils.js';
import { resolveBackendPolicy } from '../storage/backend-policy.js';
import { getVectorExtensionConfig, queryVectorAnn } from '../../tools/vector-extension.js';
import { getSearchUsage, parseSearchArgs, resolveSearchMode } from './cli-args.js';
import { loadDictionary } from './cli-dictionary.js';
import { buildQueryCacheKey, getIndexSignature, loadIndex, requireIndexDir, resolveIndexDir } from './cli-index.js';
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
import { createSqliteHelpers } from './sqlite-helpers.js';
import { createSearchPipeline } from './pipeline.js';
import { loadIndexWithCache } from './index-cache.js';

export async function runSearchCli(rawArgs = process.argv.slice(2), options = {}) {
  const argv = parseSearchArgs(rawArgs);
  const emitOutput = options.emitOutput !== false;
  const exitOnError = options.exitOnError !== false;
  const indexCache = options.indexCache || null;
  const sqliteCache = options.sqliteCache || null;
  const t0 = Date.now();
  const rootOverride = options.root ? path.resolve(options.root) : null;
  const rootArg = rootOverride || (argv.repo ? path.resolve(argv.repo) : null);
  const ROOT = rootArg || resolveRepoRoot(process.cwd());
  const userConfig = loadUserConfig(ROOT);
  const bail = (message, code = 1) => {
    if (emitOutput && message) console.error(message);
    if (exitOnError) process.exit(code);
    throw new Error(message || 'Search failed.');
  };
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
  : 0;
const postingsConfig = normalizePostingsConfig(userConfig.indexing?.postings || {});
const filePrefilterConfig = userConfig.search?.filePrefilter || {};
const filePrefilterEnabled = filePrefilterConfig.enabled !== false;
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
  return bail(getSearchUsage());
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
  return bail(err.message);
}
const { searchMode, runCode, runProse, runRecords } = searchModeInfo;
const bm25Defaults = resolveBm25Defaults(metricsDir, { runCode, runProse });
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
  return bail(err.message);
}
let modifiedArgs;
try {
  modifiedArgs = parseModifiedArgs(argv['modified-after'], argv['modified-since']);
} catch (err) {
  return bail(err.message);
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
const sqlitePaths = resolveSqlitePaths(ROOT, userConfig);
const sqliteCodePath = sqlitePaths.codePath;
const sqliteProsePath = sqlitePaths.prosePath;

function estimateIndexBytes(indexDir) {
  if (!indexDir || !fsSync.existsSync(indexDir)) return 0;
  const targets = [
    'chunk_meta.json',
    'chunk_meta.jsonl',
    'chunk_meta.meta.json',
    'token_postings.json',
    'token_postings.meta.json',
    'phrase_ngrams.json',
    'chargram_postings.json',
    'dense_vectors_uint8.json'
  ];
  const sumFile = (targetPath) => {
    try {
      const stat = fsSync.statSync(targetPath);
      return stat.size;
    } catch {
      return 0;
    }
  };
  let total = 0;
  for (const name of targets) {
    total += sumFile(path.join(indexDir, name));
  }
  const chunkMetaPartsDir = path.join(indexDir, 'chunk_meta.parts');
  if (fsSync.existsSync(chunkMetaPartsDir)) {
    for (const entry of fsSync.readdirSync(chunkMetaPartsDir)) {
      total += sumFile(path.join(chunkMetaPartsDir, entry));
    }
  }
  const tokenPostingsShardsDir = path.join(indexDir, 'token_postings.shards');
  if (fsSync.existsSync(tokenPostingsShardsDir)) {
    for (const entry of fsSync.readdirSync(tokenPostingsShardsDir)) {
      total += sumFile(path.join(tokenPostingsShardsDir, entry));
    }
  }
  return total;
}
function resolveIndexedFileCount(metricsRoot) {
  if (!metricsRoot || !fsSync.existsSync(metricsRoot)) return null;
  const modes = [];
  if (runCode) modes.push('code');
  if (runProse) modes.push('prose');
  if (!modes.length) return null;
  const counts = [];
  for (const mode of modes) {
    const metricsPath = path.join(metricsRoot, `index-${mode}.json`);
    if (!fsSync.existsSync(metricsPath)) continue;
    try {
      const raw = JSON.parse(fsSync.readFileSync(metricsPath, 'utf8'));
      const count = Number(raw?.files?.candidates);
      if (Number.isFinite(count) && count > 0) counts.push(count);
    } catch {
      // ignore
    }
  }
  if (!counts.length) return null;
  return Math.max(...counts);
}

function resolveBm25Defaults(metricsRoot, modeFlags) {
  if (!metricsRoot || !fsSync.existsSync(metricsRoot)) return null;
  const targets = [];
  if (modeFlags?.runCode) targets.push('code');
  if (modeFlags?.runProse) targets.push('prose');
  if (!targets.length) return null;
  const values = [];
  for (const mode of targets) {
    const metricsPath = path.join(metricsRoot, `index-${mode}.json`);
    if (!fsSync.existsSync(metricsPath)) continue;
    try {
      const raw = JSON.parse(fsSync.readFileSync(metricsPath, 'utf8'));
      const k1 = Number(raw?.bm25?.k1);
      const b = Number(raw?.bm25?.b);
      if (Number.isFinite(k1) && Number.isFinite(b)) values.push({ k1, b });
    } catch {
      // ignore
    }
  }
  if (!values.length) return null;
  const k1 = values.reduce((sum, v) => sum + v.k1, 0) / values.length;
  const b = values.reduce((sum, v) => sum + v.b, 0) / values.length;
  return { k1, b };
}

const needsCode = runCode;
const needsProse = runProse;
const backendArg = typeof argv.backend === 'string' ? argv.backend.toLowerCase() : '';
const sqliteScoreModeConfig = sqliteConfig.scoreMode === 'fts';
const sqliteConfigured = sqliteConfig.use !== false;
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
const jsonCompact = argv['json-compact'] === true;
const jsonOutput = argv.json || jsonCompact;
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
  sqliteAutoChunkThreshold,
  sqliteAutoArtifactBytes,
  needsSqlite,
  chunkCounts,
  artifactBytes
});
if (backendPolicy.error) {
  const missing = [];
  if (needsCode && !sqliteCodeAvailable) missing.push(`code=${sqliteCodePath}`);
  if (needsProse && !sqliteProseAvailable) missing.push(`prose=${sqliteProsePath}`);
  const suffix = missing.length ? missing.join(', ') : 'missing sqlite index';
  return bail(`${backendPolicy.error} (${suffix}).`);
}
if (!needsSqlite && backendPolicy.backendForcedSqlite) {
  console.warn('SQLite backend requested, but records-only mode selected; using file-backed records index.');
}
if (backendPolicy.backendDisabled) {
  console.warn(`Unknown backend "${backendArg}". Falling back to memory.`);
}
let useSqlite = backendPolicy.useSqlite;
const sqliteFtsRequested = backendPolicy.sqliteFtsRequested;
const backendForcedSqlite = backendPolicy.backendForcedSqlite;
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
  dbCache: sqliteCache
});
useSqlite = sqliteBackend.useSqlite;
let dbCode = sqliteBackend.dbCode;
let dbProse = sqliteBackend.dbProse;
const vectorAnnState = sqliteBackend.vectorAnnState;
const vectorAnnUsed = sqliteBackend.vectorAnnUsed;
const backendLabel = useSqlite
  ? (sqliteFtsRequested ? 'sqlite-fts' : 'sqlite')
  : 'memory';
const backendPolicyInfo = { ...backendPolicy, backendLabel };
let modelIdForCode = null;
let modelIdForProse = null;
let modelIdForRecords = null;

const loadBranchFromMetrics = (mode) => {
  try {
    const metricsPath = path.join(metricsDir, `index-${mode}.json`);
    if (!fsSync.existsSync(metricsPath)) return null;
    const raw = JSON.parse(fsSync.readFileSync(metricsPath, 'utf8'));
    return raw?.git?.branch || null;
  } catch {
    return null;
  }
};

async function resolveRepoBranch() {
  const fromMetrics = runCode ? loadBranchFromMetrics('code') : null;
  const fromProse = !fromMetrics && runProse ? loadBranchFromMetrics('prose') : null;
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
    return payload;
  }
  if (!repoBranch) {
    console.warn('Branch filter requested but repo branch is unavailable; continuing without branch validation.');
  }
}

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
  modelIdDefault,
  fileChargramN
});
const {
  loadIndexFromSqlite,
  buildCandidateSetSqlite,
  getTokenIndexForQuery,
  rankSqliteFts,
  rankVectorAnnSqlite
} = sqliteHelpers;


const dictConfigBase = getDictConfig(ROOT, userConfig);
const dictConfig = applyAdaptiveDictConfig(dictConfigBase, resolveIndexedFileCount(metricsDir));
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
const rx = queryTokens.length ? new RegExp(`(${queryTokens.join('|')})`, 'ig') : null;
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
  meta: metaFilters,
  chunkAuthor: chunkAuthorFilter || null,
  modifiedAfter,
  modifiedSinceDays
};
const sqliteLazyChunks = sqliteFtsRequested && !filtersActive;
const sqliteContextChunks = contextExpansionEnabled ? true : !sqliteLazyChunks;
const proseDir = runProse && !useSqlite ? requireIndexDir(ROOT, 'prose', userConfig) : null;
const codeDir = runCode && !useSqlite ? requireIndexDir(ROOT, 'code', userConfig) : null;
const recordsDir = runRecords ? requireIndexDir(ROOT, 'records', userConfig) : null;
const loadIndexCached = (dir) => loadIndexWithCache(
  indexCache,
  dir,
  { modelIdDefault, fileChargramN },
  loadIndex
);
const idxProse = runProse
  ? (useSqlite ? loadIndexFromSqlite('prose', {
    includeDense: annActive,
    includeMinhash: annActive,
    includeChunks: sqliteContextChunks,
    includeFilterIndex: filtersActive
  }) : loadIndexCached(proseDir))
  : { chunkMeta: [], denseVec: null, minhash: null };
const idxCode = runCode
  ? (useSqlite ? loadIndexFromSqlite('code', {
    includeDense: annActive,
    includeMinhash: annActive,
    includeChunks: sqliteContextChunks,
    includeFilterIndex: filtersActive
  }) : loadIndexCached(codeDir))
  : { chunkMeta: [], denseVec: null, minhash: null };
const idxRecords = runRecords
  ? loadIndexCached(recordsDir)
  : { chunkMeta: [], denseVec: null, minhash: null };
const resolveDenseVector = (idx, mode) => {
  if (!idx) return null;
  if (resolvedDenseVectorMode === 'code') return idx.denseVecCode || idx.denseVec || null;
  if (resolvedDenseVectorMode === 'doc') return idx.denseVecDoc || idx.denseVec || null;
  if (resolvedDenseVectorMode === 'auto') {
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
const loadRepoMap = (mode) => {
  try {
    const dir = resolveIndexDir(ROOT, mode, userConfig);
    const mapPath = path.join(dir, 'repo_map.json');
    if (!fsSync.existsSync(mapPath)) return null;
    const raw = JSON.parse(fsSync.readFileSync(mapPath, 'utf8'));
    return Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
};
if (runCode) {
  idxCode.denseVec = resolveDenseVector(idxCode, 'code');
  if (useSqlite && !idxCode.fileRelations) {
    idxCode.fileRelations = loadFileRelations('code');
  }
  if (useSqlite && !idxCode.repoMap) {
    idxCode.repoMap = loadRepoMap('code');
  }
}
if (runProse) {
  idxProse.denseVec = resolveDenseVector(idxProse, 'prose');
  if (useSqlite && !idxProse.fileRelations) {
    idxProse.fileRelations = loadFileRelations('prose');
  }
  if (useSqlite && !idxProse.repoMap) {
    idxProse.repoMap = loadRepoMap('prose');
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
    'annType',
    'context'
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
        records: modelIdForRecords
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
  const contextExpansionStats = {
    enabled: contextExpansionEnabled,
    code: 0,
    prose: 0,
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
  const codeExpanded = runCode ? expandModeHits('code', idxCode, codeHits) : { hits: codeHits, contextHits: [] };
  const recordExpanded = runRecords ? expandModeHits('records', idxRecords, recordHits) : { hits: recordHits, contextHits: [] };
  const proseHitsFinal = proseExpanded.hits;
  const codeHitsFinal = codeExpanded.hits;
  const recordHitsFinal = recordExpanded.hits;
  const annBackend = vectorAnnEnabled && (vectorAnnUsed.code || vectorAnnUsed.prose)
    ? 'sqlite-extension'
    : 'js';

  const memory = process.memoryUsage();
  const payload = {
    backend: backendLabel,
    prose: jsonCompact ? proseHitsFinal.map((hit) => compactHit(hit, explain)) : proseHitsFinal,
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
      const cacheTag = queryCacheEnabled ? (cacheHit ? 'cache=hit' : 'cache=miss') : 'cache=off';
      const statsParts = [
        `prose chunks=${idxProse.chunkMeta.length}`,
        `code chunks=${idxCode.chunkMeta.length}`,
        runRecords ? `records chunks=${idxRecords.chunkMeta.length}` : null,
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
  return payload;
})();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSearchCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
