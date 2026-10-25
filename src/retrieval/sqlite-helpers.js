import { compileFtsMatchFromAst } from './fts-query.js';
import { admitSortedPostings } from '../shared/posting-order.js';
import { assertCasePreservedPhraseEvidence, createQueryAstHelpers, hasCaseSensitivePhrase, matchesLiteralPhraseTokens, requiresBooleanUniverse } from './pipeline/query-ast.js';
import { FTS_VARIANT_TABLES } from '../storage/sqlite/fts-variants.js';
import { extractNgrams, tri } from '../shared/tokenize.js';
import { assertChargramHashIdentity, forEachRollingChargramHash } from '../shared/chargram-hash.js';
import { chunkArray } from '../storage/sqlite/utils.js';
import { resolveDenseMetaRecord } from '../storage/sqlite/quantization.js';
import { fetchVocabRows as fetchSqliteVocabRows } from '../storage/sqlite/vocab.js';
import { parseArrayField, parseJson } from './query-cache.js';
import { buildFtsBm25Expr } from './fts.js';
import { buildFilterIndex } from './filter-index.js';
import { normalizeMetaV2ForRead } from '../index/metadata/meta-v2.js';
import { assertMinhashHashIdentity } from '../index/minhash.js';
import { readSqliteMinhashHeader } from '../storage/sqlite/minhash.js';
import { hydrateSelectiveSqliteBm25 } from './sqlite-bm25-source.js';
import { createFtsWork } from './fts-work.js';
import { observeRetrievalProviderFailure } from './pipeline/provider-failure.js';

const SQLITE_IN_LIMIT = 900;
const FTS_TOKEN_SAFE = /^[\p{L}\p{N}_]+$/u;
const FTS_OVERFETCH_MIN_ROWS = 5000;
const FTS_OVERFETCH_MULTIPLIER = 10;
const FTS_OVERFETCH_TIME_BUDGET_MS = 150;
export const RETRIEVAL_FTS_UNAVAILABLE_CODE = 'retrieval_fts_unavailable';
const phraseFunctionDatabases = new WeakSet();
const matchesFtsPhraseJson = (literal, phrase, caseSensitive) => Number(matchesLiteralPhraseTokens(parseArrayField(literal), parseArrayField(phrase), caseSensitive === 1));

// Apply the same AST eligibility before ranking admission. SQL term membership
// uses the actual selected tokenizer; the pure phrase callback shares the
// memory matcher's exact token semantics, including legacy array decoding.
const compileFtsEligibility = (queryAst, table) => {
  const params = [];
  let hasPhrase = false;
  const visit = node => {
    if (!node) return '1';
    if (node.type === 'term') {
      const match = compileFtsMatchFromAst(node);
      if (!match) return '0';
      params.push(match);
      return `chunks.id IN (SELECT rowid FROM ${table} WHERE ${table} MATCH ?)`;
    }
    if (node.type === 'phrase') {
      hasPhrase = true;
      params.push(JSON.stringify(node.tokens ?? []), node.caseSensitive === true ? 1 : 0);
      return 'poc_fts_phrase_match_v3(chunks.phrase_tokens, ?, ?)';
    }
    if (node.type === 'not') return `NOT (${visit(node.child)})`;
    if (node.type === 'and' || node.type === 'or') return `(${visit(node.left)}) ${node.type.toUpperCase()} (${visit(node.right)})`;
    return '1';
  };
  const predicate = visit(queryAst);
  return { sql: hasPhrase ? `chunks.phrase_tokens IS NOT NULL AND (${predicate})` : predicate, params, hasPhrase };
};

/**
 * Decode a packed uint32 buffer into an array.
 * Uses a DataView fallback for unaligned slices.
 * @param {Buffer} buffer
 * @returns {number[]}
 */
export function unpackUint32(buffer) {
  if (!buffer) return [];
  const byteLength = Math.floor(buffer.byteLength / 4) * 4;
  if (byteLength <= 0) return [];
  if ((buffer.byteOffset % 4) === 0) {
    const view = new Uint32Array(buffer.buffer, buffer.byteOffset, byteLength / 4);
    return Array.from(view);
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, byteLength);
  const out = new Array(byteLength / 4);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = view.getUint32(i * 4, true);
  }
  return out;
}

