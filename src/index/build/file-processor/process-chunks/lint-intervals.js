/** Project a completed file lint result onto closed source-line intervals.
 * The admission cursor is a high-water mark, not the end of the current chunk:
 * enclosing classes and nested methods may have increasing starts/shrinking ends.
 * Retain future entries for siblings; only expired ends may leave the window.
 */
export const createLintChunkResolver = entries => {
  const source = Array.isArray(entries) ? entries : [];
  const scoped = [], unscoped = [];
  const stats = { preparedEntries: source.length, sourceAdvances: 0, windowVisits: 0, fallbackQueries: 0, queries: 0 };
  for (let ordinal = 0; ordinal < source.length; ordinal++) {
    const entry = source[ordinal], start = Number(entry?.line);
    if (!Number.isFinite(start)) { unscoped.push({ entry, ordinal }); continue; }
    const end = Number.isFinite(Number(entry?.endLine)) ? Number(entry.endLine) : start;
    scoped.push({ entry, ordinal, start, end });
  }
  scoped.sort((a, b) => a.start - b.start || a.end - b.end || a.ordinal - b.ordinal);
  const active = [];
  let cursor = 0, lastStart = Number.NEGATIVE_INFINITY;
  const resolve = (startLine, endLine, includeUnscoped = false) => {
    stats.queries++;
    if (startLine < lastStart) {
      stats.fallbackQueries++;
      return source.filter(entry => {
        const start = Number(entry?.line);
        if (!Number.isFinite(start)) return includeUnscoped;
        const end = Number.isFinite(Number(entry?.endLine)) ? Number(entry.endLine) : start;
        return start <= endLine && end >= startLine;
      });
    }
    lastStart = startLine;
    while (cursor < scoped.length && scoped[cursor].start <= endLine) {
      active.push(scoped[cursor++]); stats.sourceAdvances++;
    }
    const selected = includeUnscoped ? unscoped.slice() : [];
    let write = 0;
    for (const item of active) {
      stats.windowVisits++;
      if (item.end < startLine) continue;
      active[write++] = item;
      if (item.start <= endLine) selected.push(item);
    }
    active.length = write;
    // The provider's diagnostic order, including file-level entries, is stable
    // even when the prepared source-order index differs from that order.
    selected.sort((a, b) => a.ordinal - b.ordinal);
    return selected.map(item => item.entry);
  };
  Object.defineProperty(resolve, 'stats', { get: () => Object.freeze({ ...stats, retainedEntries: active.length }) });
  return resolve;
};
