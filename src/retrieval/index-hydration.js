import { buildFilterIndex, hydrateFilterIndex } from './filter-index.js';
import { loadHnswIndex } from '../shared/hnsw.js';
import { createVocabIndex } from './vocab-index.js';
import path from 'node:path';
import { embeddingBindingMismatches } from '../shared/embedding-generation.js';

const CHUNK_FILE_META_FIELDS = Object.freeze([
  ['file', 'missing'],
  ['ext', 'missing'],
  ['externalDocs', 'missing'],
  ['last_modified', 'missing'],
  ['last_author', 'missing'],
  ['churn', 'falsy-or-nullish'],
  ['churn_added', 'falsy-or-nullish'],
  ['churn_deleted', 'falsy-or-nullish'],
  ['churn_commits', 'falsy-or-nullish']
]);

const shouldAssignMetaField = (chunk, field, mode) => (
  mode === 'nullish' ? chunk[field] == null : !chunk[field]
);

export const buildFileMetaById = (entries) => {
  if (!Array.isArray(entries)) return null;
  const fileMetaById = new Map();
  for (const entry of entries) {
    if (!entry || entry.id == null) continue;
    fileMetaById.set(entry.id, entry);
  }
  return fileMetaById;
};

export const requireFileMetaForFileIdChunks = (chunkMeta) => {
  const missingMeta = (Array.isArray(chunkMeta) ? chunkMeta : [])
    .some((chunk) => chunk && chunk.fileId != null && !chunk.file);
  if (missingMeta) {
    throw new Error('file_meta.json is required for fileId-based chunk metadata.');
  }
};

export const hydrateChunksFromFileMeta = (
  chunkMeta,
  fileMetaById,
  {
    churnAssignment = 'falsy-or-nullish',
    skipWhenFileAndExt = false
  } = {}
) => {
  if (!fileMetaById) return;
  for (const chunk of Array.isArray(chunkMeta) ? chunkMeta : []) {
    if (!chunk) continue;
    if (skipWhenFileAndExt && chunk.file && chunk.ext) continue;
    const meta = fileMetaById.get(chunk.fileId);
    if (!meta) continue;
    for (const [field, defaultMode] of CHUNK_FILE_META_FIELDS) {
      const mode = field.startsWith('churn') ? churnAssignment : defaultMode;
      if (shouldAssignMetaField(chunk, field, mode)) chunk[field] = meta[field];
    }
  }
};

const ensureVocabIndex = (artifact) => {
  if (artifact?.vocab && !artifact.vocabIndex) {
    artifact.vocabIndex = createVocabIndex(artifact.vocab);
  }
};

export const hydrateSearchIndexPostProcessing = (
  idx,
  {
    chunkMeta,
    fileChargramN,
    filterIndexRaw,
    includeFilterIndex = true
  } = {}
) => {
  ensureVocabIndex(idx?.phraseNgrams);
  ensureVocabIndex(idx?.chargrams);
  if (idx?.fieldPostings?.fields) {
    for (const field of Object.keys(idx.fieldPostings.fields)) {
      ensureVocabIndex(idx.fieldPostings.fields[field]);
    }
  }
  idx.filterIndex = includeFilterIndex
    ? (filterIndexRaw
      ? (hydrateFilterIndex(filterIndexRaw) || buildFilterIndex(chunkMeta, { fileChargramN }))
      : buildFilterIndex(chunkMeta, { fileChargramN }))
    : null;
  return idx;
};

export const loadSearchHnswIndex = ({
  indexPath,
  hnswConfig,
  hnswMeta,
  embeddingsState = null,
  strict = true,
  denseVec = null,
  denseVecDoc = null,
  denseVecCode = null
}) => {
  if (embeddingsState?.ready === false || embeddingsState?.pending === true) return { index: null, available: false };
  const backendState = embeddingsState?.backends?.hnsw;
  if (backendState?.enabled === false || (backendState?.available === false
    && (!hnswMeta.variant || backendState.target === hnswMeta.variant))) return { index: null, available: false };
  const mismatches = embeddingBindingMismatches(hnswMeta, embeddingsState);
  for (const dense of [denseVec, denseVecDoc, denseVecCode]) {
    if (dense && embeddingsState?.embeddingGeneration
      && dense.embeddingGeneration !== embeddingsState.embeddingGeneration) mismatches.push('dense embeddingGeneration');
  }
  if (hnswMeta.backendGeneration) {
    const expectedSuffix = hnswMeta.backendGeneration.split('/');
    const actual = path.dirname(indexPath).split(path.sep);
    if (actual.slice(-expectedSuffix.length).join('/') !== expectedSuffix.join('/')) mismatches.push('backendGeneration path');
    const variant = hnswMeta.variant;
    const expectedName = variant === 'merged' ? 'dense_vectors_hnsw.bin' : `dense_vectors_${variant}_hnsw.bin`;
    if (!['merged', 'doc', 'code'].includes(variant) || path.basename(indexPath) !== expectedName) mismatches.push('backend variant path');
  } else if (embeddingsState?.embeddingGeneration) {
    mismatches.push('backendGeneration');
  }
  if (mismatches.length) {
    if (strict) throw new Error(`Embedding identity mismatch detected before HNSW load: ${mismatches.join(', ')}`);
    return { index: null, available: false };
  }
  const mergedConfig = {
    ...hnswConfig,
    space: hnswMeta.space || hnswConfig.space,
    efSearch: hnswMeta.efSearch || hnswConfig.efSearch
  };
  const expectedModel = denseVec?.model || denseVecDoc?.model || denseVecCode?.model || null;
  const expectedDims = denseVec?.dims || denseVecDoc?.dims || denseVecCode?.dims || hnswMeta.dims;
  const index = loadHnswIndex({
    indexPath,
    dims: expectedDims,
    config: mergedConfig,
    meta: hnswMeta,
    expectedModel
  });
  return {
    index,
    available: Boolean(index)
  };
};
