import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { getIndexDir } from '../../tools/dict-utils.js';
import { buildFilterIndex } from './filter-index.js';

const MAX_JSON_BYTES = 512 * 1024 * 1024 - 1024;

/**
 * Load file-backed index artifacts from a directory.
 * @param {string} dir
 * @param {{modelIdDefault:string}} options
 * @returns {object}
 */
export function loadIndex(dir, options) {
  const { modelIdDefault, fileChargramN } = options || {};
  const readJson = (name) => {
    const filePath = path.join(dir, name);
    const readBuffer = (targetPath) => {
      const stat = fsSync.statSync(targetPath);
      if (stat.size > MAX_JSON_BYTES) {
        const err = new Error(
          `Index artifact ${name} is too large for memory backend (${stat.size} bytes).`
        );
        err.code = 'ERR_JSON_TOO_LARGE';
        throw err;
      }
      return fsSync.readFileSync(targetPath);
    };
    const parseBuffer = (buffer) => {
      if (buffer.length > MAX_JSON_BYTES) {
        const err = new Error(
          `Index artifact ${name} is too large for memory backend (${buffer.length} bytes).`
        );
        err.code = 'ERR_JSON_TOO_LARGE';
        throw err;
      }
      return JSON.parse(buffer.toString('utf8'));
    };
    if (fsSync.existsSync(filePath)) {
      return parseBuffer(readBuffer(filePath));
    }
    if (name.endsWith('.json')) {
      const gzPath = `${filePath}.gz`;
      if (fsSync.existsSync(gzPath)) {
        const buf = readBuffer(gzPath);
        return parseBuffer(gunzipSync(buf));
      }
    }
    throw new Error(`Missing index artifact: ${name}`);
  };
  const loadOptional = (name) => {
    try {
      return readJson(name);
    } catch (err) {
      if (err?.code === 'ERR_JSON_TOO_LARGE') {
        console.warn(
          `[search] Skipping ${name}: ${err.message} Use sqlite backend for large repos.`
        );
      }
      return null;
    }
  };
  const chunkMeta = readJson('chunk_meta.json');
  const fileMetaRaw = loadOptional('file_meta.json');
  let fileMetaById = null;
  if (Array.isArray(fileMetaRaw)) {
    fileMetaById = new Map();
    for (const entry of fileMetaRaw) {
      if (!entry || entry.id == null) continue;
      fileMetaById.set(entry.id, entry);
    }
  }
  if (!fileMetaById) {
    const missingMeta = chunkMeta.some((chunk) => chunk && chunk.fileId != null && !chunk.file);
    if (missingMeta) {
      throw new Error('file_meta.json is required for fileId-based chunk metadata.');
    }
  } else {
    for (const chunk of chunkMeta) {
      if (!chunk || (chunk.file && chunk.ext)) continue;
      const meta = fileMetaById.get(chunk.fileId);
      if (!meta) continue;
      if (!chunk.file) chunk.file = meta.file;
      if (!chunk.ext) chunk.ext = meta.ext;
      if (!chunk.externalDocs) chunk.externalDocs = meta.externalDocs;
      if (!chunk.last_modified) chunk.last_modified = meta.last_modified;
      if (!chunk.last_author) chunk.last_author = meta.last_author;
      if (!chunk.churn) chunk.churn = meta.churn;
      if (!chunk.churn_added) chunk.churn_added = meta.churn_added;
      if (!chunk.churn_deleted) chunk.churn_deleted = meta.churn_deleted;
      if (!chunk.churn_commits) chunk.churn_commits = meta.churn_commits;
    }
  }
  const fileRelationsRaw = loadOptional('file_relations.json');
  let fileRelations = null;
  if (Array.isArray(fileRelationsRaw)) {
    const map = new Map();
    for (const entry of fileRelationsRaw) {
      if (!entry || !entry.file) continue;
      map.set(entry.file, entry.relations || null);
    }
    fileRelations = map;
  }
  const denseVec = loadOptional('dense_vectors_uint8.json');
  const denseVecDoc = loadOptional('dense_vectors_doc_uint8.json');
  const denseVecCode = loadOptional('dense_vectors_code_uint8.json');
  if (denseVec && !denseVec.model && modelIdDefault) denseVec.model = modelIdDefault;
  if (denseVecDoc && !denseVecDoc.model && modelIdDefault) denseVecDoc.model = modelIdDefault;
  if (denseVecCode && !denseVecCode.model && modelIdDefault) denseVecCode.model = modelIdDefault;
  const idx = {
    chunkMeta,
    fileRelations,
    denseVec,
    denseVecDoc,
    denseVecCode,
    minhash: loadOptional('minhash_signatures.json'),
    phraseNgrams: loadOptional('phrase_ngrams.json'),
    chargrams: loadOptional('chargram_postings.json')
  };
  if (idx.phraseNgrams?.vocab && !idx.phraseNgrams.vocabIndex) {
    idx.phraseNgrams.vocabIndex = new Map(idx.phraseNgrams.vocab.map((term, i) => [term, i]));
  }
  if (idx.chargrams?.vocab && !idx.chargrams.vocabIndex) {
    idx.chargrams.vocabIndex = new Map(idx.chargrams.vocab.map((term, i) => [term, i]));
  }
  idx.filterIndex = buildFilterIndex(chunkMeta, { fileChargramN });
  try {
    idx.tokenIndex = readJson('token_postings.json');
  } catch {}
  return idx;
}

