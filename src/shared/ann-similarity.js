const normalizeMetric = (metric) => (
  typeof metric === 'string' ? metric.trim().toLowerCase() : ''
);

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
