const preparedRows = new WeakMap();

// An invocation's encoded-line reuse allowance, not a whole-process heap bound.
const DEFAULT_CACHE_BYTES = 4 * 1024 * 1024;
const DEFAULT_CACHE_ROWS = 5000;

export const readPreparedJsonlRow = row => row !== null && typeof row === 'object'
  ? preparedRows.get(row) || null : null;

const freezeJson = value => {
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object') continue;
    for (const child of Object.values(current)) pending.push(child);
    Object.freeze(current);
  }
  return value;
};

/** Keep only bounded, privately produced immutable JSON rows. Exhausting reuse
 * allowance changes neither row admission nor ordinary encoding. Different
 * layouts must prepare their own rows; copied public fields are not receipts.
 */
export const createPreparedJsonlRows = ({
  maxCacheBytes = DEFAULT_CACHE_BYTES,
  maxCacheRows = DEFAULT_CACHE_ROWS
} = {}) => {
  if (!Number.isSafeInteger(maxCacheBytes) || maxCacheBytes < 0
    || !Number.isSafeInteger(maxCacheRows) || maxCacheRows < 0) {
    throw new TypeError('Prepared JSONL reuse requires nonnegative integer allowances.');
  }
  let retainedBytes = 0, retainedRows = 0;
  const prepare = (row, { maxLineBytes = null } = {}) => {
    const existing = readPreparedJsonlRow(row);
    if (existing) return Object.freeze({ row, lineBytes: existing.lineBytes, reused: true });
    const line = JSON.stringify(row);
    if (typeof line !== 'string') throw new TypeError('Prepared JSONL row has no JSON representation.');
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
    // Charge actual retained string code units, including the line terminator,
    // as well as encoded bytes. Object/parse overhead is separate qualification.
    const retentionBytes = Math.max(lineBytes, 2 * (line.length + 1));
    if ((maxLineBytes && lineBytes > maxLineBytes) || retainedRows >= maxCacheRows
      || retentionBytes > maxCacheBytes - retainedBytes) {
      return Object.freeze({ row, lineBytes, reused: false });
    }
    const owned = freezeJson(JSON.parse(line));
    if (owned === null || typeof owned !== 'object') {
      return Object.freeze({ row, lineBytes, reused: false });
    }
    preparedRows.set(owned, Object.freeze({ line, lineBytes }));
    retainedBytes += retentionBytes;
    retainedRows += 1;
    return Object.freeze({ row: owned, lineBytes, reused: true });
  };
  return Object.freeze({ prepare, get retainedBytes() { return retainedBytes; },
    get retainedRows() { return retainedRows; } });
};
