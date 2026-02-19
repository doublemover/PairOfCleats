/**
 * Stable lexical comparator used for deterministic vocab and artifact ordering.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export const sortStrings = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));
export const DEFAULT_COOPERATIVE_YIELD_EVERY = 1024;
export const DEFAULT_COOPERATIVE_YIELD_MIN_INTERVAL_MS = 250;
// Phrase postings can hit very high cardinality on large repos; spill-by-count
// keeps stage2 from spending hours materializing giant in-memory arrays.
export const DEFAULT_PHRASE_SPILL_MAX_UNIQUE = 250000;

/**
 * Parse and clamp an integer config value.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} [minimum=1]
 * @returns {number}
 */
export const resolvePositiveInt = (value, fallback, minimum = 1) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(minimum, Math.floor(num));
};

/**
 * Create a cooperative scheduler hook used in hot loops to periodically yield
 * back to the event loop and keep long indexing stages responsive.
 *
 * @param {{ every?: number, minIntervalMs?: number }} [options]
 * @returns {() => Promise<void> | null}
 */
export const createCooperativeYield = ({
  every = DEFAULT_COOPERATIVE_YIELD_EVERY,
  minIntervalMs = DEFAULT_COOPERATIVE_YIELD_MIN_INTERVAL_MS
} = {}) => {
  let checks = 0;
  let lastYieldAt = Date.now();
  return () => {
    checks += 1;
    if (checks < every) return null;
    checks = 0;
    const now = Date.now();
    if ((now - lastYieldAt) < minIntervalMs) return null;
    lastYieldAt = now;
    return new Promise((resolve) => setImmediate(resolve));
  };
};

/**
 * Yield cooperatively when requested by the stage scheduler.
 *
 * @param {(() => Promise<void> | null)|null|undefined} requestYield
 * @returns {Promise<void>}
 */
export const maybeYield = async (requestYield) => {
  const waitForYield = requestYield?.();
  if (waitForYield) await waitForYield;
};

/**
 * Resolve token length for a chunk, preferring precomputed `tokenCount`.
 *
 * @param {object} chunk
 * @returns {number}
 */
export const resolveTokenCount = (chunk) => (
  Number.isFinite(chunk?.tokenCount)
    ? chunk.tokenCount
    : (Array.isArray(chunk?.tokens) ? chunk.tokens.length : 0)
);

/**
 * Tune BM25 defaults against average chunk length.
 *
 * @param {object[]} chunks
 * @returns {{ k1: number, b: number }}
 */
export const tuneBM25Params = (chunks) => {
  const avgLen = chunks.reduce((s, c) => s + resolveTokenCount(c), 0) / chunks.length;
  const b = avgLen > 800 ? 0.6 : 0.8;
  const k1 = avgLen > 800 ? 1.2 : 1.7;
  return { k1, b };
};
