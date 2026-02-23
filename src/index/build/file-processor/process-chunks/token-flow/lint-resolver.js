/**
 * Fallback chunk-lint filter used when incremental resolver cannot be reused.
 *
 * @param {Array<object>} entries
 * @param {number} startLine
 * @param {number} endLine
 * @param {boolean} includeUnscoped
 * @returns {Array<object>}
 */
const filterLintForChunk = (entries, startLine, endLine, includeUnscoped) => {
  if (!entries.length) return entries;
  return entries.filter((entry) => {
    const entryLine = Number(entry?.line);
    if (!Number.isFinite(entryLine)) return includeUnscoped;
    const entryEnd = Number.isFinite(Number(entry?.endLine)) ? Number(entry.endLine) : entryLine;
    return entryLine <= endLine && entryEnd >= startLine;
  });
};

/**
 * Build monotonic chunk-lint resolver with active-window cursor reuse.
 *
 * Invariant: when calls arrive with non-decreasing `startLine`, runtime stays
 * linear in scoped entries + chunks. Out-of-order calls safely fall back to
 * full filtering to preserve exact results.
 *
 * @param {Array<object>} entries
 * @returns {(startLine:number,endLine:number,includeUnscoped?:boolean)=>Array<object>}
 */
export const createLintChunkResolver = (entries) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return () => [];
  }
  const scoped = [];
  const unscoped = [];
  for (const entry of entries) {
    const entryLine = Number(entry?.line);
    if (!Number.isFinite(entryLine)) {
      unscoped.push(entry);
      continue;
    }
    const entryEnd = Number.isFinite(Number(entry?.endLine)) ? Number(entry.endLine) : entryLine;
    scoped.push({ entry, start: entryLine, end: entryEnd });
  }
  scoped.sort((a, b) => a.start - b.start || a.end - b.end);
  const active = [];
  let cursor = 0;
  let lastStart = Number.NEGATIVE_INFINITY;
  return (startLine, endLine, includeUnscoped = false) => {
    if (startLine < lastStart) {
      return filterLintForChunk(entries, startLine, endLine, includeUnscoped);
    }
    lastStart = startLine;
    while (cursor < scoped.length && scoped[cursor].start <= endLine) {
      active.push(scoped[cursor]);
      cursor += 1;
    }
    let writeIndex = 0;
    for (let i = 0; i < active.length; i += 1) {
      if (active[i].end >= startLine) {
        active[writeIndex] = active[i];
        writeIndex += 1;
      }
    }
    active.length = writeIndex;
    if (!includeUnscoped && !active.length) return [];
    const out = [];
    if (includeUnscoped && unscoped.length) {
      out.push(...unscoped);
    }
    for (const item of active) out.push(item.entry);
    return out;
  };
};
