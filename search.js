#!/usr/bin/env node
/**
 * Ultra-Complete Search Utility for Rich Semantic Index (Pretty Output)
 * By: ChatGPT & Nick, 2025
 *   [--calls function]  Filter for call relationships (calls to/from function)
 *   [--uses ident]      Filter for usage of identifier
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import minimist from 'minimist';
import { DEFAULT_MODEL_ID, getDictionaryPaths, getDictConfig, getIndexDir, getMetricsDir, getModelConfig, loadUserConfig, resolveRepoRoot, resolveSqlitePaths } from './tools/dict-utils.js';
import { getVectorExtensionConfig, hasVectorTable, loadVectorExtension, queryVectorAnn, resolveVectorExtensionPath } from './tools/vector-extension.js';
import { resolveFtsWeights } from './src/search/fts.js';
import { getQueryEmbedding } from './src/search/embedding.js';
import { loadQueryCache, parseJson, pruneQueryCache } from './src/search/query-cache.js';
import { normalizeExtFilter, parseMetaFilters } from './src/search/filters.js';
import { filterChunks, formatFullChunk, formatShortChunk } from './src/search/output.js';
import { parseChurnArg, parseModifiedArgs, parseQueryInput, tokenizePhrase, tokenizeQueryTerms, buildPhraseNgrams } from './src/search/query.js';
import { rankBM25, rankDenseVectors, rankMinhash } from './src/search/rankers.js';
import { extractNgrams, tri } from './src/shared/tokenize.js';
import { normalizePostingsConfig } from './src/shared/postings-config.js';
import { createSqliteHelpers } from './src/search/sqlite-helpers.js';

const argv = minimist(process.argv.slice(2), {
  boolean: ['json', 'json-compact', 'human', 'stats', 'ann', 'headline', 'lint', 'matched', 'async', 'generator', 'returns'],
  alias: { n: 'top', c: 'context', t: 'type' },
  default: { n: 5, context: 3 },
  string: [
    'calls',
    'uses',
    'signature',
    'param',
    'decorator',
    'inferred-type',
    'return-type',
    'throws',
    'reads',
    'writes',
    'mutates',
    'churn',
    'alias',
    'awaits',
    'branches',
    'loops',
    'breaks',
    'continues',
    'risk',
    'risk-tag',
    'risk-source',
    'risk-sink',
    'risk-category',
    'risk-flow',
    'meta',
    'meta-json',
    'file',
    'ext',
    'chunk-author',
    'modified-after',
    'modified-since',
    'visibility',
    'extends',
    'mode',
    'backend',
    'path',
    'model',
    'repo',
    'fts-profile',
    'fts-weights',
    'bm25-k1',
    'bm25-b'
  ],
});
const t0 = Date.now();
const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const ROOT = rootArg || resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(ROOT);
const modelConfig = getModelConfig(ROOT, userConfig);
const modelIdDefault = argv.model || modelConfig.id || DEFAULT_MODEL_ID;
const sqliteConfig = userConfig.sqlite || {};
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
const rawArgs = process.argv.slice(2);
const query = argv._.join(' ').trim();
if (!query) {
  console.error('usage: search "query" [--repo path|--json|--json-compact|--human|--stats|--no-ann|--context N|--type T|--backend memory|sqlite|sqlite-fts|...]|--mode code|prose|both|records|all|--meta key=value|--meta-json {...}|--path path|--file path|--ext .ext|--churn [min]|--modified-after date|--modified-since days|--chunk-author name|--signature|--param|--decorator|--inferred-type|--return-type|--throws|--reads|--writes|--mutates|--alias|--awaits|--branches|--loops|--breaks|--continues|--risk|--risk-tag|--risk-source|--risk-sink|--risk-category|--risk-flow|--extends|--visibility|--async|--generator|--returns');
  process.exit(1);
}
const contextLines = Math.max(0, parseInt(argv.context, 10) || 0);
const searchType = argv.type || null;
const searchAuthor = argv.author || null;
const searchImport = argv.import || null;
const chunkAuthorFilter = argv['chunk-author'] || null;
const searchMode = String(argv.mode || 'both').toLowerCase();
const allowedModes = new Set(['code', 'prose', 'both', 'records', 'all']);
if (!allowedModes.has(searchMode)) {
  console.error(`Invalid --mode ${searchMode}. Use code|prose|both|records|all.`);
  process.exit(1);
}
const runCode = searchMode === 'code' || searchMode === 'both' || searchMode === 'all';
const runProse = searchMode === 'prose' || searchMode === 'both' || searchMode === 'all';
const runRecords = searchMode === 'records' || searchMode === 'all';
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
let useSqlite = needsSqlite && (backendForcedSqlite || (!backendDisabled && sqliteConfigured)) && sqliteAvailable;
let dbCode = null;
let dbProse = null;
const vectorAnnState = {
  code: { available: false },
  prose: { available: false },
  records: { available: false }
};
const vectorAnnUsed = { code: false, prose: false, records: false };
let vectorAnnWarned = false;
if (useSqlite) {
  let Database;
  try {
    ({ default: Database } = await import('better-sqlite3'));
  } catch (err) {
    console.error('better-sqlite3 is required for the SQLite backend. Run npm install first.');
    process.exit(1);
  }

  const requiredTables = sqliteFtsRequested
    ? [
      'chunks',
      'chunks_fts',
      'minhash_signatures',
      'dense_vectors',
      'dense_meta'
    ]
    : [
      'chunks',
      'token_vocab',
      'token_postings',
      'doc_lengths',
      'token_stats',
      'phrase_vocab',
      'phrase_postings',
      'chargram_vocab',
      'chargram_postings',
      'minhash_signatures',
      'dense_vectors',
      'dense_meta'
    ];

  const openSqlite = (dbPath, label) => {
    const db = new Database(dbPath, { readonly: true });
    const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = new Set(tableRows.map((row) => row.name));
    const missing = requiredTables.filter((name) => !tableNames.has(name));
    if (missing.length) {
      const message = `SQLite index ${label} is missing required tables (${missing.join(', ')}). Rebuild with npm run build-sqlite-index.`;
      if (backendForcedSqlite) {
        console.error(message);
        process.exit(1);
      }
      console.warn(`${message} Falling back to file-backed indexes.`);
      db.close();
      return null;
    }
    return db;
  };

  const initVectorAnn = (db, mode) => {
    if (!vectorAnnEnabled || !db) return;
    const loadResult = loadVectorExtension(db, vectorExtension, `sqlite ${mode}`);
    if (!loadResult.ok) {
      if (!vectorAnnWarned) {
        const extPath = resolveVectorExtensionPath(vectorExtension);
        console.warn(`[ann] SQLite vector extension unavailable (${loadResult.reason}).`);
        console.warn(`[ann] Expected extension at ${extPath || 'unset'}; falling back to JS ANN.`);
        vectorAnnWarned = true;
      }
      return;
    }
    if (!hasVectorTable(db, vectorExtension.table)) {
      if (!vectorAnnWarned) {
        console.warn(`[ann] SQLite vector table missing (${vectorExtension.table}). Rebuild with npm run build-sqlite-index.`);
        vectorAnnWarned = true;
      }
      return;
    }
    vectorAnnState[mode].available = true;
  };

  if (needsCode) dbCode = openSqlite(sqliteCodePath, 'code');
  if (needsProse) dbProse = openSqlite(sqliteProsePath, 'prose');
  if (needsCode) initVectorAnn(dbCode, 'code');
  if (needsProse) initVectorAnn(dbProse, 'prose');
  if ((needsCode && !dbCode) || (needsProse && !dbProse)) {
    if (dbCode) dbCode.close();
    if (dbProse) dbProse.close();
    dbCode = null;
    dbProse = null;
    useSqlite = false;
  }
}

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
const dictionaryPaths = await getDictionaryPaths(ROOT, dictConfig);
const dict = new Set();
for (const dictFile of dictionaryPaths) {
  try {
    const contents = fsSync.readFileSync(dictFile, 'utf8');
    contents
      .split(/\r?\n/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean)
      .forEach((w) => dict.add(w));
  } catch {}
}

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

// --- LOAD INDEX ---
/**
 * Load file-backed index artifacts from a directory.
 * @param {string} dir
 * @returns {object}
 */
