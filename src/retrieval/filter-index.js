import { tri } from '../shared/tokenize.js';
import { buildBitmapIndex } from './bitmap.js';

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
  const includeBitmaps = options.includeBitmaps !== false;
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

  if (includeBitmaps) {
    index.bitmap = buildBitmapIndex(index);
  }
  return index;
}

const serializeMap = (map) => {
  const out = {};
  if (!map || typeof map.entries !== 'function') return out;
  for (const [key, value] of map.entries()) {
    out[key] = Array.from(value || []);
  }
  return out;
};

const hydrateMap = (value) => {
  const map = new Map();
  if (!value || typeof value !== 'object') return map;
  for (const [key, list] of Object.entries(value)) {
    map.set(key, new Set(Array.isArray(list) ? list : []));
  }
  return map;
};

export function serializeFilterIndex(index) {
  if (!index) return null;
  return {
    fileChargramN: index.fileChargramN || 3,
    byExt: serializeMap(index.byExt),
    byKind: serializeMap(index.byKind),
    byAuthor: serializeMap(index.byAuthor),
    byChunkAuthor: serializeMap(index.byChunkAuthor),
    byVisibility: serializeMap(index.byVisibility),
    fileById: Array.isArray(index.fileById) ? index.fileById : [],
    fileChunksById: Array.isArray(index.fileChunksById)
      ? index.fileChunksById.map((set) => Array.from(set || []))
      : [],
    fileChargrams: serializeMap(index.fileChargrams)
  };
}

export function hydrateFilterIndex(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const fileById = Array.isArray(raw.fileById) ? raw.fileById : [];
  const fileIdByPath = new Map(fileById.map((value, idx) => [value, idx]));     
  const index = {
    fileChargramN: Number.isFinite(Number(raw.fileChargramN))
      ? Math.max(2, Math.floor(Number(raw.fileChargramN)))
      : 3,
    byExt: hydrateMap(raw.byExt),
    byKind: hydrateMap(raw.byKind),
    byAuthor: hydrateMap(raw.byAuthor),
    byChunkAuthor: hydrateMap(raw.byChunkAuthor),
    byVisibility: hydrateMap(raw.byVisibility),
    fileById,
    fileIdByPath,
    fileChunksById: Array.isArray(raw.fileChunksById)
      ? raw.fileChunksById.map((list) => new Set(Array.isArray(list) ? list : []))
      : [],
    fileChargrams: hydrateMap(raw.fileChargrams)
  };
  index.bitmap = buildBitmapIndex(index);
  return index;
}
