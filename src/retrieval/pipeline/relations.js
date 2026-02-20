const lowerCaseRelationLookupCache = new WeakMap();
const toLowerSafe = (value) => (typeof value === 'string' ? value.toLowerCase() : '');
const AMBIGUOUS_RELATION_LOOKUP = Symbol('ambiguousRelationLookup');

const addCaseInsensitiveLookupEntry = (lookup, key, value) => {
  if (typeof key !== 'string' || !key) return;
  const lowered = toLowerSafe(key);
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
  const lowered = toLowerSafe(filePath);
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
  if (typeof relationsStore.get === 'function') {
    if (typeof relationsStore.has === 'function' && relationsStore.has(filePath)) {
      return relationsStore.get(filePath);
    }
    const direct = relationsStore.get(filePath);
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
