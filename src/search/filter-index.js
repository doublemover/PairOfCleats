import { tri } from '../shared/tokenize.js';

/**
 * Build lookup maps for common search filters.
 * @param {Array<object>} chunkMeta
 * @param {{fileChargramN?:number}} [options]
 * @returns {object}
 */
export function buildFilterIndex(chunkMeta = [], options = {}) {
  const fileChargramN = Number.isFinite(Number(options.fileChargramN))
    ? Math.max(2, Math.floor(Number(options.fileChargramN)))
    : 3;
  const index = {
    byExt: new Map(),
    byKind: new Map(),
    byAuthor: new Map(),
    byChunkAuthor: new Map(),
    byVisibility: new Map(),
    fileById: [],
    fileIdByPath: new Map(),
    fileChunksById: [],
    fileChargrams: new Map(),
    fileChargramN
  };

  const add = (map, value, id) => {
    if (!value) return;
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      const key = String(entry || '').toLowerCase();
      if (!key) continue;
      let bucket = map.get(key);
      if (!bucket) {
        bucket = new Set();
        map.set(key, bucket);
      }
      bucket.add(id);
    }
  };

  const normalizeFilePath = (value) => String(value || '').replace(/\\/g, '/').toLowerCase();
  const addFileChargrams = (fileId, fileValue) => {
    const grams = new Set(tri(fileValue, fileChargramN));
    for (const gram of grams) {
      let bucket = index.fileChargrams.get(gram);
      if (!bucket) {
        bucket = new Set();
        index.fileChargrams.set(gram, bucket);
      }
      bucket.add(fileId);
    }
  };
  const addFile = (fileValue, chunkId) => {
    if (!fileValue) return;
    const normalized = normalizeFilePath(fileValue);
    let fileId = index.fileIdByPath.get(normalized);
    if (fileId == null) {
      fileId = index.fileById.length;
      index.fileIdByPath.set(normalized, fileId);
      index.fileById.push(normalized);
      index.fileChunksById[fileId] = new Set();
      addFileChargrams(fileId, normalized);
    }
    index.fileChunksById[fileId].add(chunkId);
  };

  for (const chunk of chunkMeta) {
    if (!chunk) continue;
    const id = chunk.id;
    if (!Number.isFinite(id)) continue;
    addFile(chunk.file, id);
    add(index.byExt, chunk.ext, id);
    add(index.byKind, chunk.kind, id);
    add(index.byAuthor, chunk.last_author, id);
    const visibility = chunk.docmeta?.visibility || chunk.docmeta?.modifiers?.visibility || null;
    add(index.byVisibility, visibility, id);
    const chunkAuthors = Array.isArray(chunk.chunk_authors) ? chunk.chunk_authors : [];
    for (const author of chunkAuthors) add(index.byChunkAuthor, author, id);
  }

  return index;
}
