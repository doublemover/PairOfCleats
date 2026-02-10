import { extractNgrams, tri } from '../shared/tokenize.js';
import { forEachRollingChargramHash } from '../shared/chargram-hash.js';
import { chunkArray } from '../storage/sqlite/utils.js';
import { resolveDenseMetaRecord } from '../storage/sqlite/quantization.js';
import { fetchVocabRows as fetchSqliteVocabRows } from '../storage/sqlite/vocab.js';
import { parseArrayField, parseJson } from './query-cache.js';
import { buildFtsBm25Expr } from './fts.js';
import { buildFilterIndex } from './filter-index.js';

const SQLITE_IN_LIMIT = 900;
const FTS_TOKEN_SAFE = /^[\p{L}\p{N}_]+$/u;

/**
 * Create SQLite helper functions for search.
 * @param {object} options
 * @param {(mode:'code'|'prose')=>import('better-sqlite3').Database|null} options.getDb
 * @param {object} options.postingsConfig
 * @param {number[]} options.sqliteFtsWeights
 * @param {number|null|undefined} options.maxCandidates
 * @param {object} options.vectorExtension
 * @param {object} [options.vectorAnnConfigByMode]
 * @param {object} options.vectorAnnState
 * @param {Function} options.queryVectorAnn
 * @param {string} options.modelIdDefault
 * @returns {object}
 */
