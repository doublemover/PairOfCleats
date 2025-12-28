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
import Snowball from 'snowball-stemmers';
import Minhash from 'minhash';
import { DEFAULT_MODEL_ID, getDictionaryPaths, getDictConfig, getIndexDir, getMetricsDir, getModelConfig, loadUserConfig, resolveSqlitePaths } from './tools/dict-utils.js';
import { getVectorExtensionConfig, hasVectorTable, loadVectorExtension, queryVectorAnn, resolveVectorExtensionPath } from './tools/vector-extension.js';

const argv = minimist(process.argv.slice(2), {
  boolean: ['json', 'human', 'stats', 'ann', 'headline', 'lint', 'churn', 'matched'],
  alias: { n: 'top', c: 'context', t: 'type' },
  default: { n: 5, context: 3 },
  string: ['calls', 'uses', 'signature', 'param', 'mode', 'backend', 'model', 'fts-profile'],
});
const t0 = Date.now();
const ROOT = process.cwd();
const userConfig = loadUserConfig(ROOT);
const modelConfig = getModelConfig(ROOT, userConfig);
const modelIdDefault = argv.model || modelConfig.id || DEFAULT_MODEL_ID;
const sqliteConfig = userConfig.sqlite || {};
const vectorExtension = getVectorExtensionConfig(ROOT, userConfig);
const bm25Config = userConfig.search?.bm25 || {};
const bm25K1 = Number.isFinite(Number(bm25Config.k1)) ? Number(bm25Config.k1) : 1.2;
const bm25B = Number.isFinite(Number(bm25Config.b)) ? Number(bm25Config.b) : 0.75;
const sqliteFtsNormalize = userConfig.search?.sqliteFtsNormalize === true;
const sqliteFtsProfile = (argv['fts-profile'] || process.env.PAIROFCLEATS_FTS_PROFILE || userConfig.search?.sqliteFtsProfile || 'balanced').toLowerCase();
const sqliteFtsWeightsConfig = userConfig.search?.sqliteFtsWeights || null;
const metricsDir = getMetricsDir(ROOT, userConfig);
const useStubEmbeddings = process.env.PAIROFCLEATS_EMBEDDINGS === 'stub';
const rawArgs = process.argv.slice(2);
const query = argv._.join(' ').trim();
if (!query) {
  console.error('usage: search "query" [--json|--human|--stats|--no-ann|--context N|--type T|--backend memory|sqlite|sqlite-fts|...]|--mode');
  process.exit(1);
}
const contextLines = Math.max(0, parseInt(argv.context, 10) || 0);
const searchType = argv.type || null;
const searchAuthor = argv.author || null;
const searchCall = argv.calls || null;
const searchImport = argv.import || null;
const searchMode = argv.mode || 'both';
const sqlitePaths = resolveSqlitePaths(ROOT, userConfig);
const sqliteCodePath = sqlitePaths.codePath;
const sqliteProsePath = sqlitePaths.prosePath;
const needsCode = searchMode !== 'prose';
const needsProse = searchMode !== 'code';
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

function resolveFtsWeights(profile, config) {
  const profiles = {
    balanced: { file: 0.2, name: 1.5, kind: 0.6, headline: 2.0, tokens: 1.0 },
    headline: { file: 0.1, name: 1.2, kind: 0.4, headline: 3.0, tokens: 1.0 },
    name: { file: 0.2, name: 2.5, kind: 0.8, headline: 1.2, tokens: 1.0 }
  };
  const base = profiles[profile] || profiles.balanced;

  if (Array.isArray(config)) {
    const values = config.map((v) => Number(v)).filter((v) => Number.isFinite(v));
    if (values.length >= 6) return values.slice(0, 6);
    if (values.length === 5) return [0, ...values];
  } else if (config && typeof config === 'object') {
    const merged = { ...base };
    for (const key of ['file', 'name', 'kind', 'headline', 'tokens']) {
      if (Number.isFinite(Number(config[key]))) merged[key] = Number(config[key]);
    }
    return [0, merged.file, merged.name, merged.kind, merged.headline, merged.tokens];
  }

  return [0, base.file, base.name, base.kind, base.headline, base.tokens];
}

const sqliteFtsWeights = resolveFtsWeights(sqliteFtsProfile, sqliteFtsWeightsConfig);

function buildFtsBm25Expr(weights) {
  const safe = weights.map((val) => (Number.isFinite(val) ? val : 1));
  return `bm25(chunks_fts, ${safe.join(', ')})`;
}

if (backendForcedSqlite && !sqliteAvailable) {
  const missing = [];
  if (needsCode && !sqliteCodeAvailable) missing.push(`code=${sqliteCodePath}`);
  if (needsProse && !sqliteProseAvailable) missing.push(`prose=${sqliteProsePath}`);
  const suffix = missing.length ? missing.join(', ') : 'missing sqlite index';
  console.error(`SQLite backend requested but index not found (${suffix}).`);
  process.exit(1);
}

let useSqlite = (backendForcedSqlite || (!backendDisabled && sqliteConfigured)) && sqliteAvailable;
let dbCode = null;
let dbProse = null;
const vectorAnnState = {
  code: { available: false },
  prose: { available: false }
};
const vectorAnnUsed = { code: false, prose: false };
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
const runCode = needsCode;
const runProse = needsProse;
let modelIdForCode = null;
let modelIdForProse = null;

function getSqliteDb(mode) {
  if (!useSqlite) return null;
  return mode === 'code' ? dbCode : dbProse;
}

