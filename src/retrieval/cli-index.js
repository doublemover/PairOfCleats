import fsSync from 'node:fs';
import path from 'node:path';
import { buildLocalCacheKey } from '../shared/cache-key.js';
import { getIndexDir } from '../../tools/shared/dict-utils.js';
import { buildFilterIndex, hydrateFilterIndex } from './filter-index.js';
import { createError, ERROR_CODES } from '../shared/error-codes.js';
import { buildIndexSignature } from './index-cache.js';
import {
  MAX_JSON_BYTES,
  loadChunkMeta,
  loadJsonArrayArtifact,
  loadJsonArrayArtifactRows,
  loadTokenPostings,
  loadJsonObjectArtifact,
  loadMinhashSignatures,
  loadPiecesManifest,
  resolveArtifactPresence,
  resolveBinaryArtifactPath
} from '../shared/artifact-io.js';
import { loadHnswIndex, normalizeHnswConfig, resolveHnswPaths, resolveHnswTarget } from '../shared/hnsw.js';

const hasFile = (targetPath) => (
  fsSync.existsSync(targetPath)
  || fsSync.existsSync(`${targetPath}.gz`)
  || fsSync.existsSync(`${targetPath}.zst`)
);

export function hasChunkMetaArtifacts(dir) {
  if (!dir) return false;
  const legacyCandidates = [
    'chunk_meta.json',
    'chunk_meta.jsonl',
    'chunk_meta.meta.json',
    'chunk_meta.columnar.json',
    'chunk_meta.binary-columnar.meta.json'
  ];
  for (const relPath of legacyCandidates) {
    if (hasFile(path.join(dir, relPath))) return true;
  }
  if (fsSync.existsSync(path.join(dir, 'chunk_meta.parts'))) return true;
  try {
    const manifest = loadPiecesManifest(dir, { maxBytes: MAX_JSON_BYTES, strict: true });
    const presence = resolveArtifactPresence(dir, 'chunk_meta', {
      manifest,
      maxBytes: MAX_JSON_BYTES,
      strict: false
    });
    if (!presence || presence.format === 'missing') return false;
    if (presence.error) return false;
    if (presence.missingMeta) return false;
    if (Array.isArray(presence.missingPaths) && presence.missingPaths.length) return false;
    return Array.isArray(presence.paths) && presence.paths.length > 0;
  } catch {
    return false;
  }
}

/**
 * Load file-backed index artifacts from a directory.
 * @param {string} dir
 * @param {{modelIdDefault:string}} options
 * @returns {object}
 */
