const toTimestamp = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

/**
 * Sort entries by descending timestamp.
 * @param {Array<any>} entries
 * @param {(entry:any)=>number} [selectTimestamp]
 * @returns {Array<any>}
 */
export const sortEntriesByNewest = (entries, selectTimestamp = (entry) => entry?.ts) => {
  const list = Array.isArray(entries) ? entries.slice() : [];
  list.sort((left, right) => toTimestamp(selectTimestamp(right)) - toTimestamp(selectTimestamp(left)));
  return list;
};

/**
 * Sort entries by descending timestamp and cap to a max size when requested.
 * Non-positive or non-finite caps are treated as "no cap".
 * @param {Array<any>} entries
 * @param {{maxEntries?:number|null,selectTimestamp?:(entry:any)=>number}} [options]
 * @returns {Array<any>}
 */
export const sortAndTrimEntriesByNewest = (
  entries,
  { maxEntries = null, selectTimestamp = (entry) => entry?.ts } = {}
) => {
  const sorted = sortEntriesByNewest(entries, selectTimestamp);
  if (!Number.isFinite(maxEntries) || maxEntries <= 0) return sorted;
  const limit = Math.floor(maxEntries);
  return sorted.length > limit ? sorted.slice(0, limit) : sorted;
};