const stemmer = Snowball.newStemmer('english');
const stem = (w) => stemmer.stem(w);
const camel = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2');
const splitId = (s) =>
  s.replace(/([a-z])([A-Z])/g, '$1 $2')        // split camelCase
    .replace(/[_\-]+/g, ' ')                   // split on _ and -
    .split(/[^a-zA-Z0-9]+/u)                   // split non-alphanum
    .flatMap(tok => tok.split(/(?<=.)(?=[A-Z])/)) // split merged camel even if lowercase input
    .map(t => t.toLowerCase())
    .filter(Boolean);

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
function loadIndex(dir) {
  const chunkMeta = JSON.parse(fsSync.readFileSync(path.join(dir, 'chunk_meta.json'), 'utf8'));
  const denseVec = JSON.parse(fsSync.readFileSync(path.join(dir, 'dense_vectors_uint8.json'), 'utf8'));
  if (!denseVec.model) denseVec.model = modelIdDefault;
  const idx = {
    chunkMeta,
    denseVec,
    minhash: JSON.parse(fsSync.readFileSync(path.join(dir, 'minhash_signatures.json'), 'utf8')),
    phraseNgrams: JSON.parse(fsSync.readFileSync(path.join(dir, 'phrase_ngrams.json'), 'utf8')),
    chargrams: JSON.parse(fsSync.readFileSync(path.join(dir, 'chargram_postings.json'), 'utf8'))
  };
  try {
    idx.tokenIndex = JSON.parse(fsSync.readFileSync(path.join(dir, 'token_postings.json'), 'utf8'));
  } catch {}
  return idx;
}
function resolveIndexDir(mode) {
  const cached = getIndexDir(ROOT, mode, userConfig);
  const cachedMeta = path.join(cached, 'chunk_meta.json');
  if (fsSync.existsSync(cachedMeta)) return cached;
  const local = path.join(ROOT, `index-${mode}`);
  const localMeta = path.join(local, 'chunk_meta.json');
  if (fsSync.existsSync(localMeta)) return local;
  return cached;
}

function fileSignature(filePath) {
  try {
    const stat = fsSync.statSync(filePath);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return null;
  }
}

function getIndexSignature() {
  if (useSqlite) {
    return {
      backend: backendLabel,
      code: fileSignature(sqliteCodePath),
      prose: fileSignature(sqliteProsePath)
    };
  }
  const codeDir = resolveIndexDir('code');
  const proseDir = resolveIndexDir('prose');
  const codeMeta = path.join(codeDir, 'chunk_meta.json');
  const proseMeta = path.join(proseDir, 'chunk_meta.json');
  const codeDense = path.join(codeDir, 'dense_vectors_uint8.json');
  const proseDense = path.join(proseDir, 'dense_vectors_uint8.json');
  return {
    backend: backendLabel,
    code: fileSignature(codeMeta),
    prose: fileSignature(proseMeta),
    codeDense: fileSignature(codeDense),
    proseDense: fileSignature(proseDense)
  };
}

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
      prose: modelIdForProse
    },
    filters: {
      type: searchType,
      author: searchAuthor,
      calls: searchCall,
      uses: argv.uses || null,
      signature: argv.signature || null,
      param: argv.param || null,
      import: searchImport,
      lint: argv.lint || false,
      churn: argv.churn || null
    }
  };
  const raw = JSON.stringify(payload);
  const key = crypto.createHash('sha1').update(raw).digest('hex');
  return { key, payload };
}

function loadQueryCache(cachePath) {
  if (!fsSync.existsSync(cachePath)) return { version: 1, entries: [] };
  try {
    const data = JSON.parse(fsSync.readFileSync(cachePath, 'utf8'));
    if (data && Array.isArray(data.entries)) return data;
  } catch {}
  return { version: 1, entries: [] };
}

function pruneQueryCache(cache, maxEntries) {
  if (!cache || !Array.isArray(cache.entries)) return cache;
  cache.entries = cache.entries
    .filter((entry) => entry && entry.key && entry.ts)
    .sort((a, b) => b.ts - a.ts);
  if (cache.entries.length > maxEntries) {
    cache.entries = cache.entries.slice(0, maxEntries);
  }
  return cache;
}

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    try {
      return JSON.parse(trimmed);
    } catch {
      return fallback;
    }
  }
  return value;
}

function parseArrayField(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      const parsed = parseJson(trimmed, []);
      return Array.isArray(parsed) ? parsed : [];
    }
    return trimmed.split(/\s+/).filter(Boolean);
  }
  return [];
}

function unpackUint32(buffer) {
  if (!buffer) return [];
  const view = new Uint32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4));
  return Array.from(view);
}

function loadIndexFromSqlite(mode) {
  const db = getSqliteDb(mode);
  if (!db) throw new Error('SQLite backend requested but database is not available.');
  const chunkRows = db.prepare('SELECT * FROM chunks WHERE mode = ? ORDER BY id').all(mode);
  let maxLocalId = -1;
  for (const row of chunkRows) {
    if (row.id > maxLocalId) maxLocalId = row.id;
  }

  const chunkMeta = maxLocalId >= 0 ? Array.from({ length: maxLocalId + 1 }) : [];
  for (const row of chunkRows) {
    chunkMeta[row.id] = {
      id: row.id,
      file: row.file,
      start: row.start,
      end: row.end,
      startLine: row.startLine,
      endLine: row.endLine,
      ext: row.ext,
      kind: row.kind,
      name: row.name,
      weight: typeof row.weight === 'number' ? row.weight : 1,
      headline: row.headline,
      preContext: parseJson(row.preContext, []),
      postContext: parseJson(row.postContext, []),
      tokens: parseArrayField(row.tokens),
      ngrams: parseJson(row.ngrams, []),
      codeRelations: parseJson(row.codeRelations, null),
      docmeta: parseJson(row.docmeta, null),
      stats: parseJson(row.stats, null),
      complexity: parseJson(row.complexity, null),
      lint: parseJson(row.lint, null),
      externalDocs: parseJson(row.externalDocs, null),
      last_modified: row.last_modified,
      last_author: row.last_author,
      churn: row.churn,
      chunk_authors: parseJson(row.chunk_authors, null)
    };
  }

  const signatures = Array.from({ length: chunkMeta.length });
  const sigStmt = db.prepare('SELECT doc_id, sig FROM minhash_signatures WHERE mode = ? ORDER BY doc_id');
  for (const row of sigStmt.iterate(mode)) {
    signatures[row.doc_id] = unpackUint32(row.sig);
  }
  const minhash = signatures.length ? { signatures } : null;

  const denseMeta = db.prepare('SELECT dims, scale, model FROM dense_meta WHERE mode = ?').get(mode) || {};
  const vectors = Array.from({ length: chunkMeta.length });
  const denseStmt = db.prepare('SELECT doc_id, vector FROM dense_vectors WHERE mode = ? ORDER BY doc_id');
  for (const row of denseStmt.iterate(mode)) {
    vectors[row.doc_id] = row.vector;
  }
  const fallbackVec = vectors.find((vec) => vec && vec.length);
  const denseVec = vectors.length ? {
    model: denseMeta.model || modelIdDefault,
    dims: denseMeta.dims || (fallbackVec ? fallbackVec.length : 0),
    scale: typeof denseMeta.scale === 'number' ? denseMeta.scale : 1.0,
    vectors
  } : null;

  return {
    chunkMeta,
    denseVec,
    minhash
  };
}

