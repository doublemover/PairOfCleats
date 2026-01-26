import { resolveChunkId } from '../../index/chunk-id.js';
import { normalizeFilePath } from './utils.js';

const SAFE_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const isSafeIdentifier = (value) => SAFE_IDENTIFIER_RE.test(String(value || ''));

/**
 * Normalize a chunk into the row shape stored in SQLite.
 * @param {object} chunk
 * @param {'code'|'prose'} mode
 * @param {number} id
 * @returns {object}
 */
export function buildChunkRow(chunk, mode, id) {
  const tokensArray = Array.isArray(chunk.tokens) ? chunk.tokens : [];
  const normalizeString = (value) => (typeof value === 'string' ? value : null);
  const chunkId = resolveChunkId(chunk);
  const signature = normalizeString(chunk.docmeta?.signature ?? chunk.signature);
  const doc = normalizeString(chunk.docmeta?.doc);
  // signature/doc are for chunks_fts inserts; the chunks table does not store them.
  return {
    id,
    chunk_id: chunkId,
    mode,
    file: normalizeFilePath(chunk.file),
    start: chunk.start,
    end: chunk.end,
    startLine: chunk.startLine || null,
    endLine: chunk.endLine || null,
    ext: normalizeString(chunk.ext),
    kind: normalizeString(chunk.kind),
    name: normalizeString(chunk.name),
    metaV2_json: chunk.metaV2 ? JSON.stringify(chunk.metaV2) : null,
    signature,
    headline: normalizeString(chunk.headline),
    doc,
    preContext: chunk.preContext ? JSON.stringify(chunk.preContext) : null,
    postContext: chunk.postContext ? JSON.stringify(chunk.postContext) : null,
    weight: typeof chunk.weight === 'number' ? chunk.weight : 1,
    tokens: tokensArray.length ? JSON.stringify(tokensArray) : null,
    tokensText: tokensArray.join(' '),
    ngrams: chunk.ngrams ? JSON.stringify(chunk.ngrams) : null,
    codeRelations: chunk.codeRelations ? JSON.stringify(chunk.codeRelations) : null,
    docmeta: chunk.docmeta ? JSON.stringify(chunk.docmeta) : null,
    stats: chunk.stats ? JSON.stringify(chunk.stats) : null,
    complexity: chunk.complexity ? JSON.stringify(chunk.complexity) : null,
    lint: chunk.lint ? JSON.stringify(chunk.lint) : null,
    externalDocs: chunk.externalDocs ? JSON.stringify(chunk.externalDocs) : null,
    last_modified: normalizeString(chunk.last_modified),
    last_author: normalizeString(chunk.last_author),
    churn: typeof chunk.churn === 'number' ? chunk.churn : null,
    churn_added: typeof chunk.churn_added === 'number' ? chunk.churn_added : null,
    churn_deleted: typeof chunk.churn_deleted === 'number' ? chunk.churn_deleted : null,
    churn_commits: typeof chunk.churn_commits === 'number' ? chunk.churn_commits : null,
    chunk_authors: (() => {
      const authors = Array.isArray(chunk.chunk_authors)
        ? chunk.chunk_authors
        : (Array.isArray(chunk.chunkAuthors) ? chunk.chunkAuthors : null);
      return authors ? JSON.stringify(authors) : null;
    })()
  };
}

/**
 * Build token frequency map from a token list.
 * @param {string[]} tokensArray
 * @returns {Map<string,number>}
 */
export function buildTokenFrequency(tokensArray) {
  const freq = new Map();
  for (const token of tokensArray) {
    if (!token) continue;
    freq.set(token, (freq.get(token) || 0) + 1);
  }
  return freq;
}

/**
 * Prepare a vector ANN table for dense embeddings (when enabled).
 * @param {object} params
 * @param {import('better-sqlite3').Database} params.db
 * @param {object} params.indexData
 * @param {'code'|'prose'} params.mode
 * @param {object} params.vectorConfig
 * @returns {{tableName:string,column:string,insert:any}|null}
 */
