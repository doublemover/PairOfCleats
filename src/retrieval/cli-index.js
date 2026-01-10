import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getIndexDir } from '../../tools/dict-utils.js';
import { buildFilterIndex, hydrateFilterIndex } from './filter-index.js';
import {
  MAX_JSON_BYTES,
  loadChunkMeta,
  loadTokenPostings,
  readJsonFile
} from '../shared/artifact-io.js';

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
    return readJsonFile(filePath, { maxBytes: MAX_JSON_BYTES });
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
  const chunkMeta = loadChunkMeta(dir, { maxBytes: MAX_JSON_BYTES });
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
  const repoMap = loadOptional('repo_map.json');
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
  const indexState = loadOptional('index_state.json');
  const fieldPostings = loadOptional('field_postings.json');
  const fieldTokens = loadOptional('field_tokens.json');
  if (denseVec && !denseVec.model && modelIdDefault) denseVec.model = modelIdDefault;
  if (denseVecDoc && !denseVecDoc.model && modelIdDefault) denseVecDoc.model = modelIdDefault;
  if (denseVecCode && !denseVecCode.model && modelIdDefault) denseVecCode.model = modelIdDefault;
  const filterIndexRaw = loadOptional('filter_index.json');
  const idx = {
    chunkMeta,
    fileRelations,
    repoMap,
    denseVec,
    denseVecDoc,
    denseVecCode,
    state: indexState,
    fieldPostings,
    fieldTokens,
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
  if (idx.fieldPostings?.fields) {
    for (const field of Object.keys(idx.fieldPostings.fields)) {
      const entry = idx.fieldPostings.fields[field];
      if (!entry?.vocab || entry.vocabIndex) continue;
      entry.vocabIndex = new Map(entry.vocab.map((term, i) => [term, i]));
    }
  }
  idx.filterIndex = filterIndexRaw
    ? (hydrateFilterIndex(filterIndexRaw) || buildFilterIndex(chunkMeta, { fileChargramN }))
    : buildFilterIndex(chunkMeta, { fileChargramN });
  try {
    idx.tokenIndex = loadTokenPostings(dir, { maxBytes: MAX_JSON_BYTES });
  } catch {}
  return idx;
}

/**
 * Resolve the index directory (cache-first, local fallback).
 * @param {string} root
 * @param {'code'|'prose'|'records'|'extracted-prose'} mode
 * @param {object} userConfig
 * @returns {string}
 */
export function resolveIndexDir(root, mode, userConfig) {
  const cached = getIndexDir(root, mode, userConfig);
  const cachedMeta = path.join(cached, 'chunk_meta.json');
  const cachedMetaJsonl = path.join(cached, 'chunk_meta.jsonl');
  const cachedMetaParts = path.join(cached, 'chunk_meta.meta.json');
  const cachedPartsDir = path.join(cached, 'chunk_meta.parts');
  if (fsSync.existsSync(cachedMeta)
    || fsSync.existsSync(cachedMetaJsonl)
    || fsSync.existsSync(cachedMetaParts)
    || fsSync.existsSync(cachedPartsDir)) {
    return cached;
  }
  const local = path.join(root, `index-${mode}`);
  const localMeta = path.join(local, 'chunk_meta.json');
  const localMetaJsonl = path.join(local, 'chunk_meta.jsonl');
  const localMetaParts = path.join(local, 'chunk_meta.meta.json');
  const localPartsDir = path.join(local, 'chunk_meta.parts');
  if (fsSync.existsSync(localMeta)
    || fsSync.existsSync(localMetaJsonl)
    || fsSync.existsSync(localMetaParts)
    || fsSync.existsSync(localPartsDir)) {
    return local;
  }
  return cached;
}

/**
 * Ensure a file-backed index exists for a mode.
 * @param {string} root
 * @param {'code'|'prose'|'records'|'extracted-prose'} mode
 * @param {object} userConfig
 * @returns {string}
 */
export function requireIndexDir(root, mode, userConfig, options = {}) {
  const dir = resolveIndexDir(root, mode, userConfig);
  const metaPath = path.join(dir, 'chunk_meta.json');
  const metaJsonlPath = path.join(dir, 'chunk_meta.jsonl');
  const metaPartsPath = path.join(dir, 'chunk_meta.meta.json');
  const metaPartsDir = path.join(dir, 'chunk_meta.parts');
  if (!fsSync.existsSync(metaPath)
    && !fsSync.existsSync(metaJsonlPath)
    && !fsSync.existsSync(metaPartsPath)
    && !fsSync.existsSync(metaPartsDir)) {
    const suffix = (mode === 'records' || mode === 'extracted-prose')
      ? ` --mode ${mode}`
      : '';
    const message = `[search] ${mode} index not found at ${dir}. Run "pairofcleats index build${suffix}" or "npm run build-index${suffix}".`;
    const emitOutput = options.emitOutput !== false;
    const exitOnError = options.exitOnError !== false;
    if (emitOutput) console.error(message);
    if (exitOnError) process.exit(1);
    throw new Error(message);
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
    runExtractedProse,
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

  const extractedProseDir = runExtractedProse
    ? resolveIndexDir(root, 'extracted-prose', userConfig)
    : null;
  const extractedProseMeta = extractedProseDir ? path.join(extractedProseDir, 'chunk_meta.json') : null;
  const extractedProseDense = extractedProseDir ? path.join(extractedProseDir, 'dense_vectors_uint8.json') : null;

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
      extractedProse: extractedProseMeta ? fileSignature(extractedProseMeta) : null,
      extractedProseDense: extractedProseDense ? fileSignature(extractedProseDense) : null,
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
    extractedProse: extractedProseMeta ? fileSignature(extractedProseMeta) : null,
    extractedProseDense: extractedProseDense ? fileSignature(extractedProseDense) : null,
    records: recordMeta ? fileSignature(recordMeta) : null,
    recordsDense: recordDense ? fileSignature(recordDense) : null
  };
}