const SQLITE_IN_LIMIT = 900;
const sqliteCache = {
  tokenStats: new Map(),
  docLengths: new Map()
};

function chunkArray(items, size = SQLITE_IN_LIMIT) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function fetchVocabRows(mode, table, idColumn, valueColumn, values) {
  const db = getSqliteDb(mode);
  if (!db || !values.length) return [];
  const unique = Array.from(new Set(values));
  const rows = [];
  for (const chunk of chunkArray(unique)) {
    const placeholders = chunk.map(() => '?').join(',');
    const stmt = db.prepare(
      `SELECT ${idColumn} AS id, ${valueColumn} AS value FROM ${table} WHERE mode = ? AND ${valueColumn} IN (${placeholders})`
    );
    rows.push(...stmt.all(mode, ...chunk));
  }
  return rows;
}

function fetchPostingRows(mode, table, idColumn, ids, includeTf = false) {
  const db = getSqliteDb(mode);
  if (!db || !ids.length) return [];
  const unique = Array.from(new Set(ids));
  const rows = [];
  for (const chunk of chunkArray(unique)) {
    const placeholders = chunk.map(() => '?').join(',');
    const selectCols = includeTf
      ? `${idColumn} AS id, doc_id, tf`
      : `${idColumn} AS id, doc_id`;
    const stmt = db.prepare(
      `SELECT ${selectCols} FROM ${table} WHERE mode = ? AND ${idColumn} IN (${placeholders}) ORDER BY ${idColumn}, doc_id`
    );
    rows.push(...stmt.all(mode, ...chunk));
  }
  return rows;
}

function loadDocLengths(mode, totalDocs) {
  const db = getSqliteDb(mode);
  if (!db) return [];
  if (sqliteCache.docLengths.has(mode)) return sqliteCache.docLengths.get(mode);

  const lengths = Array.from({ length: totalDocs || 0 }, () => 0);
  let maxDocId = -1;
  const rows = db.prepare('SELECT doc_id, len FROM doc_lengths WHERE mode = ?').all(mode);
  for (const row of rows) {
    if (row.doc_id >= lengths.length) {
      lengths.length = row.doc_id + 1;
    }
    lengths[row.doc_id] = row.len;
    if (row.doc_id > maxDocId) maxDocId = row.doc_id;
  }
  if (!totalDocs) totalDocs = maxDocId + 1;
  if (lengths.length < totalDocs) lengths.length = totalDocs;

  sqliteCache.docLengths.set(mode, lengths);
  return lengths;
}

function loadTokenStats(mode) {
  const db = getSqliteDb(mode);
  if (!db) return { avgDocLen: 0, totalDocs: 0 };
  if (sqliteCache.tokenStats.has(mode)) return sqliteCache.tokenStats.get(mode);

  const row = db.prepare('SELECT avg_doc_len, total_docs FROM token_stats WHERE mode = ?').get(mode) || {};
  let totalDocs = typeof row.total_docs === 'number' ? row.total_docs : 0;
  let avgDocLen = typeof row.avg_doc_len === 'number' ? row.avg_doc_len : null;

  const lengths = loadDocLengths(mode, totalDocs);
  if (!totalDocs) totalDocs = lengths.length;
  if (avgDocLen === null) {
    const total = lengths.reduce((sum, len) => sum + len, 0);
    avgDocLen = lengths.length ? total / lengths.length : 0;
  }

  const stats = { avgDocLen, totalDocs };
  sqliteCache.tokenStats.set(mode, stats);
  return stats;
}

function getTokenIndexForQuery(tokens, mode) {
  const db = getSqliteDb(mode);
  if (!db) return null;
  const uniqueTokens = Array.from(new Set(tokens)).filter(Boolean);
  if (!uniqueTokens.length) return null;

  const vocabRows = fetchVocabRows(mode, 'token_vocab', 'token_id', 'token', uniqueTokens);
  if (!vocabRows.length) return null;

  const vocab = [];
  const vocabIndex = new Map();
  const tokenIdToIndex = new Map();
  const tokenIds = [];
  for (const row of vocabRows) {
    if (tokenIdToIndex.has(row.id)) continue;
    const idx = vocab.length;
    tokenIdToIndex.set(row.id, idx);
    vocabIndex.set(row.value, idx);
    vocab.push(row.value);
    tokenIds.push(row.id);
  }

  const postingRows = fetchPostingRows(mode, 'token_postings', 'token_id', tokenIds, true);
  const postings = Array.from({ length: vocab.length }, () => []);
  for (const row of postingRows) {
    const idx = tokenIdToIndex.get(row.id);
    if (idx === undefined) continue;
    postings[idx].push([row.doc_id, row.tf]);
  }

  const stats = loadTokenStats(mode);
  const docLengths = loadDocLengths(mode, stats.totalDocs);

  return {
    vocab,
    postings,
    docLengths,
    avgDocLen: stats.avgDocLen,
    totalDocs: stats.totalDocs,
    vocabIndex
  };
}

