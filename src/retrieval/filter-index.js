import { tri } from '../shared/tokenize.js';
import { normalizeFilePath } from '../shared/path-normalize.js';
import { toArray } from '../shared/iterables.js';
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
    byLang: new Map(),
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

  const addOne = (map, entry, id) => {
    const key = String(entry || '').toLowerCase();
    if (!key) return;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = new Set();
      map.set(key, bucket);
    }
    bucket.add(id);
  };

  const add = (map, value, id) => {
    if (value == null) return;
    const list = toArray(value);
    if (list.length) {
      for (const entry of list) addOne(map, entry, id);
      return;
    }
    addOne(map, value, id);
  };
  const resolveChunkAuthorsForIndex = (chunk) => {
    const chunkAuthors = toArray(chunk?.chunk_authors);
    if (chunkAuthors.length) return chunkAuthors;
    const chunkAuthorsLegacy = toArray(chunk?.chunkAuthors);
    if (chunkAuthorsLegacy.length) return chunkAuthorsLegacy;
    const lastAuthor = chunk?.last_author;
    const lastAuthorList = toArray(lastAuthor);
    if (lastAuthorList.length) return lastAuthorList;
    if (lastAuthor) return [lastAuthor];
    return [];
  };

  const normalizeLang = (value) => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return normalized || null;
  };
  const resolveEffectiveLang = (chunk) => {
    let normalized = normalizeLang(chunk?.metaV2?.lang);
    if (normalized) return normalized;
    normalized = normalizeLang(chunk?.metaV2?.effective?.languageId);
    if (normalized) return normalized;
    normalized = normalizeLang(chunk?.lang);
    if (normalized) return normalized;
    return 'unknown';
  };

  const resolveVisibilityFromModifiers = (modifiers) => {
    if (!modifiers) return null;
    if (Array.isArray(modifiers)) {
      for (const entry of modifiers) {
        const token = String(entry || '').trim().toLowerCase();
        if (!token) continue;
        if (token.startsWith('visibility:')) {
          const value = token.split(':').slice(1).join(':').trim();
          if (value) return value;
        }
        if (token === 'public' || token === 'private' || token === 'protected' || token === 'internal') {
          return token;
        }
      }
      return null;
    }
    if (typeof modifiers === 'object') {
      if (typeof modifiers.visibility === 'string') return modifiers.visibility;
    }
    return null;
  };

  const resolveVisibility = (chunk) => {
    const docmeta = (chunk?.docmeta && typeof chunk.docmeta === 'object') ? chunk.docmeta : null;
    const metaV2 = (chunk?.metaV2 && typeof chunk.metaV2 === 'object') ? chunk.metaV2 : null;
    const docmetaVisibility = typeof docmeta?.visibility === 'string' ? docmeta.visibility : null;
    if (docmetaVisibility) return docmetaVisibility;
    const docmetaModifierVisibility = resolveVisibilityFromModifiers(docmeta?.modifiers);
    if (docmetaModifierVisibility) return docmetaModifierVisibility;
    const metaV2Visibility = typeof metaV2?.visibility === 'string' ? metaV2.visibility : null;
    if (metaV2Visibility) return metaV2Visibility;
    return resolveVisibilityFromModifiers(metaV2?.modifiers);
  };

  const normalizeFilePathKey = (value) => normalizeFilePath(value, { lower: true });
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
    const normalized = normalizeFilePathKey(fileValue);
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

  for (const chunk of toArray(chunkMeta)) {
    if (!chunk) continue;
    const id = chunk.id;
    if (!Number.isFinite(id)) continue;
    addFile(chunk.file, id);
    add(index.byExt, chunk.ext, id);
    const effectiveLang = resolveEffectiveLang(chunk);
    add(index.byLang, effectiveLang, id);
    add(index.byKind, chunk.kind, id);
    add(index.byAuthor, chunk.last_author, id);
    const visibility = resolveVisibility(chunk);
    add(index.byVisibility, visibility, id);
    const chunkAuthors = resolveChunkAuthorsForIndex(chunk);
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
    out[key] = toArray(value);
  }
  return out;
};

const clearMapSets = (map) => {
  if (!map || typeof map.values !== 'function') return;
  for (const value of map.values()) {
    if (value && typeof value.clear === 'function') value.clear();
  }
  if (typeof map.clear === 'function') map.clear();
};

const clearSetArray = (list) => {
  if (!Array.isArray(list)) return;
  for (const entry of list) {
    if (entry && typeof entry.clear === 'function') entry.clear();
  }
  list.length = 0;
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
    byLang: serializeMap(index.byLang),
    byKind: serializeMap(index.byKind),
    byAuthor: serializeMap(index.byAuthor),
    byChunkAuthor: serializeMap(index.byChunkAuthor),
    byVisibility: serializeMap(index.byVisibility),
    // Must be a copy because buildSerializedFilterIndex releases index memory after serialization.
    fileById: Array.isArray(index.fileById) ? index.fileById.slice() : [],
    fileChunksById: Array.isArray(index.fileChunksById)
      ? index.fileChunksById.map((set) => toArray(set))
      : [],
    fileChargrams: serializeMap(index.fileChargrams)
  };
}

export function releaseFilterIndexMemory(index) {
  if (!index || typeof index !== 'object') return;
  clearMapSets(index.byExt);
  clearMapSets(index.byLang);
  clearMapSets(index.byKind);
  clearMapSets(index.byAuthor);
  clearMapSets(index.byChunkAuthor);
  clearMapSets(index.byVisibility);
  clearMapSets(index.fileChargrams);
  clearSetArray(index.fileChunksById);
  if (Array.isArray(index.fileById)) index.fileById.length = 0;
  if (index.fileIdByPath && typeof index.fileIdByPath.clear === 'function') {
    index.fileIdByPath.clear();
  }
  index.bitmap = null;
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
    byLang: raw.byLang ? hydrateMap(raw.byLang) : null,
    byKind: hydrateMap(raw.byKind),
    byAuthor: hydrateMap(raw.byAuthor),
    byChunkAuthor: hydrateMap(raw.byChunkAuthor),
    byVisibility: hydrateMap(raw.byVisibility),
    fileById,
    fileIdByPath,
    fileChunksById: Array.isArray(raw.fileChunksById)
      ? raw.fileChunksById.map((list) => new Set(toArray(list)))
      : [],
    fileChargrams: hydrateMap(raw.fileChargrams)
  };
  index.bitmap = buildBitmapIndex(index);
  return index;
}
