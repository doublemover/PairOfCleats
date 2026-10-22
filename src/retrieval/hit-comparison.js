/**
 * Build a stable comparison key for a retrieval/search hit.
 * @param {object} hit
 * @param {number} index
 * @returns {string}
 */
export function buildRetrievalHitKey(hit, index, options = {}) {
  const scope = [hit?.repoId ?? hit?.repoRoot ?? options.repoScope ?? null, hit?.mode ?? options.mode ?? null];
  const chunkUid = hit?.chunkUid ?? hit?.metaV2?.chunkUid;
  if (chunkUid) return JSON.stringify(['chunk', scope, chunkUid]);
  if (hit && hit.file) {
    const start = hit.start ?? hit.startLine ?? null;
    const end = hit.end ?? hit.endLine ?? null;
    return JSON.stringify(['file-range', scope, hit.file, start, end, hit.kind || '', hit.name || '']);
  }
  if (options.idNamespace && hit?.id != null) return JSON.stringify(['ordinal', scope, options.idNamespace, hit.id]);
  return null;
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
 * rankCorr measures relative order among distinct shared hits. Membership loss
 * remains separate in overlap/missing fields; fewer than two shared hits is null.
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
  let unknownBase = 0, unknownOther = 0;
  const distinct = (hits, side) => {
    const rows = new Map();
    hits.slice(0, topN).forEach((hit, index) => {
      const key = buildRetrievalHitKey(hit, index, options)
        ?? (side === 'base' ? `unknown:base:${unknownBase++}` : `unknown:other:${unknownOther++}`);
      if (!rows.has(key)) rows.set(key, hit);
    });
    return rows;
  };
  const baseRows = distinct(baseHits, 'base'), otherRows = distinct(otherHits, 'other');
  const baseKeys = [...baseRows.keys()], otherKeys = [...otherRows.keys()];
  const baseSet = new Set(baseKeys);
  const otherSet = new Set(otherKeys);
  const intersection = [...new Set(baseKeys.filter((key) => otherSet.has(key)))];
  const overlap = intersection.length / Math.max(1, Math.min(baseKeys.length, otherKeys.length));

  const baseScores = new Map([...baseRows].map(([key, hit]) => [key, resolveRetrievalHitScore(hit)]));
  const otherScores = new Map([...otherRows].map(([key, hit]) => [key, resolveRetrievalHitScore(hit)]));
  const deltas = intersection.map((key) => Math.abs((baseScores.get(key) || 0) - (otherScores.get(key) || 0)));
  const avgDelta = deltas.length ? deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length : 0;

  let rankCorr = null;
  const shared = new Set(intersection);
  const commonBase = Array.from(shared);
  const commonOther = Array.from(new Set(otherKeys.filter(key => shared.has(key))));
  if (commonBase.length >= 2) {
    const baseRanks = new Map(commonBase.map((key, idx) => [key, idx + 1]));
    const otherRanks = new Map(commonOther.map((key, idx) => [key, idx + 1]));
    let sum = 0;
    for (const key of commonBase) {
      const d = baseRanks.get(key) - otherRanks.get(key);
      sum += d * d;
    }
    const n = commonBase.length;
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
    comparable: !unknownBase && !unknownOther,
    identityPolicy: options.idNamespace ? 'verified-ordinal-namespace' : 'repository-mode-stable-chunk-or-file-range',
    duplicatePolicy: 'first-distinct-hit-within-top-window',
    unknownIdentityCounts: { base: unknownBase, other: unknownOther },
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
  const comparison = compareRetrievalHitLists(baseHits, otherHits, options);
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
