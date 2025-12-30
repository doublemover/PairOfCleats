import { extractNgrams, tri } from '../shared/tokenize.js';
import { parseArrayField, parseJson } from './query-cache.js';
import { buildFtsBm25Expr } from './fts.js';

const SQLITE_IN_LIMIT = 900;

/**
 * Create SQLite helper functions for search.
 * @param {object} options
 * @param {(mode:'code'|'prose')=>import('better-sqlite3').Database|null} options.getDb
 * @param {object} options.postingsConfig
 * @param {number[]} options.sqliteFtsWeights
 * @param {object} options.vectorExtension
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
    vectorExtension,
    vectorAnnState,
    queryVectorAnn,
    modelIdDefault
  } = options;

  const sqliteCache = {
    tokenStats: new Map(),
    docLengths: new Map()
  };

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
   * Load index artifacts from SQLite into in-memory structures.
   * @param {'code'|'prose'} mode
   * @returns {object}
   */
  function loadIndexFromSqlite(mode) {
    const db = getDb(mode);
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

  /**
   * Split a list into smaller chunks for SQLite IN limits.
   * @param {Array<any>} items
   * @param {number} [size]
   * @returns {Array<Array<any>>}
   */
  function chunkArray(items, size = SQLITE_IN_LIMIT) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Fetch vocabulary rows for a list of values.
   * @param {'code'|'prose'} mode
   * @param {string} table
   * @param {string} idColumn
   * @param {string} valueColumn
   * @param {string[]} values
   * @returns {Array<{id:number,value:string}>}
   */
  function fetchVocabRows(mode, table, idColumn, valueColumn, values) {
    const db = getDb(mode);
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

    if (postingsConfig.enablePhraseNgrams !== false) {
      const ngrams = extractNgrams(tokens, postingsConfig.phraseMinN, postingsConfig.phraseMaxN);
      if (ngrams.length) {
        const phraseRows = fetchVocabRows(mode, 'phrase_vocab', 'phrase_id', 'ngram', ngrams);
        const phraseIds = phraseRows.map((row) => row.id);
        const postingRows = fetchPostingRows(mode, 'phrase_postings', 'phrase_id', phraseIds, false);
        for (const row of postingRows) {
          candidates.add(row.doc_id);
          matched = true;
        }
      }
    }

    if (postingsConfig.enableChargrams !== false) {
      const gramSet = new Set();
      for (const token of tokens) {
        for (let n = postingsConfig.chargramMinN; n <= postingsConfig.chargramMaxN; n++) {
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
   * @returns {Array<{idx:number,score:number}>}
   */
  function rankSqliteFts(idx, queryTokens, mode, topN, normalizeScores = false) {
    const db = getDb(mode);
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
    return queryVectorAnn(db, vectorExtension, queryEmbedding, topN, candidateSet);
  }

  return {
    loadIndexFromSqlite,
    getTokenIndexForQuery,
    buildCandidateSetSqlite,
    rankSqliteFts,
    rankVectorAnnSqlite
  };
}
