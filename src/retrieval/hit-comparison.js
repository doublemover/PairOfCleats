import { observeRetrievalHitScore, retrievalScoreSpaceKey } from './score-observation.js';

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

/** Resolve only the measured final score. Components are different stages. */
export function resolveRetrievalHitScore(hit) {
  return observeRetrievalHitScore(hit).value;
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
 *   avgDelta: (number|null),
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

  const scoreDelta = { aggregationUnit: 'shared-distinct-hit-pair', requestedPairs: intersection.length,
    comparedPairs: 0, missingValuePairs: 0, unknownSpacePairs: 0, incompatibleSpacePairs: 0,
    nonFiniteDeltaPairs: 0, complete: false, domainPairs: [], omittedDomainPairObservations: 0 };
  const domains = new Map();
  let avgDelta = null;
  for (const key of intersection) {
    const base = observeRetrievalHitScore(baseRows.get(key)), other = observeRetrievalHitScore(otherRows.get(key));
    if (base.value === null || other.value === null) { scoreDelta.missingValuePairs++; continue; }
    const baseSpace = retrievalScoreSpaceKey(base.space), otherSpace = retrievalScoreSpaceKey(other.space);
    if (!base.qualified || !other.qualified) { scoreDelta.unknownSpacePairs++; continue; }
    const pairKey = JSON.stringify([baseSpace, otherSpace]);
    if (domains.has(pairKey)) domains.get(pairKey).pairs++;
    else if (domains.size < 16) domains.set(pairKey, { base: base.space, other: other.space, pairs: 1 });
    else scoreDelta.omittedDomainPairObservations++;
    if (baseSpace !== otherSpace) { scoreDelta.incompatibleSpacePairs++; continue; }
    const delta = Math.abs(base.value - other.value);
    if (!Number.isFinite(delta)) { scoreDelta.nonFiniteDeltaPairs++; continue; }
    scoreDelta.comparedPairs++;
    avgDelta = avgDelta === null ? delta : avgDelta + (delta - avgDelta) / scoreDelta.comparedPairs;
  }
  scoreDelta.complete = intersection.length > 0 && scoreDelta.comparedPairs === intersection.length;
  scoreDelta.domainPairs = [...domains.values()];

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
    scoreDelta,
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
