import { resolveChunkId } from '../../index/chunk-id.js';
import { normalizeFilePath } from './utils.js';

const SAFE_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const isSafeIdentifier = (value) => SAFE_IDENTIFIER_RE.test(String(value || ''));
const normalizeStrictString = (value) => (typeof value === 'string' ? value : null);

const resolveDenseVectorDims = (dense) => {
  if (!dense || typeof dense !== 'object') return 0;
  const rawDims = dense.dims ?? dense.fields?.dims ?? dense.meta?.dims ?? null;
  const dims = Number(rawDims);
  if (Number.isFinite(dims) && dims > 0) return Math.floor(dims);
  const vectors = dense.vectors ?? dense.arrays?.vectors;
  if (Array.isArray(vectors)) {
    const sample = vectors.find((vec) => vec && typeof vec.length === 'number');
    return sample?.length || 0;
  }
  return 0;
};

/**
 * Extract `signature` and `doc` from chunk docmeta.
 * @param {object|null} docmeta
 * @param {{fallbackSignature?:string|null}} [options]
 * @returns {{signature:string|null,doc:string|null}}
 */
export function extractChunkDocmetaFields(docmeta, { fallbackSignature = null } = {}) {
  const signature = typeof docmeta?.signature === 'string'
    ? docmeta.signature
    : (typeof fallbackSignature === 'string' ? fallbackSignature : null);
  const doc = typeof docmeta?.doc === 'string' ? docmeta.doc : null;
  return { signature, doc };
}

/**
 * Extract `signature` and `doc` from serialized chunk docmeta JSON.
 * @param {string|object|null} docmetaValue
 * @param {{fallbackSignature?:string|null}} [options]
 * @returns {{signature:string|null,doc:string|null}}
 */
export function extractChunkDocmetaFieldsFromJson(docmetaValue, { fallbackSignature = null } = {}) {
  if (!docmetaValue) {
    return extractChunkDocmetaFields(null, { fallbackSignature });
  }
  if (typeof docmetaValue === 'object') {
    return extractChunkDocmetaFields(docmetaValue, { fallbackSignature });
  }
  if (typeof docmetaValue !== 'string') {
    return extractChunkDocmetaFields(null, { fallbackSignature });
  }
  try {
    const parsed = JSON.parse(docmetaValue);
    return extractChunkDocmetaFields(parsed, { fallbackSignature });
  } catch {
    return extractChunkDocmetaFields(null, { fallbackSignature });
  }
}

/**
 * Serialize chunk authors using the dual `chunk_authors`/`chunkAuthors` source fields.
 * @param {object} chunk
 * @returns {string|null}
 */
export function serializeChunkAuthors(chunk) {
  const authors = Array.isArray(chunk?.chunk_authors)
    ? chunk.chunk_authors
    : (Array.isArray(chunk?.chunkAuthors) ? chunk.chunkAuthors : null);
  return authors ? JSON.stringify(authors) : null;
}

/**
 * Normalize a chunk into the row shape used by SQLite inserts.
 * @param {object} chunk
 * @param {object} options
 * @param {'code'|'prose'|'extracted-prose'|'records'} options.mode
 * @param {number|null} options.id
 * @param {(value:any)=>any} [options.normalizeText]
 * @param {string|null} [options.emptyTokensText]
 * @param {boolean} [options.includeFileId]
 * @param {number|null} [options.fileId]
 * @returns {object}
 */