function loadIndex(dir) {
  const readJson = (name) => JSON.parse(fsSync.readFileSync(path.join(dir, name), 'utf8'));
  const loadOptional = (name) => {
    try {
      return readJson(name);
    } catch {
      return null;
    }
  };
  const chunkMeta = readJson('chunk_meta.json');
  const denseVec = loadOptional('dense_vectors_uint8.json');
  if (denseVec && !denseVec.model) denseVec.model = modelIdDefault;
  const idx = {
    chunkMeta,
    denseVec,
    minhash: loadOptional('minhash_signatures.json'),
    phraseNgrams: loadOptional('phrase_ngrams.json'),
    chargrams: loadOptional('chargram_postings.json')
  };
  try {
    idx.tokenIndex = readJson('token_postings.json');
  } catch {}
  return idx;
}
/**
 * Resolve the index directory (cache-first, local fallback).
 * @param {'code'|'prose'|'records'} mode
 * @returns {string}
 */
function resolveIndexDir(mode) {
  const cached = getIndexDir(ROOT, mode, userConfig);
  const cachedMeta = path.join(cached, 'chunk_meta.json');
  if (fsSync.existsSync(cachedMeta)) return cached;
  const local = path.join(ROOT, `index-${mode}`);
  const localMeta = path.join(local, 'chunk_meta.json');
  if (fsSync.existsSync(localMeta)) return local;
  return cached;
}

