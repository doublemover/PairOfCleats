import { compareStrings } from '../../../../shared/sort.js';
import {
  normalizePositiveInt,
  resolveJobEstimatedParseCost,
  summarizeBucketMetrics,
  summarizeGrammarJobs,
  sumJobEstimatedParseCost
} from './metrics.js';
import {
  ADAPTIVE_WAVE_MAX_JOBS,
  ADAPTIVE_WAVE_MIN_JOBS,
  HEAVY_GRAMMAR_BUCKET_MAX,
  HEAVY_GRAMMAR_BUCKET_MIN,
  applyBucketCountGuardrails,
  createObservedProfileReader,
  resolveAdaptiveBucketTargetCost,
  resolveAdaptiveBucketTargetJobs,
  resolveAdaptiveWaveTargetCost,
  resolveAdaptiveWaveTargetJobs,
  resolveObservedLaneState,
  resolveObservedTailDurationMs
} from './policy-normalization.js';
import { assignPathAwareBuckets, createPathAwareBucketContext, sortJobs } from './candidate-ranking.js';
import {
  isHighCardinalityTreeSitterGrammar,
  resolveTreeSitterLaneGuardrails
} from '../policy.js';

const MAX_BUCKET_REBALANCE_ITERATIONS = 4;

/**
 * Resolve observed profile reader from explicit reader or observed map.
 *
 * @param {Map<string, unknown>|null} observedRowsPerSecByGrammar
 * @param {ReturnType<typeof createObservedProfileReader>|null} observedProfileReader
 * @returns {ReturnType<typeof createObservedProfileReader>}
 */
const resolveObservedProfileReader = (observedRowsPerSecByGrammar, observedProfileReader) => (
  observedProfileReader || createObservedProfileReader(observedRowsPerSecByGrammar)
);

/**
 * Split a grammar group into one or more bucket shards based on observed load.
 *
 * @param {{
 *  group:object,
 *  schedulerConfig?:object,
 *  observedRowsPerSecByGrammar?:Map<string,unknown>|null,
 *  observedProfileReader?:ReturnType<typeof createObservedProfileReader>|null
 * }} input
 * @returns {Array<object>}
 */
