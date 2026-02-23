import path from 'node:path';
import { toPosix } from '../../../../shared/files.js';
import { compareStrings } from '../../../../shared/sort.js';
import { resolveJobEstimatedParseCost } from './metrics.js';

/**
 * Stable sort for scheduler jobs to keep planner output deterministic.
 *
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
export const sortJobs = (a, b) => {
  const langDelta = compareStrings(a.languageId || '', b.languageId || '');
  if (langDelta !== 0) return langDelta;
  const pathDelta = compareStrings(a.containerPath || '', b.containerPath || '');
  if (pathDelta !== 0) return pathDelta;
  const startDelta = (a.segmentStart || 0) - (b.segmentStart || 0);
  if (startDelta !== 0) return startDelta;
  const endDelta = (a.segmentEnd || 0) - (b.segmentEnd || 0);
  if (endDelta !== 0) return endDelta;
  return compareStrings(a.virtualPath || '', b.virtualPath || '');
};

/**
 * Compute deterministic 32-bit hash used for low-cost bucket assignment.
 *
 * @param {unknown} value
 * @returns {number}
 */
const hashString = (value) => {
  const text = String(value || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

/**
 * Precompute deterministic grouping metadata for path-aware bucket assignment.
 *
 * Rebalance loops call bucket assignment multiple times with identical jobs.
 * This cache avoids repeated per-job cost lookups, hash calculations, and
 * directory-level sorting while preserving exact ordering semantics.
 *
 * @param {Array<object>} jobs
 * @returns {{
 *  sourceJobs:Array<object>,
 *  jobCount:number,
 *  totalEstimatedCost:number,
 *  groups:Array<{dirKey:string,dirJobs:Array<object>,rankedJobs:Array<object>,dirEstimatedCost:number}>,
 *  jobCostByJob:Map<object,number>,
 *  jobHashByJob:Map<object,number>
 * }}
 */
export const createPathAwareBucketContext = (jobs) => {
  const sourceJobs = Array.isArray(jobs) ? jobs : [];
  const jobsByDir = new Map();
  const jobCostByJob = new Map();
  const jobHashByJob = new Map();
  let totalEstimatedCost = 0;

  for (const job of sourceJobs) {
    const key = String(job?.containerPath || job?.virtualPath || '');
    const dirKey = toPosix(path.dirname(key)).toLowerCase() || '.';
    const jobCost = resolveJobEstimatedParseCost(job);
    totalEstimatedCost += jobCost;
    jobCostByJob.set(job, jobCost);
    jobHashByJob.set(job, hashString(key));
    if (!jobsByDir.has(dirKey)) {
      jobsByDir.set(dirKey, {
        dirKey,
        dirJobs: [],
        rankedJobs: [],
        dirEstimatedCost: 0
      });
    }
    const group = jobsByDir.get(dirKey);
    group.dirJobs.push(job);
    group.dirEstimatedCost += jobCost;
  }

  const groups = Array.from(jobsByDir.values());
  for (const group of groups) {
    if (group.dirJobs.length > 1) {
      group.dirJobs.sort(sortJobs);
      const rankedJobs = group.dirJobs.slice();
      rankedJobs.sort((a, b) => {
        const costDelta = (jobCostByJob.get(b) || 0) - (jobCostByJob.get(a) || 0);
        if (costDelta !== 0) return costDelta;
        return sortJobs(a, b);
      });
      group.rankedJobs = rankedJobs;
    } else {
      group.rankedJobs = group.dirJobs;
    }
  }
  groups.sort((a, b) => {
    const costDelta = b.dirEstimatedCost - a.dirEstimatedCost;
    if (costDelta !== 0) return costDelta;
    const sizeDelta = b.dirJobs.length - a.dirJobs.length;
    if (sizeDelta !== 0) return sizeDelta;
    return compareStrings(a.dirKey, b.dirKey);
  });

  return {
    sourceJobs,
    jobCount: sourceJobs.length,
    totalEstimatedCost,
    groups,
    jobCostByJob,
    jobHashByJob
  };
};

/**
 * Assign jobs to buckets by directory affinity while actively splitting very
 * large directories so one subtree cannot monopolize the tail wave.
 *
 * @param {{
 *  jobs:Array<object>,
 *  bucketCount:number,
 *  pathAwareContext?:ReturnType<typeof createPathAwareBucketContext>|null
 * }} input
 * @returns {Array<Array<object>>}
 */
export const assignPathAwareBuckets = ({ jobs, bucketCount, pathAwareContext = null }) => {
  const sourceJobs = Array.isArray(jobs) ? jobs : [];
  const safeBucketCount = Math.max(1, Math.floor(Number(bucketCount) || 1));
  if (safeBucketCount <= 1 || sourceJobs.length <= 1) {
    return [sourceJobs.slice()];
  }

  const context = pathAwareContext
    && pathAwareContext.sourceJobs === sourceJobs
    && pathAwareContext.jobCount === sourceJobs.length
    ? pathAwareContext
    : createPathAwareBucketContext(sourceJobs);

  const buckets = Array.from({ length: safeBucketCount }, () => []);
  const bucketCostLoads = new Array(safeBucketCount).fill(0);
  const bucketJobLoads = new Array(safeBucketCount).fill(0);

  const averageJobCost = context.totalEstimatedCost / Math.max(1, sourceJobs.length);
  const idealBucketCost = Math.max(1, context.totalEstimatedCost / safeBucketCount);
  const bigDirThreshold = Math.max(idealBucketCost * 1.15, averageJobCost * 3);

  const findLeastLoadedBucket = () => {
    let bestIndex = 0;
    let bestLoad = bucketCostLoads[0];
    for (let i = 1; i < bucketCostLoads.length; i += 1) {
      const load = bucketCostLoads[i];
      if (load < bestLoad || (load === bestLoad && bucketJobLoads[i] < bucketJobLoads[bestIndex])) {
        bestLoad = load;
        bestIndex = i;
      }
    }
    return bestIndex;
  };

  for (const group of context.groups) {
    const dirJobs = group.dirJobs;
    if (!dirJobs.length) continue;
    if (group.dirEstimatedCost >= bigDirThreshold && dirJobs.length > 1) {
      for (const job of group.rankedJobs) {
        const jobCost = context.jobCostByJob.get(job) || resolveJobEstimatedParseCost(job);
        const hashedIndex = (context.jobHashByJob.get(job) || 0) % safeBucketCount;
        const leastLoadedIndex = findLeastLoadedBucket();
        const chooseHashed = (bucketCostLoads[hashedIndex] + jobCost)
          <= ((bucketCostLoads[leastLoadedIndex] + jobCost) * 1.08);
        const chosenIndex = chooseHashed ? hashedIndex : leastLoadedIndex;
        buckets[chosenIndex].push(job);
        bucketCostLoads[chosenIndex] += jobCost;
        bucketJobLoads[chosenIndex] += 1;
      }
      continue;
    }

    const bucketIndex = findLeastLoadedBucket();
    buckets[bucketIndex].push(...dirJobs);
    bucketCostLoads[bucketIndex] += group.dirEstimatedCost;
    bucketJobLoads[bucketIndex] += dirJobs.length;
  }

  for (const bucketJobs of buckets) {
    if (bucketJobs.length > 1) bucketJobs.sort(sortJobs);
  }
  return buckets;
};