/**
 * Create SQLite helper functions for search.
 * @param {object} options
 * @param {(mode:'code'|'prose'|'extracted-prose')=>import('better-sqlite3').Database|null} options.getDb
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
  const ftsNow = options.ftsNow;
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
    tokenStats: new WeakMap(),
    docLengths: new WeakMap(),
    chargramHashMode: new WeakMap()
  };
  const statementCache = new WeakMap();
  const ftsAvailability = new WeakMap();
  const tableAvailability = new WeakMap();
  const cacheForDb = (owner, db) => {
    let cache = owner.get(db);
    if (!cache) { cache = new Map(); owner.set(db, cache); }
    return cache;
  };

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

  /**
   * Check whether a mode currently has an attached SQLite database handle.
   * Used by upstream routing to avoid running SQLite-only checks for modes that
   * are loaded from file artifacts.
   *
   * @param {'code'|'prose'|'extracted-prose'} mode
   * @returns {boolean}
   */
  const hasDb = (mode) => Boolean(getDb(mode));

  const hasTable = (mode, tableName) => {
    const db = getDb(mode);
    if (!db || typeof tableName !== 'string' || !tableName.trim()) return false;
    const resolvedName = tableName.trim();
    let cache = tableAvailability.get(db);
    if (!cache) {
      cache = new Map();
      tableAvailability.set(db, cache);
    }
    if (cache.has(resolvedName)) return cache.get(resolvedName) === true;
    let available = false;
    try {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(resolvedName);
      available = Boolean(row?.name);
    } catch {
      available = false;
    }
    cache.set(resolvedName, available);
    return available;
  };

  /**
   * Prepare and cache a statement per-db using a caller-provided key.
   * Keys must encode SQL shape (including dynamic placeholder arity).
   * Reusing a key across different bind counts can trigger sqlite bind errors.
   *
   * @param {import('better-sqlite3').Database} db
   * @param {string} key
   * @param {string} sql
   * @returns {import('better-sqlite3').Statement}
   */
  const getCachedStatement = (db, key, sql) => {
    let dbCache = statementCache.get(db);
    if (!dbCache) {
      dbCache = new Map();
      statementCache.set(db, dbCache);
    }
    let cached = dbCache.get(key);
    if (!cached || cached.sql !== sql) {
      cached = { sql, stmt: db.prepare(sql) };
      dbCache.set(key, cached);
    }
    return cached.stmt;
  };

  const buildPlaceholders = (count) => Array.from({ length: count }, () => '?').join(',');

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
    metaV2 = normalizeMetaV2ForRead(metaV2);
    if (metaV2?.chunkId && row.chunk_id && metaV2.chunkId !== row.chunk_id) {
      throw new Error(`[sqlite] metaV2.chunkId mismatch for chunk ${row.id ?? 'unknown'}`);
    }
    const chunkAuthors = parseJson(row.chunk_authors, null);
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
      phraseTokens: parseArrayField(row.phrase_tokens),
      phraseTokensComplete: row.phrase_tokens != null,
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
      chunk_authors: chunkAuthors,
      chunkAuthors: chunkAuthors
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
    let metadataLoadedRows = 0;
    let chunkMeta = [];
    if (includeChunks) {
      const chunkRows = db.prepare('SELECT * FROM chunks WHERE mode = ? ORDER BY id').all(mode);
      metadataLoadedRows = chunkRows.length;
      for (const row of chunkRows) {
        if (row.id > maxLocalId) maxLocalId = row.id;
      }
      chunkMeta = maxLocalId >= 0 ? new Array(maxLocalId + 1) : [];
      hydrateChunkMeta(chunkRows, chunkMeta);
    } else {
      const maxRow = db.prepare('SELECT MAX(id) as maxId FROM chunks WHERE mode = ?').get(mode);
      maxLocalId = Number.isFinite(maxRow?.maxId) ? maxRow.maxId : -1;
      chunkMeta = maxLocalId >= 0 ? new Array(maxLocalId + 1) : [];
    }

    let minhash = null;
    if (includeMinhash) {
      const signatures = Array.from({ length: chunkMeta.length });
      let signatureRows = 0;
      const sigStmt = db.prepare('SELECT doc_id, sig FROM minhash_signatures WHERE mode = ? ORDER BY doc_id');
      for (const row of sigStmt.iterate(mode)) {
        signatures[row.doc_id] = unpackUint32(row.sig);
        signatureRows += 1;
      }
      if (signatureRows) {
        const header = readSqliteMinhashHeader(db, mode);
        assertMinhashHashIdentity(header?.hashIdentity);
        minhash = { signatures, hashIdentity: header.hashIdentity, ...(header.sampling ? { sampling: header.sampling } : {}) };
      }
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
      metadataLoadedRows,
      denseVec,
      minhash,
      filterIndex: includeFilterIndex ? buildFilterIndex(chunkMeta, { fileChargramN }) : null,
      loadChunkMetaByIds,
      loadFilterFactPage: async options => {
        const { readSqliteFilterFactPage } = await import('./sqlite-filter-page.js');
        return readSqliteFilterFactPage({ ...options, db, mode, rowCount: chunkMeta.length });
      }
    };
  }


  /**
   * Load chunk metadata rows for a list of ids.
   * @param {'code'|'prose'} mode
   * @param {number[]} ids
   * @param {Array<object>|null} target
   * @returns {Array<object>}
   */
  function loadChunkMetaByIds(mode, ids, target = null, work = null) {
    const db = getDb(mode);
    if (!db || !ids || !ids.length) return target || [];
    const unique = Array.from(new Set(ids.filter((id) => Number.isFinite(id))));
    if (!unique.length) return target || [];
    const out = target || [];
    for (const chunk of chunkArray(unique, SQLITE_IN_LIMIT)) {
      const placeholders = buildPlaceholders(chunk.length);
      const hydrate = () => {
        const stmt = getCachedStatement(db, `chunks:${chunk.length}`,
          `SELECT * FROM chunks WHERE mode = ? AND id IN (${placeholders})`);
        hydrateChunkMeta(stmt.all(mode, ...chunk), out);
      };
      if (work) work.run('metadata', hydrate);
      else hydrate();
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
  function* fetchPostingRows(mode, table, idColumn, ids, includeTf = false) {
    const db = getDb(mode);
    if (!db || !ids.length) return [];
    const unique = Array.from(new Set(ids));
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
      yield* stmt.iterate(mode, ...chunk);
    }
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
    const cache = cacheForDb(sqliteCache.docLengths, db);
    if (cache.has(mode)) return cache.get(mode);

    const lengths = Array.from({ length: totalDocs || 0 }, () => 0);
    let maxDocId = -1;
    for (const row of db.prepare('SELECT doc_id, len FROM doc_lengths WHERE mode = ?').iterate(mode)) {
      if (row.doc_id >= lengths.length) {
        lengths.length = row.doc_id + 1;
      }
      lengths[row.doc_id] = row.len;
      if (row.doc_id > maxDocId) maxDocId = row.doc_id;
    }
    if (!totalDocs) totalDocs = maxDocId + 1;
    if (lengths.length < totalDocs) lengths.length = totalDocs;

    cache.set(mode, lengths);
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
    const cache = cacheForDb(sqliteCache.tokenStats, db);
    if (cache.has(mode)) return cache.get(mode);

    const row = db.prepare('SELECT avg_doc_len, total_docs FROM token_stats WHERE mode = ?').get(mode) || {};
    let totalDocs = typeof row.total_docs === 'number' ? row.total_docs : 0;
    let avgDocLen = typeof row.avg_doc_len === 'number' ? row.avg_doc_len : null;

    if (!totalDocs || avgDocLen === null) {
      const aggregate = db.prepare('SELECT COALESCE(MAX(doc_id), -1) + 1 AS ordinal_count, COALESCE(SUM(len), 0) AS total_len FROM doc_lengths WHERE mode = ?').get(mode);
      const lengthCount = Math.max(totalDocs || 0, aggregate.ordinal_count || 0);
      if (!totalDocs) totalDocs = lengthCount;
      if (avgDocLen === null) avgDocLen = lengthCount ? aggregate.total_len / lengthCount : 0;
    }

    const stats = { avgDocLen, totalDocs };
    cache.set(mode, stats);
    return stats;
  }

  /**
   * Build a minimal token index subset for a query from SQLite.
   * @param {string[]} tokens
   * @param {'code'|'prose'} mode
   * @returns {object|null}
   */
  function getTokenIndexForQuery(tokens, mode, { allowedIds = null, metrics = {}, throwIfAborted = null } = {}) {
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

    const stats = loadTokenStats(mode);
    const selective = hydrateSelectiveSqliteBm25({ db, mode, tokenIds, tokenIdToIndex, vocab, vocabIndex, stats,
      allowedIds, getCachedStatement, throwIfAborted, metrics });
    if (selective) return admitSortedPostings(selective);
    metrics.plan = 'broad-streamed-postings'; metrics.postingRowsReturned = 0;

    const postingRows = fetchPostingRows(mode, 'token_postings', 'token_id', tokenIds, true);
    const postings = Array.from({ length: vocab.length }, () => []);
    for (const row of postingRows) {
      if (metrics.postingRowsReturned % 256 === 0) throwIfAborted?.();
      const idx = tokenIdToIndex.get(row.id);
      if (idx === undefined) continue;
      postings[idx].push([row.doc_id, row.tf]);
      metrics.postingRowsReturned++;
    }

    const docLengths = loadDocLengths(mode, stats.totalDocs);

    return admitSortedPostings({ vocab, postings, docLengths,
      avgDocLen: stats.avgDocLen, totalDocs: stats.totalDocs, vocabIndex });
  }

  /**
   * Build a candidate set from SQLite phrase/chargram postings.
   * @param {'code'|'prose'} mode
   * @param {string[]} tokens
   * @returns {Set<number>|null}
   */
  function buildCandidateSetSqlite(mode, tokens, idx = null) {
    const db = getDb(mode);
    if (!db) return null;
    const candidates = new Set();
    let matched = false;
    const hashedChargrams = (() => {
      const cache = cacheForDb(sqliteCache.chargramHashMode, db);
      if (cache.has(mode)) return cache.get(mode);
      const row = db.prepare('SELECT gram FROM chargram_vocab WHERE mode = ? LIMIT 1').get(mode);
      const value = row?.gram;
      const hashed = typeof value === 'string' && value.startsWith('h64:');
      cache.set(mode, hashed);
      return hashed;
    })();
    if (hashedChargrams && postingsConfig.enableChargrams !== false) {
      assertChargramHashIdentity(idx?.state?.features?.chargramHash);
    }
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
   * @param {{
   *   ftsMatch?: string,
   *   overfetchRowCap?: number,
   *   overfetchTimeBudgetMs?: number,
   *   overfetchChunkSize?: number,
   *   onDiagnostic?: (diagnostic:{code:string,reason:string,mode:'code'|'prose',message:string|null})=>void,
   *   onOverfetch?: (stats:{
   *     rowCap:number,
   *     timeBudgetMs:number,
   *     rowsScanned:number,
   *     rowsMatched:number,
   *     canPushdown:boolean,
   *     filteredByAllowedIds:boolean,
   *     truncated:boolean,
   *     elapsedMs:number
   *   })=>void
   * }} [options]
   * @returns {Array<{idx:number,score:number}>}
   */
  function rankSqliteFts(
    idx,
    queryTokens,
    mode,
    topN,
    normalizeScores = false,
    allowedIds = null,
    options = {}
  ) {
    const topLimit = Math.max(1, Math.floor(Number(topN) || 1));
    const overfetchRowCap = options?.overfetchRowCap != null && Number.isFinite(Number(options.overfetchRowCap))
      ? Math.max(topLimit, Math.floor(Number(options.overfetchRowCap)))
      : Math.max(FTS_OVERFETCH_MIN_ROWS, FTS_OVERFETCH_MULTIPLIER * topLimit);
    const overfetchTimeBudgetMs = options?.overfetchTimeBudgetMs != null && Number.isFinite(Number(options.overfetchTimeBudgetMs))
      ? Math.max(1, Math.floor(Number(options.overfetchTimeBudgetMs)))
      : FTS_OVERFETCH_TIME_BUDGET_MS;
    const overfetchChunkSize = options?.overfetchChunkSize != null && Number.isFinite(Number(options.overfetchChunkSize))
      ? Math.max(1, Math.floor(Number(options.overfetchChunkSize)))
      : Math.min(512, overfetchRowCap);
    const emitDiagnostic = (reason, error = null) => {
      if (typeof options?.onDiagnostic !== 'function') return;
      options.onDiagnostic({
        code: RETRIEVAL_FTS_UNAVAILABLE_CODE,
        reason,
        mode,
        message: error ? String(error?.message || error) : null
      });
    };
    const emitOverfetch = (stats) => {
      if (typeof options?.onOverfetch !== 'function') return;
      options.onOverfetch(stats);
    };
    const db = getDb(mode);
    if (!db) {
      emitDiagnostic('db_unavailable');
      return [];
    }
    if (allowedIds && allowedIds.size === 0) return [];
    const variant = mode === 'code' && options?.ftsVariant === 'porter' ? 'unicode61' : options?.ftsVariant || 'unicode61';
    const table = FTS_VARIANT_TABLES[variant];
    if (!table || !hasTable(mode, table)) {
      emitDiagnostic('missing_table');
      return [];
    }
    if (typeof options?.onExecution === 'function') {
      const definition = db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(table)?.sql || '';
      const tokenizer = /tokenize\s*=\s*'([^']+)'/i.exec(definition)?.[1] || 'unicode61';
      options.onExecution({ table, tokenizer, variant });
    }
    const explicitMatch = typeof options?.ftsMatch === 'string'
      ? options.ftsMatch.trim()
      : '';
    const needsUniverse = requiresBooleanUniverse(options.queryAst);
    if (!explicitMatch && !queryTokens.length && !needsUniverse) return [];
    const ftsTokens = queryTokens.filter((token) => FTS_TOKEN_SAFE.test(token));
    const fallbackMatch = ftsTokens.length
      ? ftsTokens.map((token) => `"${token}"`).join(' AND ')
      : '';
    const ftsQuery = explicitMatch || fallbackMatch;
    if (!ftsQuery && !needsUniverse) return [];
    const bm25Expr = buildFtsBm25Expr(sqliteFtsWeights, table);
    const allowedList = allowedIds && allowedIds.size ? Array.from(allowedIds) : null;
    const canPushdown = Boolean(allowedList);
    const jsonPushdown = canPushdown && allowedList.length > SQLITE_IN_LIMIT;
    // Constrain the ordinary table's key. The FTS rowid equality plan can
    // misapply a bound singleton constraint when row zero is present.
    const allowedClause = canPushdown
      ? jsonPushdown ? ' AND chunks.id IN (SELECT value FROM json_each(?))'
        : ` AND chunks.id IN (${allowedList.map(() => '?').join(',')})`
      : '';
    if (hasCaseSensitivePhrase(options.queryAst)) assertCasePreservedPhraseEvidence(idx);
    const eligibility = options.queryAst ? compileFtsEligibility(options.queryAst, table) : null;
    if (eligibility?.hasPhrase && !phraseFunctionDatabases.has(db)) {
      db.function('poc_fts_phrase_match_v3', { deterministic: true }, matchesFtsPhraseJson);
      phraseFunctionDatabases.add(db);
    }
    const fetchSql = () => needsUniverse
      ? `WITH fts_scores AS MATERIALIZED (${ftsQuery
        ? `SELECT rowid AS id, ${bm25Expr} AS score FROM ${table} WHERE ${table} MATCH ?`
        : 'SELECT NULL AS id, 0.0 AS score WHERE 0'})
       SELECT chunks.id AS id, COALESCE(fts_scores.score, 0.0) AS score, chunks.weight AS weight
       FROM chunks LEFT JOIN fts_scores ON fts_scores.id = chunks.id
       WHERE chunks.mode = ? AND (${eligibility.sql}) ${allowedClause}
       ORDER BY score ASC, chunks.id ASC LIMIT ?`
      : `SELECT ${table}.rowid AS id, ${bm25Expr} AS score, chunks.weight AS weight
       FROM ${table}
       JOIN chunks ON chunks.id = ${table}.rowid
       WHERE ${table} MATCH ? AND chunks.mode = ?
       ${eligibility ? `AND (${eligibility.sql})` : ''}
       ${allowedClause}
       ORDER BY score ASC, ${table}.rowid ASC LIMIT ?`;
    const work = createFtsWork({ timeBudgetMs: overfetchTimeBudgetMs,
      chunkSize: Math.min(overfetchChunkSize, overfetchRowCap), now: ftsNow,
      throwIfAborted: options.throwIfAborted });
    const termRows = new Map();
    const collectTerms = node => {
      if (!node) return;
      if (node.type === 'term') termRows.set(compileFtsMatchFromAst(node), new Set());
      collectTerms(node.left); collectTerms(node.right); collectTerms(node.child);
    };
    if (options.queryAst) collectTerms(options.queryAst);
    const matcher = options.queryAst ? createQueryAstHelpers({ queryAst: options.queryAst,
      termMatches: (node, id) => termRows.get(compileFtsMatchFromAst(node))?.has(id) === true }).matchesQueryAst : null;
    const qualifyBatch = batch => {
      if (!matcher) return batch;
      const missing = batch.filter(row => !idx.chunkMeta[row.id]).map(row => row.id);
      if (missing.length) loadChunkMetaByIds(mode, missing, idx.chunkMeta, work);
      const candidateIds = JSON.stringify(batch.map(row => row.id));
      for (const [match, ids] of termRows) {
        const matches = work.run('terms', () => db.prepare(`SELECT rowid AS id FROM ${table}
          WHERE ${table} MATCH ? AND rowid IN (SELECT value FROM json_each(?))`).all(match, candidateIds));
        for (const row of matches) ids.add(row.id);
      }
      return batch.filter(row => {
        const chunk = idx.chunkMeta[row.id];
        return chunk && matcher(idx, row.id, chunk);
      });
    };
    let rows, termination;
    try {
      const stmtKey = canPushdown
        ? `rankSqliteFtsPushdown:${table}:${allowedList.length}`
        : 'rankSqliteFts:'+table;
      const queryLimit = canPushdown
        ? Math.min(overfetchRowCap, Math.max(topLimit, allowedList.length))
        : overfetchRowCap;
      const params = [...(ftsQuery ? [ftsQuery] : []), mode, ...(eligibility?.params || []),
        ...(canPushdown ? jsonPushdown ? [JSON.stringify(allowedList)] : allowedList : []), queryLimit];
      ({ rows, termination } = work.collect({
        openCursor: () => getCachedStatement(db, stmtKey, fetchSql()).iterate(...params), rowLimit: queryLimit, qualifyBatch }));
      if (termination === 'row-cap' && canPushdown && queryLimit === allowedList.length && queryLimit < overfetchRowCap) {
        termination = 'complete';
      }
    } catch (error) {
      const failure = observeRetrievalProviderFailure(error);
      options.throwIfAborted?.();
      if (failure.abort || !work.isQueryFailure(error)) throw error;
      try {
        emitOverfetch({ ...work.snapshot(), rowCap: overfetchRowCap, rowsMatched: 0,
          canPushdown, filteredByAllowedIds: Boolean(allowedIds), truncated: true, termination: 'query-failed' });
        emitDiagnostic('query_failed', { message: failure.message || 'SQLite FTS query failed.' });
      } catch (diagnostic) { throw failure.retain(diagnostic, { inspectionPresent: true }); }
      failure.requireSettled();
      return [];
    }
    if (matcher) options.onEligibility?.(matcher);
    const scoreStarted = work.snapshot().elapsedMs;
    let min = 0;
    let max = 0;
    if (normalizeScores && rows.length) {
      min = Number.POSITIVE_INFINITY;
      max = Number.NEGATIVE_INFINITY;
      for (const row of rows) {
        const raw = -row.score;
        if (raw < min) min = raw;
        if (raw > max) max = raw;
      }
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        min = 0;
        max = 0;
      }
    }
    const hits = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.id == null || row.id < 0) continue;
      const weight = typeof row.weight === 'number'
        ? row.weight
        : (idx.chunkMeta?.[row.id]?.weight || 1);
      const raw = -row.score;
      const normalized = normalizeScores
        ? (max > min ? (raw - min) / (max - min) : 1)
        : raw;
      hits.push({ idx: row.id, score: normalized * weight });
    }
    const ranked = hits
      .sort((a, b) => (b.score - a.score) || (a.idx - b.idx))
      .slice(0, topLimit);
    const stats = work.snapshot();
    stats.phases.scoring = Math.max(0, stats.elapsedMs - scoreStarted);
    emitOverfetch({ ...stats, rowCap: overfetchRowCap, rowsMatched: rows.length,
      canPushdown, filteredByAllowedIds: Boolean(allowedIds), truncated: termination !== 'complete', termination });
    return ranked;
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
    const baseConfig = resolveVectorAnnConfig(mode);
    const expectedDims = Number.isFinite(Number(vectorAnnState?.[mode]?.dims))
      ? Math.max(1, Math.floor(Number(vectorAnnState[mode].dims)))
      : null;
    const config = expectedDims && Number(baseConfig?.dims) !== expectedDims
      ? { ...baseConfig, dims: expectedDims }
      : baseConfig;
    return queryVectorAnn(db, config, queryEmbedding, topN, candidateSet);
  }

  return {
    loadIndexFromSqlite,
    hasDb,
    hasFtsTable,
    hasTable,
    getTokenIndexForQuery,
    buildCandidateSetSqlite,
    rankSqliteFts,
    rankVectorAnnSqlite
  };
}