export const shardGrammarGroup = ({
  group,
  schedulerConfig = {},
  observedRowsPerSecByGrammar = null,
  observedProfileReader = null
}) => {
  const jobs = Array.isArray(group?.jobs) ? group.jobs : [];
  if (!jobs.length) return [];
  const profileReader = resolveObservedProfileReader(observedRowsPerSecByGrammar, observedProfileReader);
  const guardrails = resolveTreeSitterLaneGuardrails(schedulerConfig);
  const jobStats = summarizeGrammarJobs(jobs);
  const observedTailDurationMs = resolveObservedTailDurationMs(
    group?.grammarKey,
    observedRowsPerSecByGrammar,
    profileReader
  ) || 0;
  const highCardinality = isHighCardinalityTreeSitterGrammar({
    schedulerConfig,
    jobCount: jobStats.jobCount,
    totalEstimatedCost: jobStats.totalEstimatedCost,
    skewRatio: jobStats.skewRatio,
    tailDurationMs: observedTailDurationMs
  });
  const rawEnabled = schedulerConfig.heavyGrammarBucketSharding ?? schedulerConfig.bucketSharding;
  if (rawEnabled === false) return [group];
  const targetJobs = resolveAdaptiveBucketTargetJobs({
    group,
    schedulerConfig,
    observedRowsPerSecByGrammar,
    observedProfileReader: profileReader
  });
  const targetCost = resolveAdaptiveBucketTargetCost({
    group,
    schedulerConfig,
    observedRowsPerSecByGrammar,
    observedProfileReader: profileReader
  });
  const minBucketsRaw = Number(schedulerConfig.heavyGrammarBucketMin);
  const minBuckets = Number.isFinite(minBucketsRaw)
    ? Math.max(1, Math.floor(minBucketsRaw))
    : HEAVY_GRAMMAR_BUCKET_MIN;
  const maxBucketsRaw = Number(schedulerConfig.heavyGrammarBucketMax);
  const maxBuckets = Number.isFinite(maxBucketsRaw)
    ? Math.max(minBuckets, Math.floor(maxBucketsRaw))
    : HEAVY_GRAMMAR_BUCKET_MAX;
  const minBucketsForLoad = highCardinality ? Math.max(2, minBuckets) : minBuckets;
  let desiredBucketCount = Math.max(
    minBucketsForLoad,
    Math.min(
      maxBuckets,
      Math.max(
        Math.ceil(jobStats.totalEstimatedCost / Math.max(1, targetCost)),
        Math.ceil(jobStats.jobCount / Math.max(1, targetJobs))
      )
    )
  );
  const hasSplitPressure = jobStats.skewRatio >= guardrails.highCardinalitySkewRatio
    || observedTailDurationMs >= guardrails.tailSplitMs;
  const hasMergePressure = jobStats.totalEstimatedCost
    <= (targetCost * guardrails.mergeHysteresisRatio);
  if (hasSplitPressure && desiredBucketCount < maxBuckets) {
    desiredBucketCount = Math.min(maxBuckets, desiredBucketCount + 1);
  }
  if (hasMergePressure && desiredBucketCount > minBucketsForLoad && !hasSplitPressure) {
    desiredBucketCount = Math.max(minBucketsForLoad, desiredBucketCount - 1);
  }
  const laneState = resolveObservedLaneState(
    group?.grammarKey,
    observedRowsPerSecByGrammar,
    profileReader
  );
  let bucketCount = applyBucketCountGuardrails({
    desiredBucketCount,
    minBuckets: minBucketsForLoad,
    maxBuckets,
    laneState,
    guardrails,
    hasSplitPressure,
    hasMergePressure
  });
  const priorBucketCount = normalizePositiveInt(laneState?.bucketCount, null);
  const guardrailMinBucketCount = priorBucketCount
    ? Math.max(minBucketsForLoad, priorBucketCount - guardrails.maxStepDown)
    : minBucketsForLoad;
  const guardrailMaxBucketCount = priorBucketCount
    ? Math.min(maxBuckets, priorBucketCount + guardrails.maxStepUp)
    : maxBuckets;
  bucketCount = Math.max(guardrailMinBucketCount, Math.min(guardrailMaxBucketCount, bucketCount));
  if (bucketCount <= 1 && !highCardinality) {
    return [{
      ...group,
      estimatedParseCost: jobStats.totalEstimatedCost,
      laneMetrics: {
        targetJobs,
        targetCost,
        highCardinality,
        bucketMetrics: summarizeBucketMetrics([jobs]),
        laneState
      }
    }];
  }

  const pathAwareContext = createPathAwareBucketContext(jobs);
  let buckets = assignPathAwareBuckets({ jobs, bucketCount, pathAwareContext });
  let bucketMetrics = summarizeBucketMetrics(buckets);
  let lastDirection = 0;
  for (let i = 0; i < MAX_BUCKET_REBALANCE_ITERATIONS; i += 1) {
    const overloaded = bucketMetrics.cost.max > (targetCost * guardrails.splitHysteresisRatio);
    const underloaded = bucketMetrics.cost.max < (targetCost * guardrails.mergeHysteresisRatio);
    const splitForImbalance = Number.isFinite(bucketMetrics.cost.spreadRatio)
      && bucketMetrics.cost.spreadRatio >= guardrails.splitImbalanceRatio;
    const mergeForBalance = Number.isFinite(bucketMetrics.cost.spreadRatio)
      && bucketMetrics.cost.spreadRatio <= guardrails.mergeImbalanceRatio;
    if (
      (hasSplitPressure || overloaded || splitForImbalance)
      && bucketCount < guardrailMaxBucketCount
      && lastDirection >= 0
    ) {
      bucketCount += 1;
      buckets = assignPathAwareBuckets({ jobs, bucketCount, pathAwareContext });
      bucketMetrics = summarizeBucketMetrics(buckets);
      lastDirection = 1;
      continue;
    }
    if (
      !hasSplitPressure
      && (hasMergePressure || (underloaded && mergeForBalance))
      && bucketCount > guardrailMinBucketCount
      && lastDirection <= 0
    ) {
      bucketCount -= 1;
      buckets = assignPathAwareBuckets({ jobs, bucketCount, pathAwareContext });
      bucketMetrics = summarizeBucketMetrics(buckets);
      lastDirection = -1;
      continue;
    }
    break;
  }
  const out = [];
  for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex += 1) {
    const bucketJobs = buckets[bucketIndex];
    if (!bucketJobs.length) continue;
    const bucketEstimatedCost = sumJobEstimatedParseCost(bucketJobs);
    const bucketKey = `${group.grammarKey}~b${String(bucketIndex + 1).padStart(2, '0')}of${String(bucketCount).padStart(2, '0')}`;
    out.push({
      grammarKey: bucketKey,
      baseGrammarKey: group.grammarKey,
      bucketKey,
      shard: {
        bucketIndex: bucketIndex + 1,
        bucketCount
      },
      languages: Array.isArray(group?.languages) ? group.languages : [],
      jobs: bucketJobs,
      estimatedParseCost: bucketEstimatedCost,
      laneMetrics: {
        targetJobs,
        targetCost,
        highCardinality,
        bucketMetrics,
        laneState
      }
    });
  }
  return out.length ? out : [group];
};

/**
 * Split bucketed grammar jobs into multiple execution waves.
 *
 * @param {{
 *  group:object,
 *  schedulerConfig?:object,
 *  observedRowsPerSecByGrammar?:Map<string,unknown>|null,
 *  observedProfileReader?:ReturnType<typeof createObservedProfileReader>|null
 * }} input
 * @returns {Array<object>}
 */
