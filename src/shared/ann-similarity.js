const normalizeMetric = (metric) => (
  typeof metric === 'string' ? metric.trim().toLowerCase() : ''
);

/** Metadata stays out of legacy serialized hit shapes; fusion copies the
 * contract into its explicit explanation fields. */
export const withAnnScoreSpace = (hit, { metric = null, kind = 'negative-distance', backend = null, distance = null } = {}) => {
  Object.defineProperties(hit, {
    scoreSpace: { value: { kind, metric, backend }, enumerable: false },
    rawDistance: { value: distance, enumerable: false }
  });
  return hit;
};

/** Bounded monotone calibration. Unbounded dot/IP outputs retain their raw
 * ordering through atan; L2 uses reciprocal distance, never cosine clipping. */
export const calibrateAnnScore = (score, scoreSpace = null) => {
  if (!Number.isFinite(score)) return null;
  if (scoreSpace?.kind === 'jaccard') return Math.max(0, Math.min(1, score));
  if (scoreSpace?.kind === 'cosine') return (Math.max(-1, Math.min(1, score)) + 1) / 2;
  if (scoreSpace?.kind === 'negative-distance' && scoreSpace.metric === 'l2') return 1 / (1 + Math.max(0, -score));
  return 0.5 + Math.atan(score) / Math.PI;
};

/**
 * Convert backend distance values into comparable similarity scores.
 * Higher values are always better.
 * @param {number} distance
 * @param {string} metric
 * @returns {number|null}
 */
export const distanceToSimilarity = (distance, metric) => {
  const numeric = Number(distance);
  if (!Number.isFinite(numeric)) return null;
  const normalizedMetric = normalizeMetric(metric);
  if (normalizedMetric === 'cosine') {
    return 1 - numeric;
  }
  // L2/IP (and unknown metrics) are treated as distance-oriented outputs:
  // lower distance is better, so similarity is the negated distance.
  return -numeric;
};
