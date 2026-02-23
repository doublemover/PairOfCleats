import { buildFilterIndex } from '../filter-index.js';

export const EMPTY_INDEX = {
  chunkMeta: [],
  denseVec: null,
  minhash: null,
  filterIndex: null,
  fileRelations: null,
  repoMap: null
};

export const rebuildFilterIndexIfPresent = ({ idx, fileChargramN }) => {
  if (!idx || !Array.isArray(idx.chunkMeta) || !idx.filterIndex) return false;
  idx.filterIndex = buildFilterIndex(idx.chunkMeta, { fileChargramN });
  return true;
};