export const splitGrammarBucketIntoWaves = ({
  group,
  schedulerConfig = {},
  observedRowsPerSecByGrammar = null,
  observedProfileReader = null
}) => {
  const jobs = Array.isArray(group?.jobs) ? group.jobs : [];
  if (!jobs.length) return [];
  const profileReader = resolveObservedProfileReader(observedRowsPerSecByGrammar, observedProfileReader);
  const totalEstimatedCost = sumJobEstimatedParseCost(jobs);
  const targetJobs = resolveAdaptiveWaveTargetJobs({
    group,
    schedulerConfig,
    observedRowsPerSecByGrammar,
    observedProfileReader: profileReader
  });
  const targetCost = resolveAdaptiveWaveTargetCost({
    group,
    schedulerConfig,
    observedRowsPerSecByGrammar,
    observedProfileReader: profileReader
  });
  const minWaveJobs = Math.max(1, Math.min(ADAPTIVE_WAVE_MIN_JOBS, targetJobs));
  const maxWaveJobs = Math.max(minWaveJobs, Math.min(ADAPTIVE_WAVE_MAX_JOBS, targetJobs * 2));
  if (jobs.length <= minWaveJobs || totalEstimatedCost <= targetCost) {
    return [{
      ...group,
      bucketKey: group?.bucketKey || group?.grammarKey || null,
      wave: { waveIndex: 1, waveCount: 1 },
      estimatedParseCost: totalEstimatedCost
    }];
  }
  const waves = [];
  let currentWaveJobs = [];
  let currentWaveCost = 0;
  for (const job of jobs) {
    const jobCost = resolveJobEstimatedParseCost(job);
    const wouldExceedCost = (currentWaveCost + jobCost) > targetCost;
    const hasReachedMinJobs = currentWaveJobs.length >= minWaveJobs;
    const hasReachedMaxJobs = currentWaveJobs.length >= maxWaveJobs;
    if (currentWaveJobs.length && (hasReachedMaxJobs || (wouldExceedCost && hasReachedMinJobs))) {
      waves.push({ jobs: currentWaveJobs, estimatedParseCost: currentWaveCost });
      currentWaveJobs = [];
      currentWaveCost = 0;
    }
    currentWaveJobs.push(job);
    currentWaveCost += jobCost;
  }
  if (currentWaveJobs.length) {
    waves.push({ jobs: currentWaveJobs, estimatedParseCost: currentWaveCost });
  }
  const waveCount = Math.max(1, waves.length);
  const baseKey = group?.grammarKey || 'unknown';
  const bucketKey = group?.bucketKey || baseKey;
  const out = [];
  for (let waveIndex = 0; waveIndex < waves.length; waveIndex += 1) {
    const waveJobs = waves[waveIndex]?.jobs || [];
    if (!waveJobs.length) continue;
    out.push({
      ...group,
      grammarKey: `${baseKey}~w${String(waveIndex + 1).padStart(2, '0')}of${String(waveCount).padStart(2, '0')}`,
      bucketKey,
      wave: { waveIndex: waveIndex + 1, waveCount },
      jobs: waveJobs,
      estimatedParseCost: waves[waveIndex].estimatedParseCost
    });
  }
  return out.length ? out : [group];
};

/**
 * Build deterministic shard/wave group list from grouped jobs.
 *
 * @param {{
 *  groupsByGrammarKey:Map<string,{grammarKey:string,languages:Set<string>|Array<string>,jobs:Array<object>}>,
 *  schedulerConfig?:object,
 *  observedRowsPerSecByGrammar?:Map<string,unknown>|null
 * }} input
 * @returns {Array<object>}
 */
export const assembleGrammarGroups = ({
  groupsByGrammarKey,
  schedulerConfig = {},
  observedRowsPerSecByGrammar = null
}) => {
  const groups = groupsByGrammarKey instanceof Map ? groupsByGrammarKey : new Map();
  const observedProfileReader = createObservedProfileReader(observedRowsPerSecByGrammar);
  const grammarKeys = Array.from(groups.keys()).sort(compareStrings);
  const groupList = [];

  for (const grammarKey of grammarKeys) {
    const group = groups.get(grammarKey);
    if (!group) continue;
    if (group.jobs.length > 1) group.jobs.sort(sortJobs);
    const languages = Array.isArray(group.languages)
      ? group.languages.slice().sort(compareStrings)
      : Array.from(group.languages || []).sort(compareStrings);
    const baseGroup = {
      grammarKey,
      languages,
      jobs: group.jobs
    };
    const sharded = shardGrammarGroup({
      group: baseGroup,
      schedulerConfig,
      observedRowsPerSecByGrammar,
      observedProfileReader
    });
    for (const bucketGroup of sharded) {
      const waves = splitGrammarBucketIntoWaves({
        group: bucketGroup,
        schedulerConfig,
        observedRowsPerSecByGrammar,
        observedProfileReader
      });
      for (const wave of waves) {
        groupList.push(wave);
      }
    }
  }

  return groupList;
};
