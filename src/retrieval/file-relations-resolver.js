import { normalizeFilePath } from '../shared/path-normalize.js';

const lowerCaseRelationLookupCache = new WeakMap();
const toLowerSafe = (value) => (typeof value === 'string' ? value.toLowerCase() : '');
const AMBIGUOUS_RELATION_LOOKUP = Symbol('ambiguousRelationLookup');
const normalizeLookupKey = (value) => normalizeFilePath(value, { lower: false });

const addCaseInsensitiveLookupEntry = (lookup, key, value) => {
  if (typeof key !== 'string' || !key) return;
  const normalizedKey = normalizeLookupKey(key);
  if (!normalizedKey) return;
  const lowered = toLowerSafe(normalizedKey);
  if (!lowered) return;
  if (!lookup.has(lowered)) {
    lookup.set(lowered, value);
    return;
  }
  const existing = lookup.get(lowered);
  if (existing !== AMBIGUOUS_RELATION_LOOKUP && existing !== value) {
    lookup.set(lowered, AMBIGUOUS_RELATION_LOOKUP);
  }
};

const getCaseInsensitiveLookupValue = (lookup, filePath) => {
  const normalizedPath = normalizeLookupKey(filePath);
  const lowered = toLowerSafe(normalizedPath);
  if (!lowered) return null;
  const value = lookup.get(lowered);
  if (value === AMBIGUOUS_RELATION_LOOKUP) return null;
  return value || null;
};

/**
 * Resolve file-level relation metadata with case-aware lookup semantics.
 * @param {Map<string,object>|Record<string,object>|null|undefined} relationsStore
 * @param {string} filePath
 * @param {boolean} [caseSensitiveFile=false]
 * @returns {object|null}
 */
export const resolveFileRelations = (relationsStore, filePath, caseSensitiveFile = false) => {
  if (!relationsStore || typeof filePath !== 'string' || !filePath) return null;
  const normalizedFilePath = normalizeLookupKey(filePath);
  if (!normalizedFilePath) return null;
  if (typeof relationsStore.get === 'function') {
    if (typeof relationsStore.has === 'function' && relationsStore.has(filePath)) {
      return relationsStore.get(filePath);
    }
    if (
      normalizedFilePath !== filePath
      && typeof relationsStore.has === 'function'
      && relationsStore.has(normalizedFilePath)
    ) {
      return relationsStore.get(normalizedFilePath);
    }
    const direct = relationsStore.get(filePath) || relationsStore.get(normalizedFilePath);
    if (direct) return direct;
    if (caseSensitiveFile) return null;
    let normalized = lowerCaseRelationLookupCache.get(relationsStore);
    if (!normalized) {
      normalized = new Map();
      for (const [key, value] of relationsStore.entries()) {
        addCaseInsensitiveLookupEntry(normalized, key, value);
      }
      lowerCaseRelationLookupCache.set(relationsStore, normalized);
    }
    return getCaseInsensitiveLookupValue(normalized, filePath);
  }
  if (Object.prototype.hasOwnProperty.call(relationsStore, filePath)) {
    return relationsStore[filePath];
  }
  if (
    normalizedFilePath !== filePath
    && Object.prototype.hasOwnProperty.call(relationsStore, normalizedFilePath)
  ) {
    return relationsStore[normalizedFilePath];
  }
  if (caseSensitiveFile) return null;
  let normalized = lowerCaseRelationLookupCache.get(relationsStore);
  if (!normalized) {
    normalized = new Map();
    for (const [key, value] of Object.entries(relationsStore)) {
      addCaseInsensitiveLookupEntry(normalized, key, value);
    }
    lowerCaseRelationLookupCache.set(relationsStore, normalized);
  }
  return getCaseInsensitiveLookupValue(normalized, filePath);
};
