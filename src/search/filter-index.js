/**
 * Build lookup maps for common search filters.
 * @param {Array<object>} chunkMeta
 * @returns {object}
 */
export function buildFilterIndex(chunkMeta = []) {
  const index = {
    byExt: new Map(),
    byKind: new Map(),
    byAuthor: new Map(),
    byChunkAuthor: new Map(),
    byVisibility: new Map()
  };

  const add = (map, value, id) => {
    if (!value) return;
    const key = String(value || '').toLowerCase();
    if (!key) return;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = new Set();
      map.set(key, bucket);
    }
    bucket.add(id);
  };

  for (const chunk of chunkMeta) {
    if (!chunk) continue;
    const id = chunk.id;
    if (!Number.isFinite(id)) continue;
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
