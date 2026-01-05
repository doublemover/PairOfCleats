import { normalizeFilePath } from './utils.js';

/**
 * Normalize a chunk into the row shape stored in SQLite.
 * @param {object} chunk
 * @param {'code'|'prose'} mode
 * @param {number} id
 * @returns {object}
 */
export function buildChunkRow(chunk, mode, id) {
  const tokensArray = Array.isArray(chunk.tokens) ? chunk.tokens : [];
  const signature = typeof chunk.docmeta?.signature === 'string'
    ? chunk.docmeta.signature
    : (typeof chunk.signature === 'string' ? chunk.signature : null);
  const doc = typeof chunk.docmeta?.doc === 'string' ? chunk.docmeta.doc : null;
  return {
    id,
    mode,
    file: normalizeFilePath(chunk.file),
    start: chunk.start,
    end: chunk.end,
    startLine: chunk.startLine || null,
    endLine: chunk.endLine || null,
    ext: chunk.ext || null,
    kind: chunk.kind || null,
    name: chunk.name || null,
    signature,
    headline: chunk.headline || null,
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
    last_modified: chunk.last_modified || null,
    last_author: chunk.last_author || null,
    churn: typeof chunk.churn === 'number' ? chunk.churn : null,
    chunk_authors: chunk.chunk_authors ? JSON.stringify(chunk.chunk_authors) : null
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
  const dense = indexData?.denseVec;
  const dims = dense?.dims || dense?.vectors?.find((vec) => vec && vec.length)?.length || 0;
  if (!Number.isFinite(dims) || dims <= 0) return null;
  const loadResult = vectorConfig.loadVectorExtension(db, vectorConfig.extension, `sqlite ${mode}`);
  if (!loadResult.ok) {
    console.warn(`[sqlite] Vector extension unavailable for ${mode}: ${loadResult.reason}`);
    return null;
  }
  if (vectorConfig.extension.table) {
    try {
      db.exec(`DROP TABLE IF EXISTS ${vectorConfig.extension.table}`);
    } catch {}
  }
  const created = vectorConfig.ensureVectorTable(db, vectorConfig.extension, dims);
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
