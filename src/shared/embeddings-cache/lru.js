/**
 * Convert ISO timestamp to millis.
 * @param {string|number|null} value
 * @returns {number}
 */
const toMillis = (value) => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Normalize byte values.
 * @param {number|string|null} value
 * @returns {number}
 */
const toBytes = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

/**
 * Plan which cache entries to remove based on age and size caps.
 * @param {{entries:Record<string, any>, maxBytes?:number, maxAgeMs?:number, now?:number}} input
 * @returns {{removeKeys:string[], totalBytes:number, remainingBytes:number}}
 */
export const planEmbeddingsCachePrune = ({ entries, maxBytes = 0, maxAgeMs = 0, now = Date.now() } = {}) => {
  const list = Object.values(entries || {})
    .map((entry) => ({
      key: entry?.key,
      sizeBytes: toBytes(entry?.sizeBytes),
      lastAccessMs: toMillis(entry?.lastAccessAt) || toMillis(entry?.createdAt) || 0
    }))
    .filter((entry) => entry.key);

  const totalBytes = list.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  const remove = new Set();

  if (maxAgeMs > 0) {
    for (const entry of list) {
      if (entry.lastAccessMs && now - entry.lastAccessMs > maxAgeMs) {
        remove.add(entry.key);
      }
    }
  }

  let remainingBytes = list.reduce((sum, entry) => (
    remove.has(entry.key) ? sum : sum + entry.sizeBytes
  ), 0);

  if (maxBytes > 0 && remainingBytes > maxBytes) {
    const candidates = list
      .filter((entry) => !remove.has(entry.key))
      .sort((a, b) => a.lastAccessMs - b.lastAccessMs);
    for (const entry of candidates) {
      if (remainingBytes <= maxBytes) break;
      remove.add(entry.key);
      remainingBytes -= entry.sizeBytes;
    }
  }

  return { removeKeys: Array.from(remove), totalBytes, remainingBytes };
};