function buildCandidateSetSqlite(mode, tokens) {
  const db = getSqliteDb(mode);
  if (!db) return null;
  const candidates = new Set();
  let matched = false;

  const ngrams = extractNgrams(tokens, 2, 4);
  if (ngrams.length) {
    const phraseRows = fetchVocabRows(mode, 'phrase_vocab', 'phrase_id', 'ngram', ngrams);
    const phraseIds = phraseRows.map((row) => row.id);
    const postingRows = fetchPostingRows(mode, 'phrase_postings', 'phrase_id', phraseIds, false);
    for (const row of postingRows) {
      candidates.add(row.doc_id);
      matched = true;
    }
  }

  const gramSet = new Set();
  for (const token of tokens) {
    for (let n = 3; n <= 5; n++) {
      for (const gram of tri(token, n)) {
        gramSet.add(gram);
      }
    }
  }
  const grams = Array.from(gramSet);
  if (grams.length) {
    const gramRows = fetchVocabRows(mode, 'chargram_vocab', 'gram_id', 'gram', grams);
    const gramIds = gramRows.map((row) => row.id);
    const postingRows = fetchPostingRows(mode, 'chargram_postings', 'gram_id', gramIds, false);
    for (const row of postingRows) {
      candidates.add(row.doc_id);
      matched = true;
    }
  }

  return matched ? candidates : null;
}

function rankSqliteFts(idx, queryTokens, mode, topN, normalizeScores = false) {
  const db = getSqliteDb(mode);
  if (!db || !queryTokens.length) return [];
  const ftsQuery = queryTokens.join(' ');
  const bm25Expr = buildFtsBm25Expr(sqliteFtsWeights);
  const rows = db.prepare(
    `SELECT rowid AS id, ${bm25Expr} AS score FROM chunks_fts WHERE chunks_fts MATCH ? AND mode = ? ORDER BY score ASC, rowid ASC LIMIT ?`
  ).all(ftsQuery, mode, topN);
  const rawScores = rows.map((row) => -row.score);
  let min = 0;
  let max = 0;
  if (normalizeScores && rawScores.length) {
    min = Math.min(...rawScores);
    max = Math.max(...rawScores);
  }
  const hits = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.id < 0 || row.id >= idx.chunkMeta.length) continue;
    const weight = idx.chunkMeta[row.id]?.weight || 1;
    const raw = rawScores[i];
    const normalized = normalizeScores
      ? (max > min ? (raw - min) / (max - min) : 1)
      : raw;
    hits.push({ idx: row.id, score: normalized * weight });
  }
  return hits;
}

const idxProse = runProse
  ? (useSqlite ? loadIndexFromSqlite('prose') : loadIndex(resolveIndexDir('prose')))
  : { chunkMeta: [], denseVec: null, minhash: null };
const idxCode = runCode
  ? (useSqlite ? loadIndexFromSqlite('code') : loadIndex(resolveIndexDir('code')))
  : { chunkMeta: [], denseVec: null, minhash: null };
modelIdForCode = runCode ? (idxCode?.denseVec?.model || modelIdDefault) : null;
modelIdForProse = runProse ? (idxProse?.denseVec?.model || modelIdDefault) : null;

// --- QUERY TOKENIZATION ---
function splitWordsWithDict(token, dict) {
  if (!dict || dict.size === 0) return [token];
  const result = [];
  let i = 0;
  while (i < token.length) {
    let found = false;
    for (let j = token.length; j > i; j--) {
      const sub = token.slice(i, j);
      if (dict.has(sub)) {
        result.push(sub);
        i = j;
        found = true;
        break;
      }
    }
    if (!found) {
      // fallback: add single char to avoid infinite loop
      result.push(token[i]);
      i++;
    }
  }
  return result;
}


let queryTokens = splitId(query);

queryTokens = queryTokens.flatMap(tok => {
  if (tok.length <= 3 || dict.has(tok)) return [tok];
  return splitWordsWithDict(tok, dict);
});

const rx = queryTokens.length ? new RegExp(`(${queryTokens.join('|')})`, 'ig') : null;

// --- SEARCH BM25 TOKENS/PHRASES ---
function rankBM25Legacy(idx, tokens, topN) {
  const scores = new Map();
  const ids = idx.chunkMeta.map((_, i) => i);
  ids.forEach((i) => {
    const chunk = idx.chunkMeta[i];
    if (!chunk) return;
    let score = 0;
    tokens.forEach(tok => {
      if (chunk.tokens && chunk.tokens.includes(tok)) score += 1 * (chunk.weight || 1);
      if (chunk.ngrams && chunk.ngrams.includes(tok)) score += 2 * (chunk.weight || 1);
      if (chunk.headline && chunk.headline.includes(tok)) score += 3 * (chunk.weight || 1);
    });
    scores.set(i, score);
  });
  return [...scores.entries()]
    .filter(([i, s]) => s > 0)
    .map(([i, s]) => ({ idx: i, score: s }))
    .sort((a, b) => (b.score - a.score) || (a.idx - b.idx))
    .slice(0, topN);
}

function getTokenIndex(idx) {
  const tokenIndex = idx.tokenIndex;
  if (!tokenIndex || !tokenIndex.vocab || !tokenIndex.postings) return null;
  if (!tokenIndex.vocabIndex) {
    tokenIndex.vocabIndex = new Map(tokenIndex.vocab.map((t, i) => [t, i]));
  }
  if (!Array.isArray(tokenIndex.docLengths)) tokenIndex.docLengths = [];
  if (!tokenIndex.totalDocs) tokenIndex.totalDocs = tokenIndex.docLengths.length;
  if (!tokenIndex.avgDocLen) {
    const total = tokenIndex.docLengths.reduce((sum, len) => sum + len, 0);
    tokenIndex.avgDocLen = tokenIndex.docLengths.length ? total / tokenIndex.docLengths.length : 0;
  }
  return tokenIndex;
}

