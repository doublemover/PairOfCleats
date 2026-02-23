/**
 * Aggregate per-chunk boilerplate metadata into a compact reference catalog.
 *
 * @param {Array<object>} chunks
 * @returns {Array<{ref:string,count:number,positions:Record<string,number>,tags:Array<string>,sampleFiles:Array<string>}>}
 */
export const buildBoilerplateCatalog = (chunks) => {
  if (!Array.isArray(chunks) || !chunks.length) return [];
  const byRef = new Map();
  for (const chunk of chunks) {
    const docmeta = chunk?.docmeta;
    const ref = typeof docmeta?.boilerplateRef === 'string'
      ? docmeta.boilerplateRef
      : null;
    if (!ref) continue;
    let row = byRef.get(ref);
    if (!row) {
      row = {
        ref,
        count: 0,
        positions: {},
        tags: new Set(),
        sampleFiles: [],
        sampleFileSet: new Set()
      };
      byRef.set(ref, row);
    }

    row.count += 1;
    const position = typeof docmeta?.boilerplatePosition === 'string'
      ? docmeta.boilerplatePosition
      : 'unknown';
    row.positions[position] = (row.positions[position] || 0) + 1;

    const tags = Array.isArray(docmeta?.boilerplateTags)
      ? docmeta.boilerplateTags
      : [];
    for (const tag of tags) {
      if (typeof tag === 'string' && tag.trim()) {
        row.tags.add(tag.trim());
      }
    }

    const file = typeof chunk?.file === 'string' ? chunk.file : null;
    if (file && row.sampleFiles.length < 8 && !row.sampleFileSet.has(file)) {
      row.sampleFileSet.add(file);
      row.sampleFiles.push(file);
    }
  }

  return Array.from(byRef.values())
    .map((row) => ({
      ref: row.ref,
      count: row.count,
      positions: row.positions,
      tags: Array.from(row.tags).sort(),
      sampleFiles: row.sampleFiles
    }))
    .sort((a, b) => b.count - a.count || a.ref.localeCompare(b.ref));
};