export function normalizeChunkForSqlite(
  chunk,
  {
    mode,
    id,
    normalizeText = normalizeStrictString,
    emptyTokensText = '',
    includeFileId = false,
    fileId = null
  } = {}
) {
  const tokensArray = Array.isArray(chunk?.tokens) ? chunk.tokens : [];
  const chunkId = typeof chunk?.chunk_id === 'string' && chunk.chunk_id
    ? chunk.chunk_id
    : resolveChunkId(chunk);
  const { signature, doc } = extractChunkDocmetaFields(chunk?.docmeta, {
    fallbackSignature: chunk?.signature
  });
  const row = {
    id,
    chunk_id: chunkId,
    mode,
    file: normalizeFilePath(chunk?.file || null),
    start: chunk?.start,
    end: chunk?.end,
    startLine: chunk?.startLine || null,
    endLine: chunk?.endLine || null,
    ext: normalizeText(chunk?.ext),
    kind: normalizeText(chunk?.kind),
    name: normalizeText(chunk?.name),
    metaV2_json: chunk?.metaV2 ? JSON.stringify(chunk.metaV2) : null,
    signature,
    headline: normalizeText(chunk?.headline),
    doc,
    preContext: chunk?.preContext ? JSON.stringify(chunk.preContext) : null,
    postContext: chunk?.postContext ? JSON.stringify(chunk.postContext) : null,
    weight: typeof chunk?.weight === 'number' ? chunk.weight : 1,
    tokens: tokensArray.length ? JSON.stringify(tokensArray) : null,
    tokensText: tokensArray.length ? tokensArray.join(' ') : emptyTokensText,
    ngrams: chunk?.ngrams ? JSON.stringify(chunk.ngrams) : null,
    codeRelations: chunk?.codeRelations ? JSON.stringify(chunk.codeRelations) : null,
    docmeta: chunk?.docmeta ? JSON.stringify(chunk.docmeta) : null,
    stats: chunk?.stats ? JSON.stringify(chunk.stats) : null,
    complexity: chunk?.complexity ? JSON.stringify(chunk.complexity) : null,
    lint: chunk?.lint ? JSON.stringify(chunk.lint) : null,
    externalDocs: chunk?.externalDocs ? JSON.stringify(chunk.externalDocs) : null,
    last_modified: normalizeText(chunk?.last_modified),
    last_author: normalizeText(chunk?.last_author),
    churn: typeof chunk?.churn === 'number' ? chunk.churn : null,
    churn_added: typeof chunk?.churn_added === 'number' ? chunk.churn_added : null,
    churn_deleted: typeof chunk?.churn_deleted === 'number' ? chunk.churn_deleted : null,
    churn_commits: typeof chunk?.churn_commits === 'number' ? chunk.churn_commits : null,
    chunk_authors: serializeChunkAuthors(chunk)
  };
  if (includeFileId) {
    row.file_id = Number.isFinite(fileId)
      ? fileId
      : (Number.isFinite(chunk?.fileId) ? chunk.fileId : null);
  }
  return row;
}

/**
 * Backward-compatible alias for chunk-row normalization.
 * @param {object} chunk
 * @param {object} [options]
 * @returns {object}
 */
export function buildNormalizedChunkRow(chunk, options = {}) {
  return normalizeChunkForSqlite(chunk, options);
}

/**
 * Normalize a chunk into the row shape stored in SQLite.
 * @param {object} chunk
 * @param {'code'|'prose'|'extracted-prose'|'records'} mode
 * @param {number} id
 * @returns {object}
 */
export function buildChunkRow(chunk, mode, id) {
  return normalizeChunkForSqlite(chunk, { mode, id, normalizeText: normalizeStrictString, emptyTokensText: '' });
}

/**
 * Create a normalized file->count map from manifest-like entries.
 * @param {Array<{normalized?:string,file?:string}>} entries
 * @param {number} [initialValue]
 * @returns {Map<string,number>}
 */
export function createFileCountMap(entries, initialValue = 0) {
  const map = new Map();
  for (const record of entries || []) {
    const normalizedFile = normalizeFilePath(record?.normalized || record?.file || null);
    if (!normalizedFile) continue;
    map.set(normalizedFile, initialValue);
  }
  return map;
}

/**
 * Increment a file count map by normalized file key.
 * @param {Map<string,number>} counts
 * @param {string} file
 * @param {number} [delta]
 * @returns {string|null}
 */
export function bumpFileCount(counts, file, delta = 1) {
  if (!(counts instanceof Map)) return null;
  const normalizedFile = normalizeFilePath(file);
  if (!normalizedFile) return null;
  const increment = Number(delta);
  const next = (counts.get(normalizedFile) || 0) + (Number.isFinite(increment) ? increment : 0);
  counts.set(normalizedFile, next);
  return normalizedFile;
}