/**
 * Resolve the index directory (cache-first, local fallback).
 * @param {string} root
 * @param {'code'|'prose'|'records'} mode
 * @param {object} userConfig
 * @returns {string}
 */
export function resolveIndexDir(root, mode, userConfig) {
  const cached = getIndexDir(root, mode, userConfig);
  const cachedMeta = path.join(cached, 'chunk_meta.json');
  if (fsSync.existsSync(cachedMeta)) return cached;
  const local = path.join(root, `index-${mode}`);
  const localMeta = path.join(local, 'chunk_meta.json');
  if (fsSync.existsSync(localMeta)) return local;
  return cached;
}

/**
 * Ensure a file-backed index exists for a mode.
 * @param {string} root
 * @param {'code'|'prose'|'records'} mode
 * @param {object} userConfig
 * @returns {string}
 */
export function requireIndexDir(root, mode, userConfig) {
  const dir = resolveIndexDir(root, mode, userConfig);
  const metaPath = path.join(dir, 'chunk_meta.json');
  if (!fsSync.existsSync(metaPath)) {
    const suffix = mode === 'records' ? ' --mode records' : '';
    console.error(`[search] ${mode} index not found at ${dir}. Run "pairofcleats build-index${suffix}" or "npm run build-index${suffix}".`);
    process.exit(1);
  }
  return dir;
}

/**
 * Build a deterministic cache key for the current query + settings.
 * @param {object} payload
 * @returns {{key:string,payload:object}}
 */
export function buildQueryCacheKey(payload) {
  const raw = JSON.stringify(payload);
  const key = crypto.createHash('sha1').update(raw).digest('hex');
  return { key, payload };
}

/**
 * Build a signature payload for cache invalidation.
 * @param {object} options
 * @returns {object}
 */
export function getIndexSignature(options) {
  const {
    useSqlite,
    backendLabel,
    sqliteCodePath,
    sqliteProsePath,
    runRecords,
    root,
    userConfig
  } = options;
  const fileSignature = (filePath) => {
    try {
      let statPath = filePath;
      if (!fsSync.existsSync(statPath) && filePath.endsWith('.json')) {
        const gzPath = `${filePath}.gz`;
        if (fsSync.existsSync(gzPath)) statPath = gzPath;
      }
      const stat = fsSync.statSync(statPath);
      return `${stat.size}:${stat.mtimeMs}`;
    } catch {
      return null;
    }
  };

  if (useSqlite) {
    const codeDir = resolveIndexDir(root, 'code', userConfig);
    const proseDir = resolveIndexDir(root, 'prose', userConfig);
    const codeRelations = path.join(codeDir, 'file_relations.json');
    const proseRelations = path.join(proseDir, 'file_relations.json');
    const recordDir = runRecords ? resolveIndexDir(root, 'records', userConfig) : null;
    const recordMeta = recordDir ? path.join(recordDir, 'chunk_meta.json') : null;
    const recordDense = recordDir ? path.join(recordDir, 'dense_vectors_uint8.json') : null;
    return {
      backend: backendLabel,
      code: fileSignature(sqliteCodePath),
      prose: fileSignature(sqliteProsePath),
      codeRelations: fileSignature(codeRelations),
      proseRelations: fileSignature(proseRelations),
      records: recordMeta ? fileSignature(recordMeta) : null,
      recordsDense: recordDense ? fileSignature(recordDense) : null
    };
  }

  const codeDir = resolveIndexDir(root, 'code', userConfig);
  const proseDir = resolveIndexDir(root, 'prose', userConfig);
  const codeMeta = path.join(codeDir, 'chunk_meta.json');
  const proseMeta = path.join(proseDir, 'chunk_meta.json');
  const codeDense = path.join(codeDir, 'dense_vectors_uint8.json');
  const proseDense = path.join(proseDir, 'dense_vectors_uint8.json');
  const codeRelations = path.join(codeDir, 'file_relations.json');
  const proseRelations = path.join(proseDir, 'file_relations.json');
  const recordDir = runRecords ? resolveIndexDir(root, 'records', userConfig) : null;
  const recordMeta = recordDir ? path.join(recordDir, 'chunk_meta.json') : null;
  const recordDense = recordDir ? path.join(recordDir, 'dense_vectors_uint8.json') : null;
  return {
    backend: backendLabel,
    code: fileSignature(codeMeta),
    prose: fileSignature(proseMeta),
    codeDense: fileSignature(codeDense),
    proseDense: fileSignature(proseDense),
    codeRelations: fileSignature(codeRelations),
    proseRelations: fileSignature(proseRelations),
    records: recordMeta ? fileSignature(recordMeta) : null,
    recordsDense: recordDense ? fileSignature(recordDense) : null
  };
}