/**
 * Build a size/mtime signature for a file.
 * @param {string} filePath
 * @returns {string|null}
 */
function fileSignature(filePath) {
  try {
    const stat = fsSync.statSync(filePath);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return null;
  }
}

/**
 * Build a signature payload for cache invalidation.
 * @returns {object}
 */
function getIndexSignature() {
  if (useSqlite) {
    const recordDir = runRecords ? resolveIndexDir('records') : null;
    const recordMeta = recordDir ? path.join(recordDir, 'chunk_meta.json') : null;
    const recordDense = recordDir ? path.join(recordDir, 'dense_vectors_uint8.json') : null;
    return {
      backend: backendLabel,
      code: fileSignature(sqliteCodePath),
      prose: fileSignature(sqliteProsePath),
      records: recordMeta ? fileSignature(recordMeta) : null,
      recordsDense: recordDense ? fileSignature(recordDense) : null
    };
  }
  const codeDir = resolveIndexDir('code');
  const proseDir = resolveIndexDir('prose');
  const codeMeta = path.join(codeDir, 'chunk_meta.json');
  const proseMeta = path.join(proseDir, 'chunk_meta.json');
  const codeDense = path.join(codeDir, 'dense_vectors_uint8.json');
  const proseDense = path.join(proseDir, 'dense_vectors_uint8.json');
  const recordDir = runRecords ? resolveIndexDir('records') : null;
  const recordMeta = recordDir ? path.join(recordDir, 'chunk_meta.json') : null;
  const recordDense = recordDir ? path.join(recordDir, 'dense_vectors_uint8.json') : null;
  return {
    backend: backendLabel,
    code: fileSignature(codeMeta),
    prose: fileSignature(proseMeta),
    codeDense: fileSignature(codeDense),
    proseDense: fileSignature(proseDense),
    records: recordMeta ? fileSignature(recordMeta) : null,
    recordsDense: recordDense ? fileSignature(recordDense) : null
  };
}

/**
 * Build a deterministic cache key for the current query + settings.
 * @returns {{key:string,payload:object}}
 */
function buildQueryCacheKey() {
  const payload = {
    query,
    backend: backendLabel,
    mode: searchMode,
    topN: argv.n,
    ann: annEnabled,
    annMode: vectorExtension.annMode,
    annProvider: vectorExtension.provider,
    annExtension: vectorAnnEnabled,
    sqliteFtsNormalize,
    sqliteFtsProfile,
    sqliteFtsWeights,
    models: {
      code: modelIdForCode,
      prose: modelIdForProse,
      records: modelIdForRecords
    },
    filters: {
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
    }
  };
  const raw = JSON.stringify(payload);
  const key = crypto.createHash('sha1').update(raw).digest('hex');
  return { key, payload };
}