function rankBM25(idx, tokens, topN, tokenIndexOverride = null, k1 = 1.2, b = 0.75) {
  const tokenIndex = tokenIndexOverride || getTokenIndex(idx);
  if (!tokenIndex || !tokenIndex.vocab || !tokenIndex.postings) return rankBM25Legacy(idx, tokens, topN);

  const scores = new Map();
  const docLengths = tokenIndex.docLengths;
  const avgDocLen = tokenIndex.avgDocLen || 1;
  const totalDocs = tokenIndex.totalDocs || idx.chunkMeta.length || 1;

  const qtf = new Map();
  tokens.forEach((tok) => qtf.set(tok, (qtf.get(tok) || 0) + 1));

  for (const [tok, qCount] of qtf.entries()) {
    const tokIdx = tokenIndex.vocabIndex.get(tok);
    if (tokIdx === undefined) continue;
    const posting = tokenIndex.postings[tokIdx] || [];
    const df = posting.length;
    if (!df) continue;
    const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));

    for (const [docId, tf] of posting) {
      const dl = docLengths[docId] || 0;
      const denom = tf + k1 * (1 - b + b * (dl / avgDocLen));
      const score = idf * ((tf * (k1 + 1)) / denom) * qCount;
      scores.set(docId, (scores.get(docId) || 0) + score);
    }
  }

  const weighted = [...scores.entries()].map(([docId, score]) => {
    const weight = idx.chunkMeta[docId]?.weight || 1;
    return { idx: docId, score: score * weight };
  });

  return weighted
    .filter(({ score }) => score > 0)
    .sort((a, b) => (b.score - a.score) || (a.idx - b.idx))
    .slice(0, topN);
}

// --- SEARCH MINHASH ANN (for semantic embedding search) ---
function minhashSigForTokens(tokens) {
  const mh = new Minhash();
  tokens.forEach(t => mh.update(t));
  return mh.hashvalues;
}
function jaccard(sigA, sigB) {
  let match = 0;
  for (let i = 0; i < sigA.length; i++) if (sigA[i] === sigB[i]) match++;
  return match / sigA.length;
}
function rankMinhash(idx, tokens, topN) {
  if (!idx.minhash?.signatures?.length) return [];
  const qSig = minhashSigForTokens(tokens);
  const scored = idx.minhash.signatures
    .map((sig, i) => ({ idx: i, sim: jaccard(qSig, sig) }))
    .sort((a, b) => (b.sim - a.sim) || (a.idx - b.idx))
    .slice(0, topN);
  return scored;
}

function rankDenseVectors(idx, queryEmbedding, topN, candidateSet) {
  const vectors = idx.denseVec?.vectors;
  if (!queryEmbedding || !Array.isArray(vectors) || !vectors.length) return [];
  const dims = idx.denseVec?.dims || queryEmbedding.length;
  const levels = 256;
  const minVal = -1;
  const maxVal = 1;
  const scale = (maxVal - minVal) / (levels - 1);
  const ids = candidateSet ? Array.from(candidateSet) : vectors.map((_, i) => i);
  const scored = [];

  for (const id of ids) {
    const vec = vectors[id];
    const isArrayLike = Array.isArray(vec) || ArrayBuffer.isView(vec);
    if (!isArrayLike || vec.length !== dims) continue;
    let dot = 0;
    for (let i = 0; i < dims; i++) {
      const v = vec[i] * scale + minVal;
      dot += v * queryEmbedding[i];
    }
    scored.push({ idx: id, sim: dot });
  }

  return scored
    .sort((a, b) => (b.sim - a.sim) || (a.idx - b.idx))
    .slice(0, topN);
}

function rankVectorAnnSqlite(mode, queryEmbedding, topN, candidateSet) {
  const db = getSqliteDb(mode);
  if (!db || !queryEmbedding || !vectorAnnState[mode]?.available) return [];
  return queryVectorAnn(db, vectorExtension, queryEmbedding, topN, candidateSet);
}

function extractNgrams(tokens, nStart = 2, nEnd = 4) {
  const grams = [];
  for (let n = nStart; n <= nEnd; ++n) {
    for (let i = 0; i <= tokens.length - n; i++) {
      grams.push(tokens.slice(i, i + n).join('_'));
    }
  }
  return grams;
}

function tri(w, n = 3) {
  const s = `⟬${w}⟭`;
  const g = [];
  for (let i = 0; i <= s.length - n; i++) {
    g.push(s.slice(i, i + n));
  }
  return g;
}

