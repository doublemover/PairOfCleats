export const MIN_ESTIMATED_PARSE_COST = 1;

/**
 * Parse positive finite number, otherwise return fallback.
 *
 * @param {unknown} value
 * @param {number|null} [fallback]
 * @returns {number|null}
 */
export const normalizePositiveNumber = (value, fallback = null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

/**
 * Parse positive integer, otherwise return fallback.
 *
 * @param {unknown} value
 * @param {number|null} [fallback]
 * @returns {number|null}
 */
export const normalizePositiveInt = (value, fallback = null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
};

/**
 * Resolve per-job estimated parse cost, with span-derived fallback.
 *
 * @param {object} job
 * @returns {number}
 */
export const resolveJobEstimatedParseCost = (job) => {
  const estimated = normalizePositiveNumber(job?.estimatedParseCost);
  if (estimated) return estimated;
  const span = normalizePositiveNumber(
    Number(job?.segmentEnd) - Number(job?.segmentStart),
    MIN_ESTIMATED_PARSE_COST
  );
  return Math.max(MIN_ESTIMATED_PARSE_COST, Math.ceil(span / 64));
};

/**
 * Sum estimated parse cost for a job list.
 *
 * @param {Array<object>} jobs
 * @returns {number}
 */
export const sumJobEstimatedParseCost = (jobs) => {
  if (!Array.isArray(jobs) || !jobs.length) return 0;
  let total = 0;
  for (const job of jobs) {
    total += resolveJobEstimatedParseCost(job);
  }
  return total;
};

/**
 * Summarize parse-cost distribution for a grammar workload.
 *
 * @param {Array<object>} jobs
 * @returns {{
 *  jobCount:number,
 *  totalEstimatedCost:number,
 *  avgCost:number,
 *  minCost:number,
 *  maxCost:number,
 *  p95Cost:number,
 *  skewRatio:number
 * }}
 */
export const summarizeGrammarJobs = (jobs) => {
  const list = Array.isArray(jobs) ? jobs : [];
  const jobCount = list.length;
  if (!jobCount) {
    return {
      jobCount: 0,
      totalEstimatedCost: 0,
      avgCost: 0,
      minCost: 0,
      maxCost: 0,
      p95Cost: 0,
      skewRatio: 0
    };
  }

  const costs = new Array(jobCount);
  let validCostCount = 0;
  let totalEstimatedCost = 0;
  let minCost = Number.POSITIVE_INFINITY;
  let maxCost = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < jobCount; i += 1) {
    const cost = resolveJobEstimatedParseCost(list[i]);
    if (!Number.isFinite(cost) || cost <= 0) continue;
    costs[validCostCount] = cost;
    validCostCount += 1;
    totalEstimatedCost += cost;
    if (cost < minCost) minCost = cost;
    if (cost > maxCost) maxCost = cost;
  }

  if (!validCostCount) {
    return {
      jobCount,
      totalEstimatedCost: jobCount,
      avgCost: 1,
      minCost: 1,
      maxCost: 1,
      p95Cost: 1,
      skewRatio: 1
    };
  }

  const sortedCosts = validCostCount === costs.length ? costs : costs.slice(0, validCostCount);
  sortedCosts.sort((a, b) => a - b);

  const avgCost = totalEstimatedCost / Math.max(1, jobCount);
  const p95Cost = sortedCosts[Math.max(0, Math.floor((validCostCount - 1) * 0.95))];
  const skewRatio = maxCost / Math.max(1, avgCost);

  return {
    jobCount,
    totalEstimatedCost,
    avgCost,
    minCost,
    maxCost,
    p95Cost,
    skewRatio
  };
};

/**
 * Summarize load distribution metrics used for balancing diagnostics.
 *
 * @param {number[]} loads
 * @returns {{
 *  loads:number[],
 *  total:number,
 *  avg:number,
 *  min:number,
 *  minNonZero:number,
 *  max:number,
 *  spreadRatio:number,
 *  imbalanceRatio:number,
 *  stdDev:number
 * }}
 */
export const summarizeLoadDistribution = (loads) => {
  const list = Array.isArray(loads) ? loads : [];
  const normalized = new Array(list.length);
  if (!normalized.length) {
    return {
      loads: [],
      total: 0,
      avg: 0,
      min: 0,
      minNonZero: 0,
      max: 0,
      spreadRatio: 0,
      imbalanceRatio: 0,
      stdDev: 0
    };
  }

  let total = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let minNonZero = Number.POSITIVE_INFINITY;

  for (let i = 0; i < list.length; i += 1) {
    const value = Number(list[i]) || 0;
    normalized[i] = value;
    total += value;
    if (value < min) min = value;
    if (value > max) max = value;
    if (value > 0 && value < minNonZero) minNonZero = value;
  }

  const avg = total / normalized.length;
  let varianceSum = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    const delta = normalized[i] - avg;
    varianceSum += delta * delta;
  }
  const variance = varianceSum / normalized.length;
  const stdDev = Math.sqrt(Math.max(0, variance));

  const resolvedMinNonZero = Number.isFinite(minNonZero) ? minNonZero : 0;

  return {
    loads: normalized,
    total,
    avg,
    min,
    minNonZero: resolvedMinNonZero,
    max,
    spreadRatio: resolvedMinNonZero > 0 ? (max / resolvedMinNonZero) : (max > 0 ? max : 0),
    imbalanceRatio: avg > 0 ? (max / avg) : 0,
    stdDev
  };
};

/**
 * Summarize per-bucket job/cost metrics for adaptive balancing decisions.
 *
 * @param {Array<Array<object>>} buckets
 * @returns {{cost:object,jobs:object}}
 */
export const summarizeBucketMetrics = (buckets) => {
  const list = Array.isArray(buckets) ? buckets : [];
  const costLoads = new Array(list.length);
  const jobLoads = new Array(list.length);

  for (let bucketIndex = 0; bucketIndex < list.length; bucketIndex += 1) {
    const bucketJobs = Array.isArray(list[bucketIndex]) ? list[bucketIndex] : [];
    jobLoads[bucketIndex] = bucketJobs.length;
    costLoads[bucketIndex] = sumJobEstimatedParseCost(bucketJobs);
  }

  return {
    cost: summarizeLoadDistribution(costLoads),
    jobs: summarizeLoadDistribution(jobLoads)
  };
};