const idxProse = runProse
  ? (useSqlite ? loadIndexFromSqlite('prose') : loadIndex(resolveIndexDir('prose')))
  : { chunkMeta: [], denseVec: null, minhash: null };
const idxCode = runCode
  ? (useSqlite ? loadIndexFromSqlite('code') : loadIndex(resolveIndexDir('code')))
  : { chunkMeta: [], denseVec: null, minhash: null };
const idxRecords = runRecords
  ? loadIndex(resolveIndexDir('records'))
  : { chunkMeta: [], denseVec: null, minhash: null };
modelIdForCode = runCode ? (idxCode?.denseVec?.model || modelIdDefault) : null;
modelIdForProse = runProse ? (idxProse?.denseVec?.model || modelIdDefault) : null;
modelIdForRecords = runRecords ? (idxRecords?.denseVec?.model || modelIdDefault) : null;

// --- QUERY TOKENIZATION ---
const parsedQuery = parseQueryInput(query);
const includeTokens = tokenizeQueryTerms(parsedQuery.includeTerms, dict);
const phraseTokens = parsedQuery.phrases
  .map((phrase) => tokenizePhrase(phrase, dict))
  .filter((tokens) => tokens.length);
const phraseInfo = buildPhraseNgrams(phraseTokens, postingsConfig);
const phraseNgrams = phraseInfo.ngrams;
const phraseNgramSet = phraseNgrams.length ? new Set(phraseNgrams) : null;
const phraseRange = { min: phraseInfo.minLen, max: phraseInfo.maxLen };
const excludeTokens = tokenizeQueryTerms(parsedQuery.excludeTerms, dict);
const excludePhraseTokens = parsedQuery.excludePhrases
  .map((phrase) => tokenizePhrase(phrase, dict))
  .filter((tokens) => tokens.length);
const excludePhraseInfo = buildPhraseNgrams(excludePhraseTokens, postingsConfig);
const excludePhraseNgrams = excludePhraseInfo.ngrams;
const excludePhraseRange = excludePhraseInfo.minLen && excludePhraseInfo.maxLen
  ? { min: excludePhraseInfo.minLen, max: excludePhraseInfo.maxLen }
  : null;
const queryTokens = [...includeTokens, ...phraseTokens.flat()];
const rx = queryTokens.length ? new RegExp(`(${queryTokens.join('|')})`, 'ig') : null;
const embeddingQueryText = [...parsedQuery.includeTerms, ...parsedQuery.phrases]
  .join(' ')
  .trim() || query;
// --- SEARCH BM25 TOKENS/PHRASES ---

/**
 * Build a candidate set from file-backed indexes (or SQLite).
 * @param {object} idx
 * @param {string[]} tokens
 * @param {'code'|'prose'} mode
 * @returns {Set<number>|null}
 */
function buildCandidateSet(idx, tokens, mode) {
  if (useSqlite && (mode === 'code' || mode === 'prose')) return buildCandidateSetSqlite(mode, tokens);

  const candidates = new Set();
  let matched = false;

  if (postingsConfig.enablePhraseNgrams !== false && idx.phraseNgrams?.vocab && idx.phraseNgrams?.postings) {
    const vocabIndex = new Map(idx.phraseNgrams.vocab.map((t, i) => [t, i]));
    const ngrams = extractNgrams(tokens, postingsConfig.phraseMinN, postingsConfig.phraseMaxN);
    for (const ng of ngrams) {
      const hit = vocabIndex.get(ng);
      if (hit === undefined) continue;
      const posting = idx.phraseNgrams.postings[hit] || [];
      posting.forEach((id) => candidates.add(id));
      matched = matched || posting.length > 0;
    }
  }

  if (postingsConfig.enableChargrams !== false && idx.chargrams?.vocab && idx.chargrams?.postings) {
    const vocabIndex = new Map(idx.chargrams.vocab.map((t, i) => [t, i]));
    for (const token of tokens) {
      for (let n = postingsConfig.chargramMinN; n <= postingsConfig.chargramMaxN; n++) {
        for (const gram of tri(token, n)) {
          const hit = vocabIndex.get(gram);
          if (hit === undefined) continue;
          const posting = idx.chargrams.postings[hit] || [];
          posting.forEach((id) => candidates.add(id));
          matched = matched || posting.length > 0;
        }
      }
    }
  }

  return matched ? candidates : null;
}

