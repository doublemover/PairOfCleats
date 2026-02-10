const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export const CHUNK_META_COLD_FIELDS = Object.freeze([
  'preContext',
  'postContext',
  'segment',
  'codeRelations',
  'metaV2',
  'stats',
  'complexity',
  'lint',
  'chunk_authors',
  'chunkAuthors'
]);

export const stripChunkMetaColdFields = (entry) => {
  if (!entry || typeof entry !== 'object') return entry;
  const hot = { ...entry };
  for (const field of CHUNK_META_COLD_FIELDS) {
    if (hasOwn(hot, field)) {
      delete hot[field];
    }
  }
  return hot;
};

export const extractChunkMetaColdFields = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const id = Number(entry.id);
  if (!Number.isFinite(id)) return null;
  const cold = { id };
  for (const field of CHUNK_META_COLD_FIELDS) {
    if (!hasOwn(entry, field)) continue;
    const value = entry[field];
    if (value === undefined) continue;
    cold[field] = value;
  }
  return cold;
};

export const mergeChunkMetaColdFields = (hotEntry, coldEntry) => {
  if (!hotEntry || typeof hotEntry !== 'object') return hotEntry;
  if (!coldEntry || typeof coldEntry !== 'object') return hotEntry;
  const merged = { ...hotEntry };
  for (const field of CHUNK_META_COLD_FIELDS) {
    if (!hasOwn(coldEntry, field)) continue;
    merged[field] = coldEntry[field];
  }
  return merged;
};
