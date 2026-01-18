import { Unpackr } from 'msgpackr';
import { buildFilterIndex, hydrateFilterIndex } from './filter-index.js';
import { loadHnswIndex, normalizeHnswConfig, resolveHnswPaths } from '../shared/hnsw.js';
import { LMDB_ARTIFACT_KEYS, LMDB_META_KEYS } from '../storage/lmdb/schema.js';

const unpackr = new Unpackr();
const decode = (value) => (value == null ? null : unpackr.unpack(value));

/**
 * Create LMDB helper functions for search.
 * @param {object} options
 * @param {(mode:'code'|'prose')=>object|null} options.getDb
 * @param {object} options.hnswConfig
 * @param {string} options.modelIdDefault
 * @param {number} options.fileChargramN
 * @param {Record<string,string>} options.indexDirs
 * @returns {object}
 */
export function createLmdbHelpers(options) {
  const {
    getDb,
    hnswConfig: rawHnswConfig,
    modelIdDefault,
    fileChargramN,
    indexDirs
  } = options;
  const hnswConfig = normalizeHnswConfig(rawHnswConfig || {});

  const getArtifact = (db, key) => decode(db.get(key));

  /**
   * Load index artifacts from LMDB into in-memory structures.
   * @param {'code'|'prose'} mode
   * @param {object} [options]
   * @returns {object}
   */
  function loadIndexFromLmdb(mode, options = {}) {
    const db = getDb(mode);
    if (!db) throw new Error('LMDB backend requested but database is not available.');
    const includeMinhash = options.includeMinhash !== false;
    const includeDense = options.includeDense !== false;
    const includeChunks = options.includeChunks !== false;
    const includeFilterIndex = options.includeFilterIndex !== false;
    const includeHnsw = options.includeHnsw !== false;

    const chunkCountRaw = getArtifact(db, LMDB_META_KEYS.chunkCount);
    const chunkCount = Number.isFinite(Number(chunkCountRaw)) ? Number(chunkCountRaw) : 0;
    let chunkMeta = includeChunks
      ? (getArtifact(db, LMDB_ARTIFACT_KEYS.chunkMeta) || [])
      : (chunkCount ? Array.from({ length: chunkCount }) : []);

    const fileMetaRaw = getArtifact(db, LMDB_ARTIFACT_KEYS.fileMeta);
    let fileMetaById = null;
    if (Array.isArray(fileMetaRaw)) {
      fileMetaById = new Map();
      for (const entry of fileMetaRaw) {
        if (!entry || entry.id == null) continue;
        fileMetaById.set(entry.id, entry);
      }
    }
    if (!fileMetaById && includeChunks) {
      const missingMeta = chunkMeta.some((chunk) => chunk && chunk.fileId != null && !chunk.file);
      if (missingMeta) {
        throw new Error('file_meta.json is required for fileId-based chunk metadata.');
      }
    } else if (fileMetaById && includeChunks) {
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

    const fileRelationsRaw = getArtifact(db, LMDB_ARTIFACT_KEYS.fileRelations);
    const repoMap = getArtifact(db, LMDB_ARTIFACT_KEYS.repoMap);
    let fileRelations = null;
    if (Array.isArray(fileRelationsRaw)) {
      const map = new Map();
      for (const entry of fileRelationsRaw) {
        if (!entry || !entry.file) continue;
        map.set(entry.file, entry.relations || null);
      }
      fileRelations = map;
    }

    const indexState = getArtifact(db, LMDB_ARTIFACT_KEYS.indexState);
    const embeddingsState = indexState?.embeddings || null;
    const embeddingsReady = embeddingsState?.ready !== false && embeddingsState?.pending !== true;
    const denseVec = embeddingsReady && includeDense
      ? getArtifact(db, LMDB_ARTIFACT_KEYS.denseVectors)
      : null;
    const denseVecDoc = embeddingsReady && includeDense
      ? getArtifact(db, LMDB_ARTIFACT_KEYS.denseVectorsDoc)
      : null;
    const denseVecCode = embeddingsReady && includeDense
      ? getArtifact(db, LMDB_ARTIFACT_KEYS.denseVectorsCode)
      : null;
    const hnswMeta = embeddingsReady && includeDense && includeHnsw && hnswConfig.enabled
      ? getArtifact(db, LMDB_ARTIFACT_KEYS.denseHnswMeta)
      : null;
    let hnswIndex = null;
    let hnswAvailable = false;
    if (hnswMeta && includeHnsw && hnswConfig.enabled) {
      const indexDir = indexDirs?.[mode] || null;
      if (indexDir) {
        const { indexPath } = resolveHnswPaths(indexDir);
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
    }

    const fieldPostings = getArtifact(db, LMDB_ARTIFACT_KEYS.fieldPostings);
    const fieldTokens = getArtifact(db, LMDB_ARTIFACT_KEYS.fieldTokens);
    if (denseVec && !denseVec.model && modelIdDefault) denseVec.model = modelIdDefault;
    if (denseVecDoc && !denseVecDoc.model && modelIdDefault) denseVecDoc.model = modelIdDefault;
    if (denseVecCode && !denseVecCode.model && modelIdDefault) denseVecCode.model = modelIdDefault;
    const filterIndexRaw = getArtifact(db, LMDB_ARTIFACT_KEYS.filterIndex);
    const idx = {
      chunkMeta,
      fileRelations,
      repoMap,
      denseVec,
      denseVecDoc,
      denseVecCode,
      hnsw: hnswMeta ? {
        available: hnswAvailable,
        index: hnswIndex,
        meta: hnswMeta,
        space: hnswMeta.space || hnswConfig.space
      } : { available: false, index: null, meta: null, space: hnswConfig.space },
      state: indexState,
      fieldPostings,
      fieldTokens,
      minhash: includeMinhash ? getArtifact(db, LMDB_ARTIFACT_KEYS.minhashSignatures) : null,
      phraseNgrams: getArtifact(db, LMDB_ARTIFACT_KEYS.phraseNgrams),
      chargrams: getArtifact(db, LMDB_ARTIFACT_KEYS.chargramPostings)
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
    idx.tokenIndex = getArtifact(db, LMDB_ARTIFACT_KEYS.tokenPostings);
    return idx;
  }

  return { loadIndexFromLmdb };
}
