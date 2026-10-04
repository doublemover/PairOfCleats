import { types } from 'node:util';
import { buildFilterIndex, hydrateFilterIndex } from './filter-index.js';
import { loadHnswIndex } from '../shared/hnsw.js';

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

const ARRAY_MAP = Array.prototype.map;
const ARRAY_FOR_EACH = Array.prototype.forEach;

const createVocabIndex = (vocab) => {
  const map = vocab.map;
  const canBuildDirectly = Array.isArray(vocab) && !types.isProxy(vocab)
    && Object.getPrototypeOf(vocab) === Array.prototype
    && !Object.hasOwn(vocab, 'map') && !Object.hasOwn(vocab, 'constructor')
    && map === ARRAY_MAP
    && Object.getOwnPropertyDescriptor(Array.prototype, 'constructor')?.value === Array;
  if (!canBuildDirectly) {
    return new Map(Reflect.apply(map, vocab, [(term, index) => [term, index]]));
  }
  const length = vocab.length;
  const index = new Map();
  let visited = 0;
  ARRAY_FOR_EACH.call(vocab, (term, position) => {
    index.set(term, position);
    visited += 1;
  });
  if (visited !== length) {
    // The previous mapped array's holes were invalid Map entries. Preserve the
    // native error after visiting every source element, without publishing a Map.
    return new Map([undefined]);
  }
  return index;
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
  denseVec = null,
  denseVecDoc = null,
  denseVecCode = null
}) => {
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