/**
 * Build a normalized file_manifest insert row.
 * @param {object} input
 * @param {'code'|'prose'|'extracted-prose'|'records'} input.mode
 * @param {string} input.file
 * @param {number} input.chunkCount
 * @param {object|null} [input.manifestEntry]
 * @param {string|null} [input.fallbackHash]
 * @param {number|null} [input.fallbackMtimeMs]
 * @param {number|null} [input.fallbackSize]
 * @returns {{mode:string,file:string,hash:string|null,mtimeMs:number|null,size:number|null,chunk_count:number}|null}
 */
export function buildFileManifestRow({
  mode,
  file,
  chunkCount,
  manifestEntry = null,
  fallbackHash = null,
  fallbackMtimeMs = null,
  fallbackSize = null
} = {}) {
  const normalizedFile = normalizeFilePath(file);
  if (!normalizedFile) return null;
  const resolvedChunkCount = Number(chunkCount);
  return {
    mode,
    file: normalizedFile,
    hash: manifestEntry?.hash || fallbackHash || null,
    mtimeMs: Number.isFinite(manifestEntry?.mtimeMs)
      ? manifestEntry.mtimeMs
      : (Number.isFinite(fallbackMtimeMs) ? fallbackMtimeMs : null),
    size: Number.isFinite(manifestEntry?.size)
      ? manifestEntry.size
      : (Number.isFinite(fallbackSize) ? fallbackSize : null),
    chunk_count: Number.isFinite(resolvedChunkCount) ? resolvedChunkCount : 0
  };
}

const normalizeManifestMapRecord = (record) => {
  if (!record || typeof record !== 'object') return record || null;
  if (Object.prototype.hasOwnProperty.call(record, 'entry')) return record.entry ?? null;
  return record;
};

const normalizeFileCountEntries = (fileCounts) => {
  if (fileCounts instanceof Map) return fileCounts.entries();
  if (Array.isArray(fileCounts)) return fileCounts;
  return Object.entries(fileCounts || {});
};

/**
 * Build normalized file_manifest rows from per-file counts and optional metadata maps.
 * @param {object} input
 * @param {'code'|'prose'|'extracted-prose'|'records'} input.mode
 * @param {Map<string,number>|Array<[string,number]>|object} input.fileCounts
 * @param {Map<string,any>|null} [input.manifestByNormalized]
 * @param {Map<string,any>|null} [input.fallbackByNormalized]
 * @returns {Array<{mode:string,file:string,hash:string|null,mtimeMs:number|null,size:number|null,chunk_count:number}>}
 */
export function buildFileManifestRows({
  mode,
  fileCounts,
  manifestByNormalized = null,
  fallbackByNormalized = null
} = {}) {
  const rows = [];
  const manifestMap = manifestByNormalized instanceof Map ? manifestByNormalized : null;
  const fallbackMap = fallbackByNormalized instanceof Map ? fallbackByNormalized : null;
  for (const [file, chunkCount] of normalizeFileCountEntries(fileCounts)) {
    const normalizedFile = normalizeFilePath(file);
    if (!normalizedFile) continue;
    const manifestEntry = manifestMap
      ? normalizeManifestMapRecord(manifestMap.get(normalizedFile))
      : null;
    const fallback = fallbackMap ? (fallbackMap.get(normalizedFile) || null) : null;
    const row = buildFileManifestRow({
      mode,
      file: normalizedFile,
      chunkCount,
      manifestEntry,
      fallbackHash: fallback?.hash ?? fallback?.file_hash ?? null,
      fallbackMtimeMs: fallback?.mtimeMs ?? fallback?.file_mtimeMs ?? null,
      fallbackSize: fallback?.size ?? fallback?.file_size ?? null
    });
    if (row) rows.push(row);
  }
  return rows;
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
  const dims = resolveDenseVectorDims(dense);
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
