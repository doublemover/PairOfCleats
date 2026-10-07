/**
 * Build a stable comparison key for a retrieval/search hit.
 * @param {object} hit
 * @param {number} index
 * @returns {string}
 */
export function buildRetrievalHitKey(hit, index) {
  if (hit && (hit.id || hit.id === 0)) return String(hit.id);
  if (hit && hit.file) {
    const start = hit.startLine ?? hit.start ?? 0;
    const end = hit.endLine ?? hit.end ?? 0;
    return `${hit.file}:${start}:${end}:${hit.kind || ''}:${hit.name || ''}`;
  }
  return String(index);
}

/**
 * Resolve the score field used for retrieval/search hit parity comparisons.
 * @param {object} hit
 * @returns {number}
 */
export function resolveRetrievalHitScore(hit) {
  if (!hit || typeof hit !== 'object') return 0;
  if (Number.isFinite(hit.score)) return hit.score;
  const selected = hit.scoreBreakdown?.selected?.score;
  if (Number.isFinite(selected)) return selected;
  if (Number.isFinite(hit.sparseScore)) return hit.sparseScore;
  if (Number.isFinite(hit.annScore)) return hit.annScore;
  return 0;
}

/**
 * Compare top-N retrieval/search hit lists and compute shared parity metrics.
 * @param {Array<object>} baseHits
 * @param {Array<object>} otherHits
 * @param {{topN?: number}} [options]
 * @returns {{
 *   baseKeys: Array<string>,
 *   otherKeys: Array<string>,
 *   intersection: Array<string>,
 *   overlap: number,
 *   avgDelta: number,
 *   rankCorr: (number|null),
 *   top1Same: boolean,
 *   missingFromOther: Array<string>,
 *   missingFromBase: Array<string>
 * }}
 */
export function compareRetrievalHitLists(baseHits, otherHits, options = {}) {
  const topN = Math.max(0, Number.isFinite(options.topN) ? Math.trunc(options.topN) : 10);
  const base = baseHits.slice(0, topN);
  const other = otherHits.slice(0, topN);
  const baseKeys = base.map(buildRetrievalHitKey);
  const otherKeys = other.map(buildRetrievalHitKey);
  const baseRanks = new Map(baseKeys.map((key, idx) => [key, idx + 1]));
  const otherRanks = new Map(otherKeys.map((key, idx) => [key, idx + 1]));
  const baseSet = new Set(baseKeys);
  const otherSet = new Set(otherKeys);
  const intersection = baseKeys.filter((key) => otherSet.has(key));
  const overlap = intersection.length / Math.max(1, Math.min(baseKeys.length, otherKeys.length));

  const baseScores = new Map(base.map((hit, idx) => [buildRetrievalHitKey(hit, idx), resolveRetrievalHitScore(hit)]));
  const otherScores = new Map(other.map((hit, idx) => [buildRetrievalHitKey(hit, idx), resolveRetrievalHitScore(hit)]));
  const deltas = intersection.map((key) => Math.abs((baseScores.get(key) || 0) - (otherScores.get(key) || 0)));
  const avgDelta = deltas.length ? deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length : 0;

  let rankCorr = null;
  if (intersection.length >= 2) {
    let sum = 0;
    for (const key of intersection) {
      const d = (baseRanks.get(key) || 0) - (otherRanks.get(key) || 0);
      sum += d * d;
    }
    const n = intersection.length;
    rankCorr = 1 - (6 * sum) / (n * (n * n - 1));
  }

  return {
    baseKeys,
    otherKeys,
    intersection,
    overlap,
    avgDelta,
    rankCorr,
    top1Same: baseKeys[0] && otherKeys[0] ? baseKeys[0] === otherKeys[0] : false,
    missingFromOther: baseKeys.filter((key) => !otherSet.has(key)),
    missingFromBase: otherKeys.filter((key) => !baseSet.has(key))
  };
}

/**
 * Summarize a retrieval/search hit-list comparison for report consumers.
 * @param {Array<object>} baseHits
 * @param {Array<object>} otherHits
 * @param {{topN?: number, missingLimit?: number, treatBothEmptyAsPerfect?: boolean}} [options]
 * @returns {ReturnType<typeof compareRetrievalHitLists> & {zeroHits: boolean}}
 */
export function summarizeRetrievalHitComparison(baseHits, otherHits, options = {}) {
  const comparison = compareRetrievalHitLists(baseHits, otherHits, { topN: options.topN });
  const missingLimit = Number.isFinite(options.missingLimit)
    ? Math.max(0, Math.trunc(options.missingLimit))
    : null;
  const zeroHits = comparison.baseKeys.length === 0 && comparison.otherKeys.length === 0;

  return {
    ...comparison,
    overlap: zeroHits && options.treatBothEmptyAsPerfect ? 1 : comparison.overlap,
    missingFromOther: missingLimit === null
      ? comparison.missingFromOther
      : comparison.missingFromOther.slice(0, missingLimit),
    missingFromBase: missingLimit === null
      ? comparison.missingFromBase
      : comparison.missingFromBase.slice(0, missingLimit),
    zeroHits
  };
}
