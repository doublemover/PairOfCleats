#!/usr/bin/env node
import fs from 'node:fs';
import minimist from 'minimist';
import { DEFAULT_MODEL_ID, getDictionaryPaths, getDictConfig, getModelConfig, loadUserConfig, resolveSqlitePaths } from './dict-utils.js';
import { getVectorExtensionConfig, hasVectorTable, loadVectorExtension, queryVectorAnn } from './vector-extension.js';
import { buildFtsBm25Expr, resolveFtsWeights } from '../src/search/fts.js';
import { getQueryEmbedding } from '../src/search/embedding.js';
import { splitId, splitWordsWithDict } from '../src/shared/tokenize.js';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error('better-sqlite3 is required. Run npm install first.');
  process.exit(1);
}

const rawArgs = process.argv.slice(2);
const argv = minimist(rawArgs, {
  boolean: ['json', 'ann'],
  string: ['mode', 'model', 'fts-profile'],
  alias: { n: 'top' },
  default: { n: 5 }
});

const query = argv._.join(' ').trim();
if (!query) {
  console.error('usage: search-sqlite "query" [--mode code|prose] [--model ID] [--no-ann]');
  process.exit(1);
}

const root = process.cwd();
const userConfig = loadUserConfig(root);
const modelConfig = getModelConfig(root, userConfig);
const modelIdDefault = argv.model || modelConfig.id || DEFAULT_MODEL_ID;
const annFlagPresent = rawArgs.includes('--ann') || rawArgs.includes('--no-ann');
const annDefault = userConfig.search?.annDefault !== false;
const annEnabled = annFlagPresent ? argv.ann : annDefault;
const vectorExtension = getVectorExtensionConfig(root, userConfig);
const vectorAnnEnabled = annEnabled && vectorExtension.enabled;
const sqliteFtsNormalize = userConfig.search?.sqliteFtsNormalize === true;
const sqliteFtsProfile = (argv['fts-profile'] || process.env.PAIROFCLEATS_FTS_PROFILE || userConfig.search?.sqliteFtsProfile || 'balanced').toLowerCase();
const sqliteFtsWeightsConfig = userConfig.search?.sqliteFtsWeights || null;
const sqlitePaths = resolveSqlitePaths(root, userConfig);
const requestedMode = argv.mode || null;
if (requestedMode && !['code', 'prose'].includes(requestedMode)) {
  console.error('Invalid mode. Use --mode code|prose');
  process.exit(1);
}

const needsCode = !requestedMode || requestedMode === 'code';
const needsProse = !requestedMode || requestedMode === 'prose';
const vectorAnnState = {
  code: { available: false },
  prose: { available: false }
};
let vectorAnnWarned = false;

/**
 * Open a readonly SQLite database for a mode.
 * @param {string} dbPath
 * @param {string} label
 * @returns {import('better-sqlite3').Database}
 */
function openDb(dbPath, label) {
  if (!fs.existsSync(dbPath)) {
    console.error(`SQLite ${label} index not found (${dbPath}).`);
    process.exit(1);
  }
  return new Database(dbPath, { readonly: true });
}

/**
 * Check if dense vectors exist for a mode.
 * @param {import('better-sqlite3').Database|null} db
 * @param {'code'|'prose'} mode
 * @returns {boolean}
 */