export function prepareVectorAnnTable({ db, indexData, mode, vectorConfig }) {
  if (!vectorConfig?.enabled) return null;
  const vectorExtension = vectorConfig.extension || {};
  if (vectorExtension.table && !isSafeIdentifier(vectorExtension.table)) {
    console.warn('[sqlite] Vector extension table name is invalid; skipping ANN setup.');
    return null;
  }
  if (vectorExtension.column && !isSafeIdentifier(vectorExtension.column)) {
    console.warn('[sqlite] Vector extension column name is invalid; skipping ANN setup.');
    return null;
  }
  const dense = indexData?.denseVec;
  const dims = dense?.dims || dense?.vectors?.find((vec) => vec && vec.length)?.length || 0;
  if (!Number.isFinite(dims) || dims <= 0) return null;
  const loadResult = vectorConfig.loadVectorExtension(db, vectorExtension, `sqlite ${mode}`);
  if (!loadResult.ok) {
    console.warn(`[sqlite] Vector extension unavailable for ${mode}: ${loadResult.reason}`);
    return null;
  }
  if (vectorExtension.table) {
    try {
      db.exec(`DROP TABLE IF EXISTS ${vectorExtension.table}`);
    } catch {}
  }
  const created = vectorConfig.ensureVectorTable(db, vectorExtension, dims);
  if (!created.ok) {
    console.warn(`[sqlite] Failed to create vector table for ${mode}: ${created.reason}`);
    return null;
  }
  const insertSql = `INSERT OR REPLACE INTO ${created.tableName} (rowid, ${created.column}) VALUES (?, ?)`;
  return {
    tableName: created.tableName,
    column: created.column,
    insert: db.prepare(insertSql)
  };
}

/**
 * Prepare an ANN insert statement when the vector table already exists or can be created.
 * @param {object} params
 * @param {import('better-sqlite3').Database} params.db
 * @param {'code'|'prose'|'extracted-prose'|'records'} params.mode
 * @param {object} params.vectorConfig
 * @param {number|null} [params.dims]
 * @returns {{loaded:boolean,ready:boolean,tableName?:string,column?:string,insert?:any,reason?:string}}
 */
export function prepareVectorAnnInsert({ db, mode, vectorConfig, dims = null }) {
  if (!vectorConfig?.enabled) return { loaded: false, ready: false };
  const vectorExtension = vectorConfig.extension || {};
  const tableName = vectorExtension.table || 'dense_vectors_ann';
  const column = vectorExtension.column || 'embedding';
  if (!isSafeIdentifier(tableName) || !isSafeIdentifier(column)) {
    return {
      loaded: false,
      ready: false,
      reason: 'invalid vector table/column identifiers',
      tableName,
      column
    };
  }
  const loadResult = vectorConfig.loadVectorExtension(db, vectorExtension, `sqlite ${mode}`);
  if (!loadResult.ok) {
    return { loaded: false, ready: false, reason: loadResult.reason, tableName, column };
  }
  if (vectorConfig.hasVectorTable(db, tableName)) {
    const insertSql = `INSERT OR REPLACE INTO ${tableName} (rowid, ${column}) VALUES (?, ?)`;
    return { loaded: true, ready: true, tableName, column, insert: db.prepare(insertSql) };
  }
  if (!Number.isFinite(dims) || dims <= 0) {
    return { loaded: true, ready: false, tableName, column };
  }
  const created = vectorConfig.ensureVectorTable(db, vectorExtension, dims);
  if (!created.ok) {
    return { loaded: true, ready: false, reason: created.reason, tableName, column };
  }
  const insertSql = `INSERT OR REPLACE INTO ${created.tableName} (rowid, ${created.column}) VALUES (?, ?)`;
  return {
    loaded: true,
    ready: true,
    tableName: created.tableName,
    column: created.column,
    insert: db.prepare(insertSql)
  };
}