export async function loadIndex(dir, options) {
  const {
    modelIdDefault,
    mode = null,
    denseVectorMode = null,
    fileChargramN,
    includeHnsw = true,
    includeDense = true,
    includeMinhash = true,
    includeFilterIndex = true,
    includeFileRelations = true,
    includeRepoMap = true,
    includeTokenIndex = true,
    includeChunkMetaCold = true,
    hnswConfig: rawHnswConfig,
    strict = true
  } = options || {};
  const includeTokenIndexResolved = includeFilterIndex ? true : includeTokenIndex;
  const hnswConfig = normalizeHnswConfig(rawHnswConfig || {});
  const manifest = loadPiecesManifest(dir, { maxBytes: MAX_JSON_BYTES, strict });
  const loadOptionalObject = async (name) => {
    try {
      return await loadJsonObjectArtifact(dir, name, {
        maxBytes: MAX_JSON_BYTES,
        manifest,
        strict
      });
    } catch (err) {
      if (err?.code === 'ERR_JSON_TOO_LARGE') {
        console.warn(
          `[search] Skipping ${name}: ${err.message} Use sqlite backend for large repos.`
        );
      }
      return null;
    }
  };
  const loadOptionalArray = async (baseName) => {
    try {
      return await loadJsonArrayArtifact(dir, baseName, { maxBytes: MAX_JSON_BYTES, manifest, strict });
    } catch (err) {
      if (err?.code === 'ERR_JSON_TOO_LARGE') {
        console.warn(
          `[search] Skipping ${baseName}: ${err.message} Use sqlite backend for large repos.`
        );
      }
      return null;
    }
  };
  const loadOptionalRows = (baseName, options = {}) => (async function* () {
    try {
      for await (const row of loadJsonArrayArtifactRows(dir, baseName, {
        maxBytes: MAX_JSON_BYTES,
        manifest,
        strict,
        ...options
      })) {
        yield row;
      }
    } catch (err) {
      if (err?.message?.startsWith('Missing manifest entry for')) {
        return;
      }
      if (err?.code === 'ERR_JSON_TOO_LARGE') {
        console.warn(
          `[search] Skipping ${baseName}: ${err.message} Use sqlite backend for large repos.`
        );
        return;
      }
      throw err;
    }
  })();
  const loadOptionalDenseBinary = async (artifactName, baseName) => {
    const meta = await loadOptionalObject(`${artifactName}_binary_meta`);
    if (!meta || typeof meta !== 'object') return null;
    const relPath = typeof meta.path === 'string' && meta.path
      ? meta.path
      : `${baseName}.bin`;
    const absPath = path.join(dir, relPath);
    if (!fsSync.existsSync(absPath)) return null;
    try {
      const buffer = fsSync.readFileSync(absPath);
      const view = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const dims = Number.isFinite(Number(meta.dims))
        ? Math.max(0, Math.floor(Number(meta.dims)))
        : 0;
      const count = Number.isFinite(Number(meta.count))
        ? Math.max(0, Math.floor(Number(meta.count)))
        : (dims > 0 ? Math.floor(view.length / dims) : 0);
      if (!dims || !count || view.length < (dims * count)) return null;
      return {
        ...meta,
        model: meta.model || modelIdDefault || null,
        dims,
        count,
        path: relPath,
        buffer: view
      };
    } catch {
      return null;
    }
  };
  const chunkMeta = await loadChunkMeta(dir, {
    maxBytes: MAX_JSON_BYTES,
    manifest,
    strict,
    includeCold: includeChunkMetaCold !== false
  });
  let fileMetaById = null;
  fileMetaById = new Map();
  let fileMetaLoaded = false;
  for await (const entry of loadOptionalRows('file_meta', { materialize: true })) {
    fileMetaLoaded = true;
    if (!entry || entry.id == null) continue;
    fileMetaById.set(entry.id, entry);
  }
  if (!fileMetaLoaded) fileMetaById = null;
  if (!fileMetaById) {
    const missingMeta = chunkMeta.some((chunk) => chunk && chunk.fileId != null && !chunk.file);
    if (missingMeta) {
      throw new Error('file_meta.json is required for fileId-based chunk metadata.');
    }
  } else {
    for (const chunk of chunkMeta) {
      if (!chunk) continue;
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
  const fileRelationsRows = includeFileRelations
    ? loadOptionalRows('file_relations', { materialize: true })
    : null;
  const repoMapRows = includeRepoMap
    ? loadOptionalRows('repo_map', { materialize: true })
    : null;
  let fileRelations = null;
  if (fileRelationsRows) {
    const map = new Map();
    for await (const entry of fileRelationsRows) {
      if (!entry || !entry.file) continue;
      map.set(entry.file, entry.relations || null);
    }
    fileRelations = map;
  }
  let repoMap = null;
  if (repoMapRows) {
    const list = [];
    for await (const entry of repoMapRows) {
      list.push(entry);
    }
    repoMap = list;
  }
  const indexState = await loadOptionalObject('index_state');
  const embeddingsState = indexState?.embeddings || null;
  const embeddingsReady = embeddingsState?.ready !== false && embeddingsState?.pending !== true;
  const denseVec = embeddingsReady && includeDense
    ? (
      await loadOptionalDenseBinary('dense_vectors', 'dense_vectors_uint8')
      || await loadOptionalObject('dense_vectors')
    )
    : null;
  const denseVecDoc = embeddingsReady && includeDense
    ? (
      await loadOptionalDenseBinary('dense_vectors_doc', 'dense_vectors_doc_uint8')
      || await loadOptionalObject('dense_vectors_doc')
    )
    : null;
  const denseVecCode = embeddingsReady && includeDense
    ? (
      await loadOptionalDenseBinary('dense_vectors_code', 'dense_vectors_code_uint8')
      || await loadOptionalObject('dense_vectors_code')
    )
    : null;
  const sqliteVecMeta = embeddingsReady && includeDense
    ? await loadOptionalObject('dense_vectors_sqlite_vec_meta')
    : null;
  const hnswTarget = resolveHnswTarget(mode, denseVectorMode);
  const hnswArtifact = hnswTarget === 'doc'
    ? 'dense_vectors_doc_hnsw'
    : (hnswTarget === 'code' ? 'dense_vectors_code_hnsw' : 'dense_vectors_hnsw');
  const hnswMetaName = hnswTarget === 'doc'
    ? 'dense_vectors_doc_hnsw_meta'
    : (hnswTarget === 'code' ? 'dense_vectors_code_hnsw_meta' : 'dense_vectors_hnsw_meta');
  const hnswPaths = resolveHnswPaths(dir, hnswTarget);
  const hnswMeta = embeddingsReady && includeHnsw && hnswConfig.enabled
    ? await loadOptionalObject(hnswMetaName)
    : null;
  let hnswIndex = null;
  let hnswAvailable = false;
  if (hnswMeta && includeHnsw && hnswConfig.enabled) {
    const indexPath = resolveBinaryArtifactPath(dir, hnswArtifact, {
      manifest,
      strict,
      fallbackPath: hnswPaths.indexPath
    });
    const mergedConfig = {
      ...hnswConfig,
      space: hnswMeta.space || hnswConfig.space,
      efSearch: hnswMeta.efSearch || hnswConfig.efSearch
    };
    const expectedModel = denseVec?.model || denseVecDoc?.model || denseVecCode?.model || null;
    const expectedDims = denseVec?.dims || denseVecDoc?.dims || denseVecCode?.dims || hnswMeta.dims;
    hnswIndex = loadHnswIndex({
      indexPath,
      dims: expectedDims,
      config: mergedConfig,
      meta: hnswMeta,
      expectedModel
    });
    hnswAvailable = Boolean(hnswIndex);
  }
  const fieldPostings = await loadOptionalObject('field_postings');
  const fieldTokens = await loadOptionalArray('field_tokens');
  if (denseVec && !denseVec.model && modelIdDefault) denseVec.model = modelIdDefault;
  if (denseVecDoc && !denseVecDoc.model && modelIdDefault) denseVecDoc.model = modelIdDefault;
  if (denseVecCode && !denseVecCode.model && modelIdDefault) denseVecCode.model = modelIdDefault;
  const filterIndexRaw = includeFilterIndex
    ? await loadOptionalObject('filter_index')
    : null;
  const idx = {
    chunkMeta,
    fileRelations,
    repoMap,
    denseVec,
    denseVecDoc,
    denseVecCode,
    sqliteVecMeta,
    hnsw: hnswMeta ? {
      available: hnswAvailable,
      index: hnswIndex,
      meta: hnswMeta,
      space: hnswMeta.space || hnswConfig.space,
      target: hnswTarget
    } : { available: false, index: null, meta: null, space: hnswConfig.space, target: hnswTarget },
    state: indexState,
    fieldPostings,
    fieldTokens,
    minhash: includeMinhash
      ? await loadMinhashSignatures(dir, { maxBytes: MAX_JSON_BYTES, manifest, strict })
      : null,
    phraseNgrams: await loadOptionalObject('phrase_ngrams'),
    chargrams: await loadOptionalObject('chargram_postings')
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
  idx.filterIndex = includeFilterIndex
    ? (filterIndexRaw
      ? (hydrateFilterIndex(filterIndexRaw) || buildFilterIndex(chunkMeta, { fileChargramN }))
      : buildFilterIndex(chunkMeta, { fileChargramN }))
    : null;
  if (includeTokenIndexResolved) {
    try {
      idx.tokenIndex = loadTokenPostings(dir, {
        maxBytes: MAX_JSON_BYTES,
        manifest,
        strict
      });
    } catch (err) {
      const message = String(err?.message || '');
      const missingOptional = !strict && (
        err?.code === 'ERR_MANIFEST_MISSING'
        || err?.code === 'ERR_MANIFEST_INVALID'
        || err?.code === 'ERR_JSON_TOO_LARGE'
        || /Missing manifest entry for token_postings/i.test(message)
      );
      if (!missingOptional) throw err;
    }
  }
  return idx;
}

/**
 * Resolve the index directory (cache-first, local fallback).
 * @param {string} root
 * @param {'code'|'prose'|'records'|'extracted-prose'} mode
 * @param {object} userConfig
 * @returns {string}
 */
export function resolveIndexDir(root, mode, userConfig, options = {}) {
  const explicitDir = typeof options?.indexDirByMode?.[mode] === 'string'
    ? path.resolve(options.indexDirByMode[mode])
    : null;
  if (explicitDir) return explicitDir;
  const explicitBaseRoot = typeof options?.indexBaseRootByMode?.[mode] === 'string'
    ? path.resolve(options.indexBaseRootByMode[mode])
    : null;
  if (explicitBaseRoot) return path.join(explicitBaseRoot, `index-${mode}`);
  const hasExplicitRef = Boolean(
    options?.explicitRef === true
    && (options?.indexDirByMode || options?.indexBaseRootByMode)
  );
  if (hasExplicitRef) {
    throw createError(ERROR_CODES.NO_INDEX, `[search] ${mode} index is unavailable for explicit as-of target.`);
  }
  const cached = getIndexDir(root, mode, userConfig);
  if (hasChunkMetaArtifacts(cached)) {
    return cached;
  }
  const local = path.join(root, `index-${mode}`);
  if (hasChunkMetaArtifacts(local)) {
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
  const dir = resolveIndexDir(root, mode, userConfig, options?.resolveOptions || {});
  if (!hasChunkMetaArtifacts(dir)) {
    const suffix = (mode === 'records' || mode === 'extracted-prose')
      ? ` --mode ${mode}`
      : '';
    const message = `[search] ${mode} index not found at ${dir}. Run "pairofcleats index build${suffix}" (build-index) or "node build_index.js${suffix}".`;
    const emitOutput = options.emitOutput !== false;
    const exitOnError = options.exitOnError !== false;
    if (emitOutput) console.error(message);
    if (exitOnError) process.exit(1);
    throw createError(ERROR_CODES.NO_INDEX, message);
  }
  return dir;
}

/**
 * Build a deterministic cache key for the current query + settings.
 * @param {object} payload
 * @returns {{key:string,payload:object}}
 */
export function buildQueryCacheKey(payload) {
  const keyInfo = buildLocalCacheKey({
    namespace: 'query-cache',
    payload
  });
  return { key: keyInfo.key, payload };
}

/**
 * Build a signature payload for cache invalidation.
 * @param {object} options
 * @returns {object}
 */
export async function getIndexSignature(options) {
  const {
    useSqlite,
    backendLabel,
    sqliteCodePath,
    sqliteProsePath,
    sqliteExtractedProsePath,
    runRecords,
    runExtractedProse,
    includeExtractedProse,
    root,
    userConfig,
    indexDirByMode = null,
    indexBaseRootByMode = null,
    explicitRef = false,
    asOfContext = null
  } = options;
  const safeStat = async (targetPath) => {
    try {
      return await fsSync.promises.stat(targetPath);
    } catch {
      return null;
    }
  };
  const fileSignature = async (filePath) => {
    try {
      if (!filePath) return null;
      let statPath = path.resolve(filePath);
      let stat = await safeStat(statPath);
      if (!stat && statPath.endsWith('.json')) {
        const zstPath = path.resolve(`${filePath}.zst`);
        stat = await safeStat(zstPath);
        if (stat) {
          statPath = zstPath;
        } else {
          const gzPath = path.resolve(`${filePath}.gz`);
          stat = await safeStat(gzPath);
          if (stat) statPath = gzPath;
        }
      }
      if (!stat) return null;
      return `${stat.size}:${stat.mtimeMs}`;
    } catch {
      return null;
    }
  };
  const resolveOptions = {
    indexDirByMode,
    indexBaseRootByMode,
    explicitRef
  };
  const safeResolveModeDir = (mode) => {
    try {
      return resolveIndexDir(root, mode, userConfig, resolveOptions);
    } catch {
      return null;
    }
  };
  const needsExtractedProse = includeExtractedProse ?? runExtractedProse;
  const modeDirs = {
    code: safeResolveModeDir('code'),
    prose: safeResolveModeDir('prose'),
    'extracted-prose': needsExtractedProse ? safeResolveModeDir('extracted-prose') : null,
    records: runRecords ? safeResolveModeDir('records') : null
  };
  const modeSignatures = {};
  await Promise.all(
    Object.entries(modeDirs).map(async ([mode, dir]) => {
      modeSignatures[mode] = dir ? await buildIndexSignature(dir) : null;
    })
  );
  const asOfSignature = asOfContext
    ? {
      ref: asOfContext.ref || null,
      identityHash: asOfContext.identityHash || null,
      type: asOfContext.type || null
    }
    : null;

  if (useSqlite) {
    const [codeSig, proseSig, extractedSig] = await Promise.all([
      fileSignature(sqliteCodePath),
      fileSignature(sqliteProsePath),
      needsExtractedProse ? fileSignature(sqliteExtractedProsePath) : Promise.resolve(null)
    ]);
    return {
      backend: backendLabel,
      asOf: asOfSignature,
      sqlite: {
        code: codeSig,
        prose: proseSig,
        extractedProse: extractedSig
      },
      modes: modeSignatures
    };
  }
  return {
    backend: backendLabel,
    asOf: asOfSignature,
    modes: modeSignatures
  };
}