function hasDenseVectors(db, mode) {
  if (!db) return false;
  try {
    const row = db.prepare('SELECT 1 FROM dense_vectors WHERE mode = ? LIMIT 1').get(mode);
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Initialize vector ANN support for a database.
 * @param {import('better-sqlite3').Database|null} db
 * @param {'code'|'prose'} mode
 * @returns {void}
 */
function initVectorAnn(db, mode) {
  if (!vectorAnnEnabled || !db) return;
  const loadResult = loadVectorExtension(db, vectorExtension, `sqlite ${mode}`);
  if (!loadResult.ok) {
    if (!vectorAnnWarned) {
      console.warn(`[ann] SQLite vector extension unavailable (${loadResult.reason}).`);
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
}

const dbHandles = { code: null, prose: null };
if (needsCode) dbHandles.code = openDb(sqlitePaths.codePath, 'code');
if (needsProse) dbHandles.prose = openDb(sqlitePaths.prosePath, 'prose');
if (needsCode) initVectorAnn(dbHandles.code, 'code');
if (needsProse) initVectorAnn(dbHandles.prose, 'prose');

/**
 * Get the database handle for a mode.
 * @param {'code'|'prose'} mode
 * @returns {import('better-sqlite3').Database|null}
 */
function getDbForMode(mode) {
  return mode === 'code' ? dbHandles.code : dbHandles.prose;
}

const sqliteFtsWeights = resolveFtsWeights(sqliteFtsProfile, sqliteFtsWeightsConfig);

const dictConfig = getDictConfig(root, userConfig);
const dictionaryPaths = await getDictionaryPaths(root, dictConfig);
const dict = new Set();
for (const dictFile of dictionaryPaths) {
  try {
    const contents = fs.readFileSync(dictFile, 'utf8');
    contents
      .split(/\r?\n/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean)
      .forEach((w) => dict.add(w));
  } catch {}
}

let queryTokens = splitId(query);
queryTokens = queryTokens.flatMap((tok) => {
  if (tok.length <= 3 || dict.has(tok)) return [tok];
  return splitWordsWithDict(tok, dict);
});
const ftsQuery = queryTokens.length ? queryTokens.join(' ') : query;
const topN = Math.max(1, parseInt(argv.n, 10) || 5);

const chunksStmtCache = new WeakMap();
/**
 * Fetch a chunk row for a rowid.
 * @param {import('better-sqlite3').Database} db
 * @param {number} rowid
 * @returns {object|undefined}
 */
function getChunk(db, rowid) {
  let stmt = chunksStmtCache.get(db);
  if (!stmt) {
    stmt = db.prepare('SELECT * FROM chunks WHERE id = ?');
    chunksStmtCache.set(db, stmt);
  }
  return stmt.get(rowid);
}

/**
 * Run an FTS query and return rowid/score pairs.
 * @param {import('better-sqlite3').Database} db
 * @param {'code'|'prose'} mode
 * @returns {Array<{rowid:number,score:number}>}
 */
function runFtsQuery(db, mode) {
  const bm25Expr = buildFtsBm25Expr(sqliteFtsWeights);
  const ftsStmt = db.prepare(
    `SELECT rowid, ${bm25Expr} AS score
     FROM chunks_fts
     WHERE chunks_fts MATCH ?
     AND mode = ?
     ORDER BY score ASC, rowid ASC
     LIMIT ?`
  );
  const rows = ftsStmt.all(ftsQuery, mode, topN * 3);
  const rawScores = rows.map((row) => -row.score);
  let min = 0;
  let max = 0;
  if (sqliteFtsNormalize && rawScores.length) {
    min = Math.min(...rawScores);
    max = Math.max(...rawScores);
  }
  return rows.map((row, idx) => {
    const raw = rawScores[idx];
    const normalized = sqliteFtsNormalize
      ? (max > min ? (raw - min) / (max - min) : 1)
      : raw;
    return { rowid: row.rowid, score: normalized };
  });
}

const hits = new Map();
/**
 * Add or update a hit entry.
 * @param {import('better-sqlite3').Database} db
 * @param {number} rowid
 * @param {number} score
 * @param {string} kind
 * @param {'code'|'prose'} mode
 * @returns {void}
 */
function addHit(db, rowid, score, kind, mode) {
  const chunk = getChunk(db, rowid);
  if (!chunk) return;
  const key = `${mode}:${rowid}`;
  const existing = hits.get(key);
  if (!existing || score > existing.score) {
    hits.set(key, { chunk, score, kind, mode, rowid, db });
  }
}

if (needsCode && dbHandles.code) {
  for (const row of runFtsQuery(dbHandles.code, 'code')) {
    addHit(dbHandles.code, row.rowid, row.score, 'bm25', 'code');
  }
}
if (needsProse && dbHandles.prose) {
  for (const row of runFtsQuery(dbHandles.prose, 'prose')) {
    addHit(dbHandles.prose, row.rowid, row.score, 'bm25', 'prose');
  }
}

/**
 * Load dense vectors for a mode.
 * @param {import('better-sqlite3').Database} db
 * @param {'code'|'prose'} mode
 * @returns {{model:string,dims:number,scale:number,vectors:Array<Buffer|undefined>}}
 */
function loadDenseVectorsFromDb(db, mode) {
  const meta = db.prepare('SELECT dims, scale, model FROM dense_meta WHERE mode = ?').get(mode) || {};
  const vectors = [];
  const rows = db.prepare('SELECT doc_id, vector FROM dense_vectors WHERE mode = ? ORDER BY doc_id').all(mode);
  for (const row of rows) {
    vectors[row.doc_id] = row.vector;
  }
  const fallbackVec = vectors.find((vec) => vec && vec.length);
  return {
    model: meta.model || modelIdDefault,
    dims: meta.dims || (fallbackVec ? fallbackVec.length : 0),
    scale: typeof meta.scale === 'number' ? meta.scale : 1.0,
    vectors
  };
}

/**
 * Load dense metadata for a mode.
 * @param {import('better-sqlite3').Database} db
 * @param {'code'|'prose'} mode
 * @returns {{dims?:number,scale?:number,model?:string}}
 */
function loadDenseMetaFromDb(db, mode) {
  return db.prepare('SELECT dims, scale, model FROM dense_meta WHERE mode = ?').get(mode) || {};
}

/**
 * Score a quantized vector against a query embedding.
 * @param {Buffer} vec
 * @param {number[]} queryEmbedding
 * @returns {number}
 */
function scoreVector(vec, queryEmbedding) {
  const levels = 256;
  const minVal = -1;
  const maxVal = 1;
  const scale = (maxVal - minVal) / (levels - 1);
  let dot = 0;
  const dims = Math.min(vec.length, queryEmbedding.length);
  for (let i = 0; i < dims; i++) {
    dot += (vec[i] * scale + minVal) * queryEmbedding[i];
  }
  return dot;
}

const vectorAnnAvailable = vectorAnnEnabled && (
  (needsCode && vectorAnnState.code.available) ||
  (needsProse && vectorAnnState.prose.available)
);
const denseAvailable = annEnabled && (
  (needsCode && hasDenseVectors(dbHandles.code, 'code')) ||
  (needsProse && hasDenseVectors(dbHandles.prose, 'prose'))
);

if (annEnabled && (vectorAnnAvailable || denseAvailable)) {
  const embeddingCache = new Map();
  /**
   * Resolve a query embedding for a model.
   * @param {string} modelId
   * @returns {Promise<number[]|null>}
   */
  const getEmbeddingForModel = async (modelId) => {
    if (!modelId) return null;
    if (embeddingCache.has(modelId)) return embeddingCache.get(modelId);
    const embedding = await getQueryEmbedding({
      text: query,
      modelId,
      dims: null,
      modelDir: modelConfig.dir,
      useStub: process.env.PAIROFCLEATS_EMBEDDINGS === 'stub'
    });
    embeddingCache.set(modelId, embedding);
    return embedding;
  };

  const candidatesByMode = new Map();
  for (const hit of hits.values()) {
    const list = candidatesByMode.get(hit.mode) || new Set();
    list.add(hit.rowid);
    candidatesByMode.set(hit.mode, list);
  }

  const modes = [];
  if (needsCode && getDbForMode('code')) modes.push('code');
  if (needsProse && getDbForMode('prose')) modes.push('prose');

  for (const mode of modes) {
    const db = getDbForMode(mode);
    if (!db) continue;
    const candidateRowids = candidatesByMode.get(mode);
    const candidateSet = candidateRowids && candidateRowids.size ? candidateRowids : null;

    const denseMeta = loadDenseMetaFromDb(db, mode);
    const embedding = await getEmbeddingForModel(denseMeta.model || modelIdDefault);
    if (!embedding) continue;

    let usedVector = false;
    if (vectorAnnState[mode].available) {
      const annHits = queryVectorAnn(db, vectorExtension, embedding, topN * 3, candidateSet);
      if (annHits.length) {
        usedVector = true;
        for (const hit of annHits) {
          const chunk = getChunk(db, hit.idx);
          if (!chunk) continue;
          const key = `${mode}:${hit.idx}`;
          const existing = hits.get(key);
          if (existing) {
            hits.set(key, { ...existing, score: existing.score + hit.sim, kind: 'ann' });
          } else {
            hits.set(key, { chunk, score: hit.sim, kind: 'ann', mode, rowid: hit.idx, db });
          }
        }
      }
    }

    if (!usedVector) {
      const dense = loadDenseVectorsFromDb(db, mode);
      if (!dense?.vectors?.length) continue;
      const candidateDocIds = [];
      if (candidateSet) {
        for (const rowid of candidateSet) {
          if (rowid >= 0) candidateDocIds.push(rowid);
        }
      } else {
        for (let i = 0; i < dense.vectors.length; i++) candidateDocIds.push(i);
      }

      for (const docId of candidateDocIds) {
        const vec = dense.vectors[docId];
        if (!vec) continue;
        const score = scoreVector(vec, embedding);
        const chunk = getChunk(db, docId);
        if (!chunk) continue;
        const key = `${mode}:${docId}`;
        const existing = hits.get(key);
        if (existing) {
          hits.set(key, { ...existing, score: existing.score + score, kind: 'ann' });
        } else {
          hits.set(key, { chunk, score, kind: 'ann', mode, rowid: docId, db });
        }
      }
    }
  }
}

/**
 * Normalize score kind labels.
 * @param {string} kind
 * @returns {string}
 */
function normalizeKind(kind) {
  if (!kind) return 'bm25';
  const value = String(kind).toLowerCase();
  if (value === 'fts') return 'bm25';
  if (value === 'fts+ann') return 'ann';
  return value;
}

const ranked = [...hits.values()]
  .sort((a, b) => (b.score - a.score) || a.mode.localeCompare(b.mode) || (a.rowid - b.rowid))
  .slice(0, topN)
  .map((hit) => ({ ...hit.chunk, annScore: hit.score, annType: normalizeKind(hit.kind) }));

if (argv.json) {
  console.log(JSON.stringify(ranked, null, 2));
} else {
  ranked.forEach((chunk, i) => {
    console.log(`${i + 1}. ${chunk.file} ${chunk.name || ''} [${chunk.annScore.toFixed(2)}]`);
  });
}

for (const db of [dbHandles.code, dbHandles.prose]) {
  if (db) db.close();
}