function getPhraseMatchInfo(chunk, phraseSet, range) {
  if (!phraseSet || !phraseSet.size || !chunk) return { matches: 0 };
  let ngrams = Array.isArray(chunk.ngrams) && chunk.ngrams.length ? chunk.ngrams : null;
  if (!ngrams && Array.isArray(chunk.tokens) && range?.min && range?.max) {
    ngrams = extractNgrams(chunk.tokens, range.min, range.max);
  }
  if (!ngrams || !ngrams.length) return { matches: 0 };
  let matches = 0;
  for (const ng of ngrams) {
    if (phraseSet.has(ng)) matches += 1;
  }
  return { matches };
}

// --- MAIN SEARCH PIPELINE ---
/**
 * Execute the full search pipeline for a mode.
 * @param {object} idx
 * @param {'code'|'prose'} mode
 * @param {number[]|null} queryEmbedding
 * @returns {Array<object>}
 */
function runSearch(idx, mode, queryEmbedding) {
  const meta = idx.chunkMeta;
  const sqliteEnabledForMode = useSqlite && (mode === 'code' || mode === 'prose');

  // Filtering
  const filteredMeta = filterChunks(meta, {
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
  });
  const allowedIdx = new Set(filteredMeta.map(c => c.id));

  // Main search: BM25 token match
  let candidates = null;
  let bmHits = [];
  if (sqliteEnabledForMode && sqliteFtsRequested) {
    bmHits = rankSqliteFts(idx, queryTokens, mode, argv.n * 3, sqliteFtsNormalize);
    candidates = bmHits.length ? new Set(bmHits.map(h => h.idx)) : null;
  } else {
    const tokenIndexOverride = sqliteEnabledForMode ? getTokenIndexForQuery(queryTokens, mode) : null;
    candidates = buildCandidateSet(idx, queryTokens, mode);
    bmHits = rankBM25({
      idx,
      tokens: queryTokens,
      topN: argv.n * 3,
      tokenIndexOverride,
      k1: bm25K1,
      b: bm25B
    });
  }
  // MinHash (embedding) ANN, if requested
  let annHits = [];
  let annSource = null;
  if (annEnabled) {
    if (queryEmbedding && vectorAnnState[mode]?.available) {
      annHits = rankVectorAnnSqlite(mode, queryEmbedding, argv.n * 3, candidates);
      if (!annHits.length && candidates && candidates.size) {
        annHits = rankVectorAnnSqlite(mode, queryEmbedding, argv.n * 3, null);
      }
      if (annHits.length) {
        vectorAnnUsed[mode] = true;
        annSource = 'sqlite-vector';
      }
    }
    if (!annHits.length && queryEmbedding && idx.denseVec?.vectors?.length) {   
      annHits = rankDenseVectors(idx, queryEmbedding, argv.n * 3, candidates);
      if (annHits.length) annSource = 'dense';
    }
    if (!annHits.length) {
      annHits = rankMinhash(idx, queryTokens, argv.n * 3);
      if (annHits.length) annSource = 'minhash';
    }
  }

  // Combine and dedup
  const allHits = new Map();
  const sparseType = (sqliteEnabledForMode && sqliteFtsRequested) ? 'fts' : 'bm25';
  const recordHit = (idxVal, update) => {
    const current = allHits.get(idxVal) || { bm25: null, fts: null, ann: null, annSource: null };
    allHits.set(idxVal, { ...current, ...update });
  };
  bmHits.forEach((h) => {
    recordHit(h.idx, sparseType === 'fts' ? { fts: h.score } : { bm25: h.score });
  });
  annHits.forEach((h) => {
    recordHit(h.idx, { ann: h.sim, annSource });
  });

  const scored = [...allHits.entries()]
    .filter(([idxVal]) => allowedIdx.has(idxVal))
    .map(([idxVal, scores]) => {
      const sparseScore = scores.fts ?? scores.bm25 ?? null;
      const annScore = scores.ann ?? null;
      const sparseTypeValue = scores.fts != null ? 'fts' : (scores.bm25 != null ? 'bm25' : null);
      let scoreType = null;
      let score = null;
      if (annScore != null && (sparseScore == null || annScore > sparseScore)) {
        scoreType = 'ann';
        score = annScore;
      } else if (sparseScore != null) {
        scoreType = sparseTypeValue;
        score = sparseScore;
      } else {
        scoreType = 'none';
        score = 0;
      }
      const chunk = meta[idxVal];
      if (!chunk) return null;
      let phraseMatches = 0;
      let phraseBoost = 0;
      let phraseFactor = 0;
      if (phraseNgramSet && phraseRange?.min && phraseRange?.max) {
        const matchInfo = getPhraseMatchInfo(chunk, phraseNgramSet, phraseRange);
        phraseMatches = matchInfo.matches;
        if (phraseMatches) {
          phraseFactor = Math.min(0.5, phraseMatches * 0.1);
          phraseBoost = score * phraseFactor;
          score += phraseBoost;
        }
      }
      const scoreBreakdown = {
        sparse: sparseScore != null ? {
          type: sparseTypeValue,
          score: sparseScore,
          normalized: scores.fts != null ? sqliteFtsNormalize : null,
          weights: scores.fts != null ? sqliteFtsWeights : null,
          profile: scores.fts != null ? sqliteFtsProfile : null,
          k1: scores.bm25 != null ? bm25K1 : null,
          b: scores.bm25 != null ? bm25B : null
        } : null,
        ann: annScore != null ? {
          score: annScore,
          source: scores.annSource || null
        } : null,
        phrase: phraseNgramSet ? {
          matches: phraseMatches,
          boost: phraseBoost,
          factor: phraseFactor
        } : null,
        selected: {
          type: scoreType,
          score
        }
      };
      return {
        idx: idxVal,
        score,
        scoreType,
        scoreBreakdown,
        chunk,
        sparseScore,
        sparseType: sparseTypeValue,
        annScore,
        annSource: scores.annSource || null
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.score - a.score) || (a.idx - b.idx))
    .slice(0, argv.n);

  const ranked = scored
    .map((entry) => ({
      ...entry.chunk,
      score: entry.score,
      scoreType: entry.scoreType,
      sparseScore: entry.sparseScore,
      sparseType: entry.sparseType,
      annScore: entry.annScore,
      annSource: entry.annSource,
      annType: entry.annSource,
      scoreBreakdown: entry.scoreBreakdown
    }))
    .filter(Boolean);

  return ranked;
}

/**
 * Build a compact search hit payload for tooling.
 * @param {object} hit
 * @returns {object}
 */
function compactHit(hit) {
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
    const signature = getIndexSignature();
    cacheSignature = JSON.stringify(signature);
    const cacheKeyInfo = buildQueryCacheKey();
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

  const needsEmbedding = !cacheHit && annEnabled && (
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
    : (runProse ? runSearch(idxProse, 'prose', queryEmbeddingProse) : []);
  const codeHits = cacheHit && cachedPayload
    ? (cachedPayload.code || [])
    : (runCode ? runSearch(idxCode, 'code', queryEmbeddingCode) : []);
  const recordHits = cacheHit && cachedPayload
    ? (cachedPayload.records || [])
    : (runRecords ? runSearch(idxRecords, 'records', queryEmbeddingRecords) : []);
  const annBackend = vectorAnnEnabled && (vectorAnnUsed.code || vectorAnnUsed.prose)
    ? 'sqlite-extension'
    : 'js';

  // Output
  if (jsonOutput) {
    // Full JSON
    const memory = process.memoryUsage();
    console.log(JSON.stringify({
      backend: backendLabel,
      prose: jsonCompact ? proseHits.map(compactHit) : proseHits,
      code: jsonCompact ? codeHits.map(compactHit) : codeHits,
      records: jsonCompact ? recordHits.map(compactHit) : recordHits,
      stats: {
        elapsedMs: Date.now() - t0,
        annEnabled,
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