export function createSqliteHelpers(options) {
  const {
    getDb,
    postingsConfig,
    sqliteFtsWeights,
    maxCandidates,
    vectorExtension,
    vectorAnnConfigByMode,
    vectorAnnState,
    queryVectorAnn,
    modelIdDefault,
    fileChargramN
  } = options;
  const resolveVectorAnnConfig = (mode) => (
    vectorAnnConfigByMode?.[mode] || vectorExtension
  );
  const chargramMaxTokenLength = postingsConfig?.chargramMaxTokenLength == null
    ? null
    : Math.max(2, Math.floor(Number(postingsConfig.chargramMaxTokenLength)));
  const candidateCap = Number.isFinite(Number(maxCandidates)) && Number(maxCandidates) > 0
    ? Math.floor(Number(maxCandidates))
    : null;

  const sqliteCache = {
    tokenStats: new Map(),
    docLengths: new Map(),
    chargramHashMode: new Map()
  };
  const statementCache = new WeakMap();
  const ftsAvailability = new WeakMap();

  const hasFtsTable = (mode) => {
    const db = getDb(mode);
    if (!db) return false;
    const cached = ftsAvailability.get(db);
    if (cached) return cached.available;
    let available = false;
    try {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'").get();
      available = Boolean(row?.name);
    } catch {
      available = false;
    }
    ftsAvailability.set(db, { available });
    return available;
  };

  const getCachedStatement = (db, key, sql) => {
    let dbCache = statementCache.get(db);
    if (!dbCache) {
      dbCache = new Map();
      statementCache.set(db, dbCache);
    }
    let stmt = dbCache.get(key);
    if (!stmt) {
      stmt = db.prepare(sql);
      dbCache.set(key, stmt);
    }
    return stmt;
  };

  const buildPlaceholders = (count) => Array.from({ length: count }, () => '?').join(',');

  /**
   * Decode a packed uint32 buffer into an array.
   * @param {Buffer} buffer
   * @returns {number[]}
   */
  function unpackUint32(buffer) {
    if (!buffer) return [];
    const view = new Uint32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4));
    return Array.from(view);
  }

  /**
   * Map a chunk row into the in-memory metadata shape.
   * @param {object} row
   * @returns {object}
   */
  function mapChunkRow(row) {
    const start = Number.isFinite(row.start) ? row.start : null;
    const end = Number.isFinite(row.end) ? row.end : null;
    const startLine = Number.isFinite(row.startLine) ? row.startLine : null;
    const endLine = Number.isFinite(row.endLine) ? row.endLine : null;
    if (row.metaV2_json == null || row.metaV2_json === '') {
      throw new Error(`[sqlite] metaV2_json missing for chunk ${row.id ?? 'unknown'}`);
    }
    let metaV2 = null;
    if (typeof row.metaV2_json === 'string') {
      try {
        metaV2 = JSON.parse(row.metaV2_json);
      } catch {
        throw new Error(`[sqlite] metaV2_json invalid for chunk ${row.id ?? 'unknown'}`);
      }
    } else {
      metaV2 = row.metaV2_json;
    }
    if (metaV2?.chunkId && row.chunk_id && metaV2.chunkId !== row.chunk_id) {
      throw new Error(`[sqlite] metaV2.chunkId mismatch for chunk ${row.id ?? 'unknown'}`);
    }
    return {
      id: row.id,
      file: row.file,
      start,
      end,
      startLine,
      endLine,
      ext: row.ext,
      kind: row.kind,
      name: row.name,
      metaV2,
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
      churn_added: row.churn_added,
      churn_deleted: row.churn_deleted,
      churn_commits: row.churn_commits,
      chunk_authors: parseJson(row.chunk_authors, null),
      chunkAuthors: parseJson(row.chunk_authors, null)
    };
  }

  /**
   * Fill an array of chunk metadata with rows.
   * @param {Array<object>} rows
   * @param {Array<object>} target
   */
  function hydrateChunkMeta(rows, target) {
    for (const row of rows) {
      target[row.id] = mapChunkRow(row);
    }
  }

  /**
   * Load index artifacts from SQLite into in-memory structures.
   * @param {'code'|'prose'} mode
   * @returns {object}
   */
  function loadIndexFromSqlite(mode, options = {}) {
    const db = getDb(mode);
    if (!db) throw new Error('SQLite backend requested but database is not available.');
    const includeMinhash = options.includeMinhash !== false;
    const includeDense = options.includeDense !== false;
    const includeChunks = options.includeChunks !== false;
    const includeFilterIndex = options.includeFilterIndex !== false;
    let maxLocalId = -1;
    let chunkMeta = [];
    if (includeChunks) {
      const chunkRows = db.prepare('SELECT * FROM chunks WHERE mode = ? ORDER BY id').all(mode);
      for (const row of chunkRows) {
        if (row.id > maxLocalId) maxLocalId = row.id;
      }
      chunkMeta = maxLocalId >= 0 ? Array.from({ length: maxLocalId + 1 }) : [];
      hydrateChunkMeta(chunkRows, chunkMeta);
    } else {
      const maxRow = db.prepare('SELECT MAX(id) as maxId FROM chunks WHERE mode = ?').get(mode);
      maxLocalId = Number.isFinite(maxRow?.maxId) ? maxRow.maxId : -1;
      chunkMeta = maxLocalId >= 0 ? Array.from({ length: maxLocalId + 1 }) : [];
    }

    let minhash = null;
    if (includeMinhash) {
      const signatures = Array.from({ length: chunkMeta.length });
      const sigStmt = db.prepare('SELECT doc_id, sig FROM minhash_signatures WHERE mode = ? ORDER BY doc_id');
      for (const row of sigStmt.iterate(mode)) {
        signatures[row.doc_id] = unpackUint32(row.sig);
      }
      minhash = signatures.length ? { signatures } : null;
    }

    let denseVec = null;
    if (includeDense) {
      const denseMeta = db.prepare(
        'SELECT dims, scale, model, min_val, max_val, levels FROM dense_meta WHERE mode = ?'
      ).get(mode) || {};
      const vectors = Array.from({ length: chunkMeta.length });
      const denseStmt = db.prepare('SELECT doc_id, vector FROM dense_vectors WHERE mode = ? ORDER BY doc_id');
      for (const row of denseStmt.iterate(mode)) {
        vectors[row.doc_id] = row.vector;
      }
      const fallbackVec = vectors.find((vec) => vec && vec.length);
      const denseMetaRecord = resolveDenseMetaRecord(denseMeta, {
        fallbackDims: fallbackVec ? fallbackVec.length : 0,
        fallbackModel: modelIdDefault
      });
      denseVec = vectors.length ? {
        model: denseMetaRecord.model,
        dims: denseMetaRecord.dims,
        scale: denseMetaRecord.scale,
        minVal: denseMetaRecord.minVal,
        maxVal: denseMetaRecord.maxVal,
        levels: denseMetaRecord.levels,
        vectors
      } : null;
    }

    return {
      chunkMeta,
      denseVec,
      minhash,
      filterIndex: includeFilterIndex ? buildFilterIndex(chunkMeta, { fileChargramN }) : null,
      loadChunkMetaByIds
    };
  }


  /**
   * Load chunk metadata rows for a list of ids.
   * @param {'code'|'prose'} mode
   * @param {number[]} ids
   * @param {Array<object>|null} target
   * @returns {Array<object>}
   */
  function loadChunkMetaByIds(mode, ids, target = null) {
    const db = getDb(mode);
    if (!db || !ids || !ids.length) return target || [];
    const unique = Array.from(new Set(ids.filter((id) => Number.isFinite(id))));
    if (!unique.length) return target || [];
    const out = target || [];
    for (const chunk of chunkArray(unique, SQLITE_IN_LIMIT)) {
      const placeholders = buildPlaceholders(chunk.length);
      const stmt = getCachedStatement(
        db,
        `chunks:${chunk.length}`,
        `SELECT * FROM chunks WHERE mode = ? AND id IN (${placeholders})`
      );
      const rows = stmt.all(mode, ...chunk);
      hydrateChunkMeta(rows, out);
    }
    return out;
  }

  /**
   * Fetch posting rows for a list of ids.
   * @param {'code'|'prose'} mode
   * @param {string} table
   * @param {string} idColumn
   * @param {number[]} ids
   * @param {boolean} [includeTf]
   * @returns {Array<{id:number,doc_id:number,tf?:number}>}
   */
  function fetchPostingRows(mode, table, idColumn, ids, includeTf = false) {
    const db = getDb(mode);
    if (!db || !ids.length) return [];
    const unique = Array.from(new Set(ids));
    const rows = [];
    for (const chunk of chunkArray(unique)) {
      const placeholders = buildPlaceholders(chunk.length);
      const selectCols = includeTf
        ? `${idColumn} AS id, doc_id, tf`
        : `${idColumn} AS id, doc_id`;
      const stmt = getCachedStatement(
        db,
        `postings:${table}:${idColumn}:${includeTf ? 'tf' : 'no-tf'}:${chunk.length}`,
        `SELECT ${selectCols} FROM ${table} WHERE mode = ? AND ${idColumn} IN (${placeholders}) ` +
          `ORDER BY ${idColumn}, doc_id`
      );
      rows.push(...stmt.all(mode, ...chunk));
    }
    return rows;
  }

  /**
   * Load document length array from SQLite (cached).
   * @param {'code'|'prose'} mode
   * @param {number} totalDocs
   * @returns {number[]}
   */
  function loadDocLengths(mode, totalDocs) {
    const db = getDb(mode);
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

  /**
   * Load token stats (avgDocLen, totalDocs) from SQLite (cached).
   * @param {'code'|'prose'} mode
   * @returns {{avgDocLen:number,totalDocs:number}}
   */
  function loadTokenStats(mode) {
    const db = getDb(mode);
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

  /**
   * Build a minimal token index subset for a query from SQLite.
   * @param {string[]} tokens
   * @param {'code'|'prose'} mode
   * @returns {object|null}
   */
  function getTokenIndexForQuery(tokens, mode) {
    const db = getDb(mode);
    if (!db) return null;
    const uniqueTokens = Array.from(new Set(tokens)).filter(Boolean);
    if (!uniqueTokens.length) return null;

    const vocabRows = fetchSqliteVocabRows(db, mode, 'token_vocab', 'token_id', 'token', uniqueTokens);
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

  /**
   * Build a candidate set from SQLite phrase/chargram postings.
   * @param {'code'|'prose'} mode
   * @param {string[]} tokens
   * @returns {Set<number>|null}
   */
  function buildCandidateSetSqlite(mode, tokens) {
    const db = getDb(mode);
    if (!db) return null;
    const candidates = new Set();
    let matched = false;
    const hashedChargrams = (() => {
      if (sqliteCache.chargramHashMode?.has(mode)) return sqliteCache.chargramHashMode.get(mode);
      const row = db.prepare('SELECT gram FROM chargram_vocab WHERE mode = ? LIMIT 1').get(mode);
      const value = row?.gram;
      const hashed = typeof value === 'string' && value.startsWith('h64:');
      if (!sqliteCache.chargramHashMode) sqliteCache.chargramHashMode = new Map();
      sqliteCache.chargramHashMode.set(mode, hashed);
      return hashed;
    })();
    const addCandidate = (id) => {
      candidates.add(id);
      return candidateCap && candidates.size >= candidateCap;
    };

    if (postingsConfig.enablePhraseNgrams !== false) {
      const ngrams = extractNgrams(tokens, postingsConfig.phraseMinN, postingsConfig.phraseMaxN);
      if (ngrams.length) {
        const phraseRows = fetchSqliteVocabRows(db, mode, 'phrase_vocab', 'phrase_id', 'ngram', ngrams);
        const phraseIds = phraseRows.map((row) => row.id);
        const postingRows = fetchPostingRows(mode, 'phrase_postings', 'phrase_id', phraseIds, false);
        for (const row of postingRows) {
          if (addCandidate(row.doc_id)) return null;
          matched = true;
        }
      }
    }

    if (postingsConfig.enableChargrams !== false) {
      const gramSet = new Set();
      for (const token of tokens) {
        if (chargramMaxTokenLength && token.length > chargramMaxTokenLength) continue;
        if (hashedChargrams) {
          forEachRollingChargramHash(
            token,
            postingsConfig.chargramMinN,
            postingsConfig.chargramMaxN,
            { maxTokenLength: chargramMaxTokenLength },
            (gram) => {
              gramSet.add(gram);
              return true;
            }
          );
        } else {
          for (let n = postingsConfig.chargramMinN; n <= postingsConfig.chargramMaxN; n++) {
            for (const gram of tri(token, n)) {
              gramSet.add(gram);
            }
          }
        }
      }
      const grams = Array.from(gramSet);
      if (grams.length) {
        const gramRows = fetchSqliteVocabRows(db, mode, 'chargram_vocab', 'gram_id', 'gram', grams);
        const gramIds = gramRows.map((row) => row.id);
        const postingRows = fetchPostingRows(mode, 'chargram_postings', 'gram_id', gramIds, false);
        for (const row of postingRows) {
          if (addCandidate(row.doc_id)) return null;
          matched = true;
        }
      }
    }

    return matched ? candidates : null;
  }

  /**
   * Rank results using SQLite FTS5 bm25.
   * @param {object} idx
   * @param {string[]} queryTokens
   * @param {'code'|'prose'} mode
   * @param {number} topN
   * @param {boolean} [normalizeScores]
   * @param {Set<number>|null} [allowedIds]
   * @returns {Array<{idx:number,score:number}>}
   */
  function rankSqliteFts(idx, queryTokens, mode, topN, normalizeScores = false, allowedIds = null) {
    const db = getDb(mode);
    if (!db || !queryTokens.length) return [];
    if (allowedIds && allowedIds.size === 0) return [];
    const ftsTokens = queryTokens.filter((token) => FTS_TOKEN_SAFE.test(token));
    if (!ftsTokens.length) return [];
    const ftsQuery = ftsTokens.join(' ');
    const bm25Expr = buildFtsBm25Expr(sqliteFtsWeights);
    const allowedList = allowedIds && allowedIds.size ? Array.from(allowedIds) : null;
    const canPushdown = !!(allowedList && allowedList.length <= SQLITE_IN_LIMIT);
    const allowedClause = canPushdown
      ? ` AND chunks_fts.rowid IN (${allowedList.map(() => '?').join(',')})`
      : '';
    const params = canPushdown
      ? [ftsQuery, mode, ...allowedList, topN]
      : [ftsQuery, mode, topN];
    const rows = db.prepare(
      `SELECT chunks_fts.rowid AS id, ${bm25Expr} AS score, chunks.weight AS weight
       FROM chunks_fts
       JOIN chunks ON chunks.id = chunks_fts.rowid
       WHERE chunks_fts MATCH ? AND chunks.mode = ?
       ${allowedClause}
       ORDER BY score ASC, chunks_fts.rowid ASC LIMIT ?`
    ).all(...params);
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
      if (row.id == null || row.id < 0) continue;
      const weight = typeof row.weight === 'number'
        ? row.weight
        : (idx.chunkMeta?.[row.id]?.weight || 1);
      const raw = rawScores[i];
      const normalized = normalizeScores
        ? (max > min ? (raw - min) / (max - min) : 1)
        : raw;
      hits.push({ idx: row.id, score: normalized * weight });
    }
    let filteredHits = hits;
    if (allowedIds && allowedIds.size && !canPushdown) {
      filteredHits = filteredHits.filter((hit) => allowedIds.has(hit.idx));
    }
    return filteredHits
      .sort((a, b) => (b.score - a.score) || (a.idx - b.idx))
      .slice(0, topN);
  }

  /**
   * Rank results using SQLite vector ANN extension.
   * @param {'code'|'prose'} mode
   * @param {ArrayLike<number>} queryEmbedding
   * @param {number} topN
   * @param {Set<number>|null} candidateSet
   * @returns {Array<{idx:number,sim:number}>}
   */
  function rankVectorAnnSqlite(mode, queryEmbedding, topN, candidateSet) {
    const db = getDb(mode);
    if (!db || !queryEmbedding || !vectorAnnState[mode]?.available) return [];
    const config = resolveVectorAnnConfig(mode);
    return queryVectorAnn(db, config, queryEmbedding, topN, candidateSet);
  }

  return {
    loadIndexFromSqlite,
    hasFtsTable,
    getTokenIndexForQuery,
    buildCandidateSetSqlite,
    rankSqliteFts,
    rankVectorAnnSqlite
  };
}