function buildCandidateSet(idx, tokens, mode) {
  if (useSqlite) return buildCandidateSetSqlite(mode, tokens);

  const candidates = new Set();
  let matched = false;

  if (idx.phraseNgrams?.vocab && idx.phraseNgrams?.postings) {
    const vocabIndex = new Map(idx.phraseNgrams.vocab.map((t, i) => [t, i]));
    const ngrams = extractNgrams(tokens, 2, 4);
    for (const ng of ngrams) {
      const hit = vocabIndex.get(ng);
      if (hit === undefined) continue;
      const posting = idx.phraseNgrams.postings[hit] || [];
      posting.forEach((id) => candidates.add(id));
      matched = matched || posting.length > 0;
    }
  }

  if (idx.chargrams?.vocab && idx.chargrams?.postings) {
    const vocabIndex = new Map(idx.chargrams.vocab.map((t, i) => [t, i]));
    for (const token of tokens) {
      for (let n = 3; n <= 5; n++) {
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

const embedderCache = new Map();
function stubEmbedding(text, dims) {
  const safeDims = Number.isFinite(dims) && dims > 0 ? Math.floor(dims) : 512;
  const hash = crypto.createHash('sha256').update(text).digest();
  let seed = 0;
  for (const byte of hash) seed = (seed * 31 + byte) >>> 0;
  const vec = new Array(safeDims);
  let x = seed;
  for (let i = 0; i < safeDims; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    vec[i] = (x / 0xffffffff) * 2 - 1;
  }
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}
async function getEmbedder(modelId) {
  if (embedderCache.has(modelId)) return embedderCache.get(modelId);
  const { pipeline, env } = await import('@xenova/transformers');
  const modelDir = modelConfig.dir;
  if (modelDir) {
    try {
      fsSync.mkdirSync(modelDir, { recursive: true });
    } catch {}
    env.cacheDir = modelDir;
  }
  const embedder = await pipeline('feature-extraction', modelId);
  embedderCache.set(modelId, embedder);
  return embedder;
}

async function getQueryEmbedding(text, modelId, dims) {
  if (useStubEmbeddings) {
    return stubEmbedding(text, dims);
  }
  try {
    const embedder = await getEmbedder(modelId || modelIdDefault);
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  } catch {
    return null;
  }
}

// --- ADVANCED FILTERING ---
function filterChunks(meta, opts = {}) {
  return meta.filter(c => {
    if (!c) return false;
    if (opts.type && c.kind && c.kind.toLowerCase() !== opts.type.toLowerCase()) return false;
    if (opts.author && c.last_author && !c.last_author.toLowerCase().includes(opts.author.toLowerCase())) return false;
    if (opts.call && c.codeRelations && c.codeRelations.calls) {
      const found = c.codeRelations.calls.find(([fn, call]) => call === opts.call || fn === opts.call);
      if (!found) return false;
    }
    if (opts.import && c.codeRelations && c.codeRelations.imports) {
      if (!c.codeRelations.imports.includes(opts.import)) return false;
    }
    if (opts.lint && (!c.lint || !c.lint.length)) return false;
    if (opts.churn && (!c.churn || c.churn < opts.churn)) return false;
    if (argv.calls && c.codeRelations && c.codeRelations.calls) {
      const found = c.codeRelations.calls.find(([fn, call]) => fn === argv.calls || call === argv.calls);
      if (!found) return false;
    }
    if (argv.uses && c.codeRelations && c.codeRelations.usages) {
      if (!c.codeRelations.usages.includes(argv.uses)) return false;
    }
    if (argv.signature && c.docmeta?.signature) {
      if (!c.docmeta.signature.includes(argv.signature)) return false;
    }
    if (argv.param && c.docmeta?.params) {
      if (!c.docmeta.params.includes(argv.param)) return false;
    }
    return true;
  });
}

function cleanContext(lines) {
  return lines
    .filter(l => {
      const t = l.trim();
      if (!t || t === '```') return false;
      // Skip lines where there is no alphanumeric content
      if (!/[a-zA-Z0-9]/.test(t)) return false;
      return true;
    })
    .map(l => l.replace(/\s+/g, ' ').trim()); // <— normalize whitespace here
}


// --- FORMAT OUTPUT ---
function getBodySummary(h, maxWords = 80) {
  try {
    const absPath = path.join(ROOT, h.file);
    const text = fsSync.readFileSync(absPath, 'utf8');
    const chunkText = text.slice(h.start, h.end)
      .replace(/\s+/g, ' ') // normalize spaces
      .trim();
    const words = chunkText.split(/\s+/).slice(0, maxWords).join(' ');
    return words;
  } catch {
    return '(Could not load summary)';
  }
}

let lastCount = 0;
function printFullChunk(chunk, idx, mode, annScore, annType = 'bm25') {
  if (!chunk || !chunk.file) {
    return color.red(`   ${idx + 1}. [Invalid result — missing chunk or file]`) + '\n';
  }
  const c = color;
  let out = '';

  const line1 = [
    c.bold(c[mode === 'code' ? 'blue' : 'magenta'](`${idx + 1}. ${chunk.file}`)),
    c.cyan(chunk.name || ''),
    c.yellow(chunk.kind || ''),
    c.green(`${annScore.toFixed(2)}`),
    c.gray(`Start/End: ${chunk.start}/${chunk.end}`),
    (chunk.startLine && chunk.endLine)
      ? c.gray(`Lines: ${chunk.startLine}-${chunk.endLine}`)
      : '',
    typeof chunk.churn === 'number' ? c.yellow(`Churn: ${chunk.churn}`) : ''
  ].filter(Boolean).join('  ');

  out += line1 + '\n';

  const headlinePart = chunk.headline ? c.bold('Headline: ') + c.underline(chunk.headline) : '';
  const lastModPart = chunk.last_modified ? c.gray('Last Modified: ') + c.bold(chunk.last_modified) : '';
  const secondLine = [headlinePart, lastModPart].filter(Boolean).join('   ');
  if (secondLine) out += '   ' + secondLine + '\n';

  if (chunk.last_author && chunk.last_author !== '2xmvr')
    out += c.gray('   Last Author: ') + c.green(chunk.last_author) + '\n';

  if (chunk.imports?.length)
    out += c.magenta('   Imports: ') + chunk.imports.join(', ') + '\n';
  else if (chunk.codeRelations?.imports?.length)
    out += c.magenta('   Imports: ') + chunk.codeRelations.imports.join(', ') + '\n';

  if (chunk.exports?.length)
    out += c.blue('   Exports: ') + chunk.exports.join(', ') + '\n';
  else if (chunk.codeRelations?.exports?.length)
    out += c.blue('   Exports: ') + chunk.codeRelations.exports.join(', ') + '\n';

  if (chunk.codeRelations?.calls?.length)
    out += c.yellow('   Calls: ') + chunk.codeRelations.calls.map(([a, b]) => `${a}→${b}`).join(', ') + '\n';

  if (chunk.codeRelations?.importLinks?.length)
    out += c.green('   ImportLinks: ') + chunk.codeRelations.importLinks.join(', ') + '\n';

  // Usages
  if (chunk.codeRelations?.usages?.length) {
    const usageFreq = Object.create(null);
    chunk.codeRelations.usages.forEach(uRaw => {
      const u = typeof uRaw === 'string' ? uRaw.trim() : '';
      if (!u) return;
      usageFreq[u] = (usageFreq[u] || 0) + 1;
    });

    const usageEntries = Object.entries(usageFreq).sort((a, b) => b[1] - a[1]);
    const maxCount = usageEntries[0]?.[1] || 0;

    const usageStr = usageEntries.slice(0, 10).map(([u, count]) => {
      if (count === 1) return u;
      if (count === maxCount) return c.bold(c.yellow(`${u} (${count})`));
      return c.cyan(`${u} (${count})`);
    }).join(', ');

    if (usageStr.length) out += c.cyan('   Usages: ') + usageStr + '\n';
  }

  const uniqueTokens = [...new Set((chunk.tokens || []).map(t => t.trim()).filter(t => t))];
  if (uniqueTokens.length)
    out += c.magenta('   Tokens: ') + uniqueTokens.slice(0, 10).join(', ') + '\n';

  if (argv.matched) {
    const matchedTokens = queryTokens.filter(tok =>
      (chunk.tokens && chunk.tokens.includes(tok)) ||
      (chunk.ngrams && chunk.ngrams.includes(tok)) ||
      (chunk.headline && chunk.headline.includes(tok))
    );
    if (matchedTokens.length)
      out += c.gray('   Matched: ') + matchedTokens.join(', ') + '\n';
  }

  if (chunk.docmeta?.signature)
    out += c.cyan('   Signature: ') + chunk.docmeta.signature + '\n';

  if (chunk.lint?.length)
    out += c.red(`   Lint: ${chunk.lint.length} issues`) +
      (chunk.lint.length ? c.gray(' | ') + chunk.lint.slice(0,2).map(l => JSON.stringify(l.message)).join(', ') : '') + '\n';

  if (chunk.externalDocs?.length)
    out += c.blue('   Docs: ') + chunk.externalDocs.join(', ') + '\n';

  const cleanedPreContext = chunk.preContext ? cleanContext(chunk.preContext) : [];
  if (cleanedPreContext.length)
    out += c.gray('   preContext: ') + cleanedPreContext.map(l => c.green(l.trim())).join(' | ') + '\n';

  const cleanedPostContext = chunk.postContext ? cleanContext(chunk.postContext) : [];
  if (cleanedPostContext.length)
    out += c.gray('   postContext: ') + cleanedPostContext.map(l => c.green(l.trim())).join(' | ') + '\n';

  if (idx === 0) {
    lastCount = 0;
  }
  if (idx < 5) {
    let maxWords = 10;
    let lessPer = 3;
    maxWords -= (lessPer*idx);
    const bodySummary = getBodySummary(chunk, maxWords);
    if (lastCount < maxWords) {
      maxWords = bodySummary.length; 
    }
    lastCount = bodySummary.length;
    out += c.gray('   Summary: ') + `${getBodySummary(chunk, maxWords)}` + '\n';
  }

  out += c.gray(''.padEnd(60, '—')) + '\n';
  return out;
}


function printShortChunk(chunk, idx, mode, annScore, annType = 'bm25') {        
  if (!chunk || !chunk.file) {
    return color.red(`   ${idx + 1}. [Invalid result — missing chunk or file]`) + '\n';
  }
  let out = '';
  out += `${color.bold(color[mode === 'code' ? 'blue' : 'magenta'](`${idx + 1}. ${chunk.file}`))}`;
  out += color.yellow(` [${annScore.toFixed(2)}]`);
  if (chunk.name) out += ' ' + color.cyan(chunk.name);
  out += color.gray(` (${chunk.kind || 'unknown'})`);
  if (chunk.last_author && chunk.last_author !== '2xmvr') out += color.green(` by ${chunk.last_author}`);
  if (chunk.headline) out += ` - ${color.underline(chunk.headline)}`;
  else if (chunk.tokens && chunk.tokens.length && rx)
    out += ' - ' + chunk.tokens.slice(0, 10).join(' ').replace(rx, (m) => color.bold(color.yellow(m)));

  if (argv.matched) {
    const matchedTokens = queryTokens.filter(tok =>
      (chunk.tokens && chunk.tokens.includes(tok)) ||
      (chunk.ngrams && chunk.ngrams.includes(tok)) ||
      (chunk.headline && chunk.headline.includes(tok))
    );
    if (matchedTokens.length)
      out += color.gray(` Matched: ${matchedTokens.join(', ')}`);
  }

  out += '\n';
  return out;
}


// --- MAIN SEARCH PIPELINE ---
function runSearch(idx, mode, queryEmbedding) {
  const meta = idx.chunkMeta;

  // Filtering
  const filteredMeta = filterChunks(meta, {
    type: searchType,
    author: searchAuthor,
    call: searchCall,
    import: searchImport,
    lint: argv.lint,
    churn: argv.churn
  });
  const allowedIdx = new Set(filteredMeta.map(c => c.id));

  // Main search: BM25 token match
  let candidates = null;
  let bmHits = [];
  if (useSqlite && sqliteFtsRequested) {
    bmHits = rankSqliteFts(idx, queryTokens, mode, argv.n * 3, sqliteFtsNormalize);
    candidates = bmHits.length ? new Set(bmHits.map(h => h.idx)) : null;
  } else {
    const tokenIndexOverride = useSqlite ? getTokenIndexForQuery(queryTokens, mode) : null;
    candidates = buildCandidateSet(idx, queryTokens, mode);
    bmHits = rankBM25(idx, queryTokens, argv.n * 3, tokenIndexOverride, bm25K1, bm25B);
  }
  // MinHash (embedding) ANN, if requested
  let annHits = [];
  if (annEnabled) {
    if (queryEmbedding && vectorAnnState[mode]?.available) {
      annHits = rankVectorAnnSqlite(mode, queryEmbedding, argv.n * 3, candidates);
      if (!annHits.length && candidates && candidates.size) {
        annHits = rankVectorAnnSqlite(mode, queryEmbedding, argv.n * 3, null);
      }
      if (annHits.length) vectorAnnUsed[mode] = true;
    }
    if (!annHits.length && queryEmbedding && idx.denseVec?.vectors?.length) {
      annHits = rankDenseVectors(idx, queryEmbedding, argv.n * 3, candidates);
    }
    if (!annHits.length) {
      annHits = rankMinhash(idx, queryTokens, argv.n * 3);
    }
  }

  // Combine and dedup
  let allHits = new Map();
  bmHits.forEach(h => allHits.set(h.idx, { score: h.score, kind: 'bm25' }));
  annHits.forEach(h => {
    if (!allHits.has(h.idx) || h.sim > allHits.get(h.idx).score)
      allHits.set(h.idx, { score: h.sim, kind: 'ann' });
  });

  // Sort and map to final results
  const ranked = [...allHits.entries()]
    .filter(([idx, _]) => allowedIdx.has(idx))
    .sort((a, b) => (b[1].score - a[1].score) || (a[0] - b[0]))
    .slice(0, argv.n)
    .map(([idxVal, obj]) => {
      const chunk = meta[idxVal];
      return chunk ? { ...chunk, annScore: obj.score, annType: obj.kind } : null;
    })
    .filter(x => x);

  return ranked;
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
        if (cachedPayload && (cachedPayload.code || cachedPayload.prose)) {
          cacheHit = true;
          entry.ts = Date.now();
        }
      }
    }
  }

  const needsEmbedding = !cacheHit && annEnabled && (
    (runProse && (idxProse.denseVec?.vectors?.length || vectorAnnState.prose.available)) ||
    (runCode && (idxCode.denseVec?.vectors?.length || vectorAnnState.code.available))
  );
  const embeddingCache = new Map();
  const getEmbeddingForModel = async (modelId, dims) => {
    if (!modelId) return null;
    const cacheKey = useStubEmbeddings ? `${modelId}:${dims || 'default'}` : modelId;
    if (embeddingCache.has(cacheKey)) return embeddingCache.get(cacheKey);
    const embedding = await getQueryEmbedding(query, modelId, dims);
    embeddingCache.set(cacheKey, embedding);
    return embedding;
  };
  const queryEmbeddingCode = needsEmbedding && runCode && (idxCode.denseVec?.vectors?.length || vectorAnnState.code.available)
    ? await getEmbeddingForModel(modelIdForCode, idxCode.denseVec?.dims || null)
    : null;
  const queryEmbeddingProse = needsEmbedding && runProse && (idxProse.denseVec?.vectors?.length || vectorAnnState.prose.available)
    ? await getEmbeddingForModel(modelIdForProse, idxProse.denseVec?.dims || null)
    : null;
  const proseHits = cacheHit && cachedPayload
    ? (cachedPayload.prose || [])
    : (runProse ? runSearch(idxProse, 'prose', queryEmbeddingProse) : []);
  const codeHits = cacheHit && cachedPayload
    ? (cachedPayload.code || [])
    : (runCode ? runSearch(idxCode, 'code', queryEmbeddingCode) : []);
  const annBackend = vectorAnnEnabled && (vectorAnnUsed.code || vectorAnnUsed.prose)
    ? 'sqlite-extension'
    : 'js';

  // Output
  if (argv.json) {
    // Full JSON
    const memory = process.memoryUsage();
    console.log(JSON.stringify({
      backend: backendLabel,
      prose: proseHits,
      code: codeHits,
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
            prose: vectorAnnState.prose.available
          }
        } : null,
        models: {
          code: modelIdForCode,
          prose: modelIdForProse
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
    process.exit(0);
  }

  let showProse = runProse ? argv.n : 0;
  let showCode = runCode ? argv.n : 0;

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
    proseHits.slice(0, showProse).forEach((h, i) => {
      if (i < 2) {
        process.stdout.write(printFullChunk(h, i, 'prose', h.annScore, h.annType));
      } else {
        process.stdout.write(printShortChunk(h, i, 'prose', h.annScore, h.annType));
      }
    });
    console.log('\n');
  }

  if (runCode) {
    console.log(color.bold(`===== 🔨 Code Results (${backendLabel}) =====`));
    codeHits.slice(0, showCode).forEach((h, i) => {
      if (i < 1) {
        process.stdout.write(printFullChunk(h, i, 'code', h.annScore, h.annType));
      } else {
        process.stdout.write(printShortChunk(h, i, 'code', h.annScore, h.annType));
      }
    });
    console.log('\n');
  }

  // Optionally stats
  if (argv.stats) {
    const cacheTag = queryCacheEnabled ? (cacheHit ? 'cache=hit' : 'cache=miss') : 'cache=off';
    console.log(color.gray(`Stats: prose chunks=${idxProse.chunkMeta.length}, code chunks=${idxCode.chunkMeta.length} (${cacheTag})`));
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
    if (!metrics[f]) metrics[f] = { md: 0, code: 0, terms: [] };
    metrics[f][key]++;
    queryTokens.forEach((t) => {
      if (!metrics[f].terms.includes(t)) metrics[f].terms.push(t);
    });
  };
  proseHits.forEach((h) => inc(h.file, 'md'));
  codeHits.forEach((h) => inc(h.file, 'code'));
  await fs.writeFile(metricsPath, JSON.stringify(metrics) + '\n');

  await fs.appendFile(
    historyPath,
    JSON.stringify({
      time: new Date().toISOString(),
      query,
      mdFiles: proseHits.length,
      codeFiles: codeHits.length,
      ms: Date.now() - t0,
      cached: cacheHit,
    }) + '\n'
  );

  if (proseHits.length === 0 && codeHits.length === 0) {
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
          code: codeHits
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
