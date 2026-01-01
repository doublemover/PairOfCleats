import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getIndexDir } from '../../tools/dict-utils.js';
import { buildFilterIndex } from './filter-index.js';

/**
 * Load file-backed index artifacts from a directory.
 * @param {string} dir
 * @param {{modelIdDefault:string}} options
 * @returns {object}
 */
export function loadIndex(dir, options) {
  const { modelIdDefault } = options || {};
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
  const denseVecDoc = loadOptional('dense_vectors_doc_uint8.json');
  const denseVecCode = loadOptional('dense_vectors_code_uint8.json');
  if (denseVec && !denseVec.model && modelIdDefault) denseVec.model = modelIdDefault;
  if (denseVecDoc && !denseVecDoc.model && modelIdDefault) denseVecDoc.model = modelIdDefault;
  if (denseVecCode && !denseVecCode.model && modelIdDefault) denseVecCode.model = modelIdDefault;
  const idx = {
    chunkMeta,
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
  idx.filterIndex = buildFilterIndex(chunkMeta);
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
      const stat = fsSync.statSync(filePath);
      return `${stat.size}:${stat.mtimeMs}`;
    } catch {
      return null;
    }
  };

  if (useSqlite) {
    const recordDir = runRecords ? resolveIndexDir(root, 'records', userConfig) : null;
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

  const codeDir = resolveIndexDir(root, 'code', userConfig);
  const proseDir = resolveIndexDir(root, 'prose', userConfig);
  const codeMeta = path.join(codeDir, 'chunk_meta.json');
  const proseMeta = path.join(proseDir, 'chunk_meta.json');
  const codeDense = path.join(codeDir, 'dense_vectors_uint8.json');
  const proseDense = path.join(proseDir, 'dense_vectors_uint8.json');
  const recordDir = runRecords ? resolveIndexDir(root, 'records', userConfig) : null;
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
