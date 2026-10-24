import { normalizeHnswConfig, resolveHnswPaths, resolveHnswTarget } from '../shared/hnsw.js';
import { assertMinhashHashIdentity } from '../index/minhash.js';
import { admitSortedPostings } from '../shared/posting-order.js';
import { LMDB_ARTIFACT_KEYS, LMDB_META_KEYS } from '../storage/lmdb/schema.js';
import { decodeLmdbValue } from '../storage/lmdb/utils.js';
import {
  buildFileMetaById,
  hydrateChunksFromFileMeta,
  hydrateSearchIndexPostProcessing,
  loadSearchHnswIndex,
  requireFileMetaForFileIdChunks
} from './index-hydration.js';

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
    indexDirs,
    denseVectorMode
  } = options;
  const hnswConfig = normalizeHnswConfig(rawHnswConfig || {});

  const getArtifact = (db, key) => decodeLmdbValue(db.get(key));

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
    const includeTokenIndex = options.includeTokenIndex !== false;
    const includeHnsw = options.includeHnsw !== false;

    const chunkCountRaw = getArtifact(db, LMDB_META_KEYS.chunkCount);
    const chunkCount = Number.isFinite(Number(chunkCountRaw)) ? Number(chunkCountRaw) : 0;
    let chunkMeta = includeChunks
      ? (getArtifact(db, LMDB_ARTIFACT_KEYS.chunkMeta) || [])
      : (chunkCount ? Array.from({ length: chunkCount }) : []);

    const fileMetaById = buildFileMetaById(getArtifact(db, LMDB_ARTIFACT_KEYS.fileMeta));
    if (!fileMetaById && includeChunks) {
      requireFileMetaForFileIdChunks(chunkMeta);
    } else if (fileMetaById && includeChunks) {
      hydrateChunksFromFileMeta(chunkMeta, fileMetaById, {
        churnAssignment: 'nullish'
      });
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
    const hnswTarget = resolveHnswTarget(mode, denseVectorMode);
    const hnswMetaKey = hnswTarget === 'doc' ? LMDB_ARTIFACT_KEYS.denseHnswMetaDoc
      : hnswTarget === 'code' ? LMDB_ARTIFACT_KEYS.denseHnswMetaCode : LMDB_ARTIFACT_KEYS.denseHnswMeta;
    const hnswMeta = embeddingsReady && includeDense && includeHnsw && hnswConfig.enabled
      ? getArtifact(db, hnswMetaKey)
      : null;
    let hnswIndex = null;
    let hnswAvailable = false;
    if (hnswMeta && includeHnsw && hnswConfig.enabled) {
      const indexDir = indexDirs?.[mode] || null;
      if (indexDir) {
        const target = resolveHnswTarget(mode, denseVectorMode);
        const { indexPath } = resolveHnswPaths(indexDir, target, hnswMeta.backendGeneration);
        const loadedHnsw = loadSearchHnswIndex({
          indexPath,
          hnswConfig,
          hnswMeta,
          embeddingsState,
          strict: options.strict !== false,
          denseVec,
          denseVecDoc,
          denseVecCode
        });
        hnswIndex = loadedHnsw.index;
        hnswAvailable = loadedHnsw.available;
      }
    }

    const fieldPostings = includeTokenIndex ? getArtifact(db, LMDB_ARTIFACT_KEYS.fieldPostings) : null;
    const fieldTokens = includeTokenIndex ? getArtifact(db, LMDB_ARTIFACT_KEYS.fieldTokens) : null;
    if (denseVec && !denseVec.model && modelIdDefault) denseVec.model = modelIdDefault;
    if (denseVecDoc && !denseVecDoc.model && modelIdDefault) denseVecDoc.model = modelIdDefault;
    if (denseVecCode && !denseVecCode.model && modelIdDefault) denseVecCode.model = modelIdDefault;
    const filterIndexRaw = includeFilterIndex ? getArtifact(db, LMDB_ARTIFACT_KEYS.filterIndex) : null;
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
      phraseNgrams: includeTokenIndex ? getArtifact(db, LMDB_ARTIFACT_KEYS.phraseNgrams) : null,
      chargrams: includeTokenIndex ? getArtifact(db, LMDB_ARTIFACT_KEYS.chargramPostings) : null
    };
    if (idx.minhash?.signatures?.length) assertMinhashHashIdentity(idx.minhash.hashIdentity);
    hydrateSearchIndexPostProcessing(idx, {
      chunkMeta,
      fileChargramN,
      filterIndexRaw,
      includeFilterIndex
    });
    idx.tokenIndex = includeTokenIndex ? admitSortedPostings(getArtifact(db, LMDB_ARTIFACT_KEYS.tokenPostings), { completeVocabulary: true }) : null;
    return idx;
  }

  return { loadIndexFromLmdb };
}
