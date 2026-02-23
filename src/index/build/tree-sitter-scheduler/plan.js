import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { throwIfAborted } from '../../../shared/abort.js';
import { toPosix } from '../../../shared/files.js';
import { compareStrings } from '../../../shared/sort.js';
import { runWithConcurrency } from '../../../shared/concurrency.js';
import {
  exceedsTreeSitterLimits as exceedsSharedTreeSitterLimits,
  resolveTreeSitterLimits
} from '../../../shared/indexing/tree-sitter-limits.js';
import { writeJsonObjectFile, writeJsonLinesFile } from '../../../shared/json-stream.js';
import { readTextFileWithHash } from '../../../shared/encoding.js';
import { getLanguageForFile } from '../../language-registry.js';
import { assignSegmentUids, discoverSegments } from '../../segments.js';
import {
  resolveSegmentExt,
  resolveSegmentTokenMode,
  shouldIndexSegment
} from '../../segments/config.js';
import { isMinifiedName } from '../file-scan.js';
import { buildVfsVirtualPath } from '../../tooling/vfs.js';
import { TREE_SITTER_LANGUAGE_IDS } from '../../../lang/tree-sitter.js';
import {
  preflightNativeTreeSitterGrammars,
  resolveNativeTreeSitterTarget
} from '../../../lang/tree-sitter/native-runtime.js';
import { isTreeSitterEnabled } from '../../../lang/tree-sitter/options.js';
import {
  isTreeSitterSchedulerLanguage,
  resolveTreeSitterLanguageForSegment
} from '../file-processor/tree-sitter.js';
import { resolveTreeSitterSchedulerPaths } from './paths.js';
import { createTreeSitterFileVersionSignature } from './file-signature.js';
import {
  isHighCardinalityTreeSitterGrammar,
  resolveTreeSitterLaneGuardrails,
  shouldSkipTreeSitterPlanningForPath
} from './policy.js';
import { loadTreeSitterSchedulerAdaptiveProfile } from './adaptive-profile.js';
import {
  MIN_ESTIMATED_PARSE_COST,
  normalizePositiveInt,
  normalizePositiveNumber,
  resolveJobEstimatedParseCost,
  summarizeBucketMetrics,
  summarizeGrammarJobs,
  sumJobEstimatedParseCost
} from './plan/metrics.js';
import {
  buildContinuousWaveExecutionOrder,
  buildLaneDiagnostics,
  buildPlanGroupArtifacts
} from './plan/execution.js';

const TREE_SITTER_LANG_IDS = new Set(TREE_SITTER_LANGUAGE_IDS);
const PLANNER_IO_CONCURRENCY_CAP = 32;
const PLANNER_IO_LARGE_REPO_THRESHOLD = 20000;
const TREE_SITTER_SKIP_SAMPLE_LIMIT_DEFAULT = 3;
const HEAVY_GRAMMAR_BUCKET_TARGET_JOBS = 768;
const HEAVY_GRAMMAR_BUCKET_MIN = 1;
const HEAVY_GRAMMAR_BUCKET_MAX = 16;
const ADAPTIVE_BUCKET_MIN_JOBS = 64;
const ADAPTIVE_BUCKET_MAX_JOBS = 4096;
const ADAPTIVE_BUCKET_TARGET_MS = 1200;
const ADAPTIVE_WAVE_TARGET_MS = 900;
const ADAPTIVE_WAVE_MIN_JOBS = 32;
const ADAPTIVE_WAVE_MAX_JOBS = 2048;
const ESTIMATED_COST_BASELINE_PER_JOB = 40;
const MAX_BUCKET_REBALANCE_ITERATIONS = 4;

/**
 * Determine whether a segment exceeds planner-side tree-sitter limits.
 *
 * @param {{
 *  text:string,
 *  languageId:string,
 *  treeSitterConfig?:object|null,
 *  recordSkip?:(reason:string,buildMessage:()=>string)=>void
 * }} input
 * @returns {boolean}
 */
const exceedsTreeSitterLimits = ({ text, languageId, treeSitterConfig, recordSkip }) => {
  return exceedsSharedTreeSitterLimits({
    text,
    languageId,
    treeSitterConfig,
    onExceeded: (details = {}) => {
      if (!recordSkip) return;
      if (details.reason === 'max-bytes') {
        recordSkip('segment-max-bytes', () => (
          `[tree-sitter:schedule] skip ${languageId} segment: maxBytes (${details.bytes} > ${details.maxBytes})`
        ));
        return;
      }
      if (details.reason === 'max-lines') {
        recordSkip('segment-max-lines', () => (
          `[tree-sitter:schedule] skip ${languageId} segment: maxLines (${details.lines} > ${details.maxLines})`
        ));
      }
    }
  });
};

/**
 * Normalize input file entry into absolute path + stable relative key.
 *
 * @param {string|{abs?:string,path?:string,rel?:string}} entry
 * @param {string} root
 * @returns {{abs:string|null,relKey:string|null}}
 */
const resolveEntryPaths = (entry, root) => {
  if (typeof entry === 'string') {
    const abs = entry;
    const relKey = toPosix(path.relative(root, abs));
    return { abs, relKey };
  }
  const abs = entry?.abs || entry?.path || null;
  if (!abs) return { abs: null, relKey: null };
  const relKey = entry?.rel ? toPosix(entry.rel) : toPosix(path.relative(root, abs));
  return { abs, relKey };
};

/**
 * Stable sort for scheduler jobs to keep planner output deterministic.
 *
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
const sortJobs = (a, b) => {
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
 * Check whether a char code should be counted as part of a word-like token.
 *
 * @param {number} code
 * @returns {boolean}
 */
const isWordLikeCharCode = (code) => (
  (code >= 48 && code <= 57)
  || (code >= 65 && code <= 90)
  || (code >= 97 && code <= 122)
  || code === 95
  || code === 36
);

/**
 * Check whether a char code is treated as whitespace by the segment scanner.
 *
 * @param {number} code
 * @returns {boolean}
 */
const isWhitespaceCharCode = (code) => (
  code === 9 || code === 10 || code === 13 || code === 32 || code === 12
);

/**
 * Estimate parse cost from segment content using line count and token density.
 * Token estimation uses a single pass scanner to keep planner overhead bounded.
 *
 * @param {string} text
 * @returns {{lineCount:number,tokenCount:number,tokenDensity:number,estimatedParseCost:number}}
 */
const estimateSegmentParseCost = (text) => {
  if (!text) {
    return {
      lineCount: 0,
      tokenCount: 0,
      tokenDensity: 0,
      estimatedParseCost: MIN_ESTIMATED_PARSE_COST
    };
  }
  let lineCount = 1;
  let tokenCount = 0;
  let inWord = false;
  let nonWhitespaceChars = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 10) lineCount += 1;
    if (isWhitespaceCharCode(code)) {
      inWord = false;
      continue;
    }
    nonWhitespaceChars += 1;
    if (isWordLikeCharCode(code)) {
      if (!inWord) {
        tokenCount += 1;
        inWord = true;
      }
    } else {
      tokenCount += 1;
      inWord = false;
    }
  }
  const safeLineCount = Math.max(1, lineCount);
  const tokenDensity = tokenCount / safeLineCount;
  const charDensity = nonWhitespaceChars / safeLineCount;
  const tokenMultiplier = 1 + Math.min(2.5, tokenDensity / 18);
  const charMultiplier = 1 + Math.min(1.5, charDensity / 90);
  const estimatedParseCost = Math.max(
    MIN_ESTIMATED_PARSE_COST,
    Math.round(safeLineCount * ((tokenMultiplier * 0.7) + (charMultiplier * 0.3)))
  );
  return {
    lineCount: safeLineCount,
    tokenCount,
    tokenDensity,
    estimatedParseCost
  };
};

/**
 * Resolve observed adaptive profile entry for a grammar key.
 *
 * @param {string} grammarKey
 * @param {Map<string, unknown>|null} observedRowsPerSecByGrammar
 * @returns {object|null}
 */
const resolveObservedProfileEntry = (grammarKey, observedRowsPerSecByGrammar) => {
  if (!(observedRowsPerSecByGrammar instanceof Map) || !grammarKey) return null;
  const raw = observedRowsPerSecByGrammar.get(grammarKey);
  if (!raw || typeof raw !== 'object') {
    const parsed = normalizePositiveNumber(raw, null);
    return parsed ? { rowsPerSec: parsed } : null;
  }
  return raw;
};

/**
 * Resolve observed rows/sec for adaptive planner tuning.
 *
 * @param {string} grammarKey
 * @param {Map<string, unknown>|null} observedRowsPerSecByGrammar
 * @returns {number|null}
 */
const resolveObservedRowsPerSec = (grammarKey, observedRowsPerSecByGrammar) => {
  const entry = resolveObservedProfileEntry(grammarKey, observedRowsPerSecByGrammar);
  if (!entry) return null;
  return normalizePositiveNumber(entry?.rowsPerSec, null);
};

/**
 * Resolve observed parse-cost throughput for adaptive planner tuning.
 *
 * @param {string} grammarKey
 * @param {Map<string, unknown>|null} observedRowsPerSecByGrammar
 * @returns {number|null}
 */
const resolveObservedCostPerSec = (grammarKey, observedRowsPerSecByGrammar) => {
  const entry = resolveObservedProfileEntry(grammarKey, observedRowsPerSecByGrammar);
  if (!entry) return null;
  return normalizePositiveNumber(entry?.costPerSec, null);
};

/**
 * Resolve observed tail duration for adaptive lane-splitting heuristics.
 *
 * @param {string} grammarKey
 * @param {Map<string, unknown>|null} observedRowsPerSecByGrammar
 * @returns {number|null}
 */
const resolveObservedTailDurationMs = (grammarKey, observedRowsPerSecByGrammar) => {
  const entry = resolveObservedProfileEntry(grammarKey, observedRowsPerSecByGrammar);
  if (!entry) return null;
  return normalizePositiveNumber(entry?.tailDurationMs, null);
};

/**
 * Resolve previous lane-state snapshot used for hysteresis/cooldown handling.
 *
 * @param {string} grammarKey
 * @param {Map<string, unknown>|null} observedRowsPerSecByGrammar
 * @returns {{bucketCount:number,cooldownSteps:number,lastAction:'split'|'merge'|'hold'}|null}
 */
const resolveObservedLaneState = (grammarKey, observedRowsPerSecByGrammar) => {
  const entry = resolveObservedProfileEntry(grammarKey, observedRowsPerSecByGrammar);
  if (!entry || typeof entry !== 'object') return null;
  const laneState = entry?.laneState;
  if (!laneState || typeof laneState !== 'object') return null;
  const bucketCount = normalizePositiveInt(laneState.bucketCount, null);
  const cooldownSteps = Math.max(0, Math.floor(Number(laneState.cooldownSteps) || 0));
  const lastAction = laneState.lastAction === 'split' || laneState.lastAction === 'merge'
    ? laneState.lastAction
    : 'hold';
  if (!bucketCount) return null;
  return {
    bucketCount,
    cooldownSteps,
    lastAction
  };
};

/**
 * Resolve target jobs per bucket using adaptive profile throughput.
 *
 * @param {{
 *  group?:object,
 *  schedulerConfig?:object,
 *  observedRowsPerSecByGrammar?:Map<string,unknown>|null
 * }} input
 * @returns {number}
 */
const resolveAdaptiveBucketTargetJobs = ({
  group,
  schedulerConfig = {},
  observedRowsPerSecByGrammar = null
}) => {
  const defaultTarget = Number.isFinite(Number(schedulerConfig.heavyGrammarBucketTargetJobs))
    ? Math.max(ADAPTIVE_BUCKET_MIN_JOBS, Math.floor(Number(schedulerConfig.heavyGrammarBucketTargetJobs)))
    : HEAVY_GRAMMAR_BUCKET_TARGET_JOBS;
  const observedRowsPerSec = resolveObservedRowsPerSec(group?.grammarKey, observedRowsPerSecByGrammar);
  if (Number.isFinite(observedRowsPerSec) && observedRowsPerSec > 0) {
    const targetMsRaw = Number(schedulerConfig.adaptiveBucketTargetMs);
    const targetMs = Number.isFinite(targetMsRaw) && targetMsRaw > 0
      ? Math.floor(targetMsRaw)
      : ADAPTIVE_BUCKET_TARGET_MS;
    const projected = Math.floor((observedRowsPerSec * targetMs) / 1000);
    return Math.max(ADAPTIVE_BUCKET_MIN_JOBS, Math.min(ADAPTIVE_BUCKET_MAX_JOBS, projected));
  }
  return Math.max(ADAPTIVE_BUCKET_MIN_JOBS, defaultTarget);
};

/**
 * Resolve target jobs per wave for within-bucket slicing.
 *
 * @param {{
 *  group?:object,
 *  schedulerConfig?:object,
 *  observedRowsPerSecByGrammar?:Map<string,unknown>|null
 * }} input
 * @returns {number}
 */
const resolveAdaptiveWaveTargetJobs = ({
  group,
  schedulerConfig = {},
  observedRowsPerSecByGrammar = null
}) => {
  const observedRowsPerSec = resolveObservedRowsPerSec(group?.grammarKey, observedRowsPerSecByGrammar);
  if (Number.isFinite(observedRowsPerSec) && observedRowsPerSec > 0) {
    const targetMsRaw = Number(schedulerConfig.adaptiveWaveTargetMs);
    const targetMs = Number.isFinite(targetMsRaw) && targetMsRaw > 0
      ? Math.floor(targetMsRaw)
      : ADAPTIVE_WAVE_TARGET_MS;
    const projected = Math.floor((observedRowsPerSec * targetMs) / 1000);
    return Math.max(ADAPTIVE_WAVE_MIN_JOBS, Math.min(ADAPTIVE_WAVE_MAX_JOBS, projected));
  }
  const fallback = resolveAdaptiveBucketTargetJobs({ group, schedulerConfig, observedRowsPerSecByGrammar });
  return Math.max(ADAPTIVE_WAVE_MIN_JOBS, Math.min(ADAPTIVE_WAVE_MAX_JOBS, fallback));
};

/**
 * Resolve target parse-cost per bucket for adaptive sharding.
 *
 * @param {{
 *  group?:object,
 *  schedulerConfig?:object,
 *  observedRowsPerSecByGrammar?:Map<string,unknown>|null
 * }} input
 * @returns {number}
 */
const resolveAdaptiveBucketTargetCost = ({
  group,
  schedulerConfig = {},
  observedRowsPerSecByGrammar = null
}) => {
  const baselineCostPerJob = normalizePositiveNumber(
    schedulerConfig.estimatedParseCostPerJobBaseline,
    ESTIMATED_COST_BASELINE_PER_JOB
  );
  const observedCostPerSec = resolveObservedCostPerSec(group?.grammarKey, observedRowsPerSecByGrammar);
  if (Number.isFinite(observedCostPerSec) && observedCostPerSec > 0) {
    const targetMsRaw = Number(schedulerConfig.adaptiveBucketTargetMs);
    const targetMs = Number.isFinite(targetMsRaw) && targetMsRaw > 0
      ? Math.floor(targetMsRaw)
      : ADAPTIVE_BUCKET_TARGET_MS;
    const projected = Math.floor((observedCostPerSec * targetMs) / 1000);
    return Math.max(
      baselineCostPerJob * ADAPTIVE_BUCKET_MIN_JOBS,
      Math.min(baselineCostPerJob * ADAPTIVE_BUCKET_MAX_JOBS, projected)
    );
  }
  const targetJobs = resolveAdaptiveBucketTargetJobs({ group, schedulerConfig, observedRowsPerSecByGrammar });
  return Math.max(
    baselineCostPerJob * ADAPTIVE_BUCKET_MIN_JOBS,
    targetJobs * baselineCostPerJob
  );
};

/**
 * Resolve target parse-cost per wave for adaptive bucketing.
 *
 * @param {{
 *  group?:object,
 *  schedulerConfig?:object,
 *  observedRowsPerSecByGrammar?:Map<string,unknown>|null
 * }} input
 * @returns {number}
 */
const resolveAdaptiveWaveTargetCost = ({
  group,
  schedulerConfig = {},
  observedRowsPerSecByGrammar = null
}) => {
  const baselineCostPerJob = normalizePositiveNumber(
    schedulerConfig.estimatedParseCostPerJobBaseline,
    ESTIMATED_COST_BASELINE_PER_JOB
  );
  const observedCostPerSec = resolveObservedCostPerSec(group?.grammarKey, observedRowsPerSecByGrammar);
  if (Number.isFinite(observedCostPerSec) && observedCostPerSec > 0) {
    const targetMsRaw = Number(schedulerConfig.adaptiveWaveTargetMs);
    const targetMs = Number.isFinite(targetMsRaw) && targetMsRaw > 0
      ? Math.floor(targetMsRaw)
      : ADAPTIVE_WAVE_TARGET_MS;
    const projected = Math.floor((observedCostPerSec * targetMs) / 1000);
    return Math.max(
      baselineCostPerJob * ADAPTIVE_WAVE_MIN_JOBS,
      Math.min(baselineCostPerJob * ADAPTIVE_WAVE_MAX_JOBS, projected)
    );
  }
  const targetJobs = resolveAdaptiveWaveTargetJobs({ group, schedulerConfig, observedRowsPerSecByGrammar });
  return Math.max(
    baselineCostPerJob * ADAPTIVE_WAVE_MIN_JOBS,
    targetJobs * baselineCostPerJob
  );
};

/**
 * Assign jobs to buckets by directory affinity while actively splitting very
 * large directories so one subtree cannot monopolize the tail wave.
 *
 * @param {{jobs:Array<object>,bucketCount:number}} input
 * @returns {Array<Array<object>>}
 */
const assignPathAwareBuckets = ({ jobs, bucketCount }) => {
  const safeBucketCount = Math.max(1, Math.floor(Number(bucketCount) || 1));
  if (safeBucketCount <= 1 || !Array.isArray(jobs) || jobs.length <= 1) {
    return [Array.isArray(jobs) ? jobs.slice() : []];
  }
  const buckets = Array.from({ length: safeBucketCount }, () => []);
  const bucketCostLoads = new Array(safeBucketCount).fill(0);
  const bucketJobLoads = new Array(safeBucketCount).fill(0);
  const jobsByDir = new Map();
  const jobCostByJob = new Map();
  let totalEstimatedCost = 0;

  for (const job of jobs) {
    const key = job?.containerPath || job?.virtualPath || '';
    const dirKey = toPosix(path.dirname(String(key || ''))).toLowerCase() || '.';
    const jobCost = resolveJobEstimatedParseCost(job);
    totalEstimatedCost += jobCost;
    jobCostByJob.set(job, jobCost);
    if (!jobsByDir.has(dirKey)) {
      jobsByDir.set(dirKey, { dirKey, dirJobs: [], dirEstimatedCost: 0 });
    }
    const group = jobsByDir.get(dirKey);
    group.dirJobs.push(job);
    group.dirEstimatedCost += jobCost;
  }

  const groups = Array.from(jobsByDir.values());
  for (const group of groups) {
    if (group.dirJobs.length > 1) group.dirJobs.sort(sortJobs);
  }
  groups.sort((a, b) => {
    const costDelta = b.dirEstimatedCost - a.dirEstimatedCost;
    if (costDelta !== 0) return costDelta;
    const sizeDelta = b.dirJobs.length - a.dirJobs.length;
    if (sizeDelta !== 0) return sizeDelta;
    return compareStrings(a.dirKey, b.dirKey);
  });

  const averageJobCost = totalEstimatedCost / Math.max(1, jobs.length);
  const idealBucketCost = Math.max(1, totalEstimatedCost / safeBucketCount);
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
  for (const group of groups) {
    const dirJobs = group.dirJobs;
    if (!dirJobs.length) continue;
    if (group.dirEstimatedCost >= bigDirThreshold && dirJobs.length > 1) {
      const sortedByCost = dirJobs.slice();
      sortedByCost.sort((a, b) => {
        const costDelta = (jobCostByJob.get(b) || resolveJobEstimatedParseCost(b))
          - (jobCostByJob.get(a) || resolveJobEstimatedParseCost(a));
        if (costDelta !== 0) return costDelta;
        return sortJobs(a, b);
      });
      for (const job of sortedByCost) {
        const jobCost = jobCostByJob.get(job) || resolveJobEstimatedParseCost(job);
        const key = job?.containerPath || job?.virtualPath || '';
        const hashedIndex = hashString(key) % safeBucketCount;
        const leastLoadedIndex = findLeastLoadedBucket();
        const chooseHashed = (bucketCostLoads[hashedIndex] + jobCost)
          <= ((bucketCostLoads[leastLoadedIndex] + jobCost) * 1.08);
        const chosenIndex = chooseHashed
          ? hashedIndex
          : leastLoadedIndex;
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

/**
 * Apply hysteresis/cooldown guardrails to lane split/merge transitions.
 *
 * @param {{
 *  desiredBucketCount:number,
 *  minBuckets:number,
 *  maxBuckets:number,
 *  laneState?:{bucketCount?:number,cooldownSteps?:number,lastAction?:string}|null,
 *  guardrails:{maxStepUp:number,maxStepDown:number,splitHysteresisRatio:number,mergeHysteresisRatio:number},
 *  hasSplitPressure?:boolean,
 *  hasMergePressure?:boolean
 * }} input
 * @returns {number}
 */
const applyBucketCountGuardrails = ({
  desiredBucketCount,
  minBuckets,
  maxBuckets,
  laneState,
  guardrails,
  hasSplitPressure = false,
  hasMergePressure = false
}) => {
  let resolved = Math.max(minBuckets, Math.min(maxBuckets, Math.floor(desiredBucketCount || 1)));
  const priorBucketCount = normalizePositiveInt(laneState?.bucketCount, null);
  if (!priorBucketCount) return resolved;
  if (resolved > priorBucketCount) {
    const delta = resolved - priorBucketCount;
    resolved = priorBucketCount + Math.min(guardrails.maxStepUp, delta);
    const ratio = resolved / Math.max(1, priorBucketCount);
    if (ratio < guardrails.splitHysteresisRatio && !hasSplitPressure) {
      resolved = priorBucketCount;
    }
    if (laneState?.cooldownSteps > 0 && laneState?.lastAction === 'merge' && !hasSplitPressure) {
      resolved = priorBucketCount;
    }
  } else if (resolved < priorBucketCount) {
    const delta = priorBucketCount - resolved;
    resolved = priorBucketCount - Math.min(guardrails.maxStepDown, delta);
    const ratio = resolved / Math.max(1, priorBucketCount);
    if (ratio > guardrails.mergeHysteresisRatio && !hasMergePressure) {
      resolved = priorBucketCount;
    }
    if (laneState?.cooldownSteps > 0 && laneState?.lastAction === 'split' && !hasMergePressure) {
      resolved = priorBucketCount;
    }
  }
  return Math.max(minBuckets, Math.min(maxBuckets, resolved));
};

/**
 * Split a grammar group into one or more bucket shards based on observed load.
 *
 * @param {{
 *  group:object,
 *  schedulerConfig?:object,
 *  observedRowsPerSecByGrammar?:Map<string,unknown>|null
 * }} input
 * @returns {Array<object>}
 */
const shardGrammarGroup = ({
  group,
  schedulerConfig = {},
  observedRowsPerSecByGrammar = null
}) => {
  const jobs = Array.isArray(group?.jobs) ? group.jobs : [];
  if (!jobs.length) return [];
  const guardrails = resolveTreeSitterLaneGuardrails(schedulerConfig);
  const jobStats = summarizeGrammarJobs(jobs);
  const observedTailDurationMs = resolveObservedTailDurationMs(
    group?.grammarKey,
    observedRowsPerSecByGrammar
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
    observedRowsPerSecByGrammar
  });
  const targetCost = resolveAdaptiveBucketTargetCost({
    group,
    schedulerConfig,
    observedRowsPerSecByGrammar
  });
  const minBuckets = Number.isFinite(Number(schedulerConfig.heavyGrammarBucketMin))
    ? Math.max(1, Math.floor(Number(schedulerConfig.heavyGrammarBucketMin)))
    : HEAVY_GRAMMAR_BUCKET_MIN;
  const maxBuckets = Number.isFinite(Number(schedulerConfig.heavyGrammarBucketMax))
    ? Math.max(minBuckets, Math.floor(Number(schedulerConfig.heavyGrammarBucketMax)))
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
  const laneState = resolveObservedLaneState(group?.grammarKey, observedRowsPerSecByGrammar);
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
  let buckets = assignPathAwareBuckets({ jobs, bucketCount });
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
      buckets = assignPathAwareBuckets({ jobs, bucketCount });
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
      buckets = assignPathAwareBuckets({ jobs, bucketCount });
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
 *  observedRowsPerSecByGrammar?:Map<string,unknown>|null
 * }} input
 * @returns {Array<object>}
 */
const splitGrammarBucketIntoWaves = ({
  group,
  schedulerConfig = {},
  observedRowsPerSecByGrammar = null
}) => {
  const jobs = Array.isArray(group?.jobs) ? group.jobs : [];
  if (!jobs.length) return [];
  const totalEstimatedCost = sumJobEstimatedParseCost(jobs);
  const targetJobs = resolveAdaptiveWaveTargetJobs({
    group,
    schedulerConfig,
    observedRowsPerSecByGrammar
  });
  const targetCost = resolveAdaptiveWaveTargetCost({
    group,
    schedulerConfig,
    observedRowsPerSecByGrammar
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
 * Resolve planner I/O concurrency for scheduler plan building.
 * Uses explicit scheduler overrides when provided, otherwise derives from
 * host parallelism with an upper safety cap.
 *
 * @param {object|null|undefined} treeSitterConfig
 * @param {number} [entryCount]
 * @returns {number}
 */
const resolvePlannerIoConcurrency = (treeSitterConfig, entryCount = 0) => {
  const schedulerConfig = treeSitterConfig?.scheduler || {};
  const configuredRaw = Number(
    schedulerConfig.planIoConcurrency
      ?? schedulerConfig.plannerIoConcurrency
      ?? schedulerConfig.ioConcurrency
  );
  if (Number.isFinite(configuredRaw) && configuredRaw > 0) {
    return Math.max(1, Math.min(PLANNER_IO_CONCURRENCY_CAP, Math.floor(configuredRaw)));
  }
  const available = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : 4;
  const totalMemGb = Number.isFinite(Number(os.totalmem()))
    ? (Number(os.totalmem()) / (1024 ** 3))
    : null;
  const memoryConstrainedCap = Number.isFinite(totalMemGb) && totalMemGb > 0 && totalMemGb < 8
    ? 8
    : PLANNER_IO_CONCURRENCY_CAP;
  let resolved = Math.max(1, Math.min(memoryConstrainedCap, Math.floor(available || 1)));
  if (Number(entryCount) >= PLANNER_IO_LARGE_REPO_THRESHOLD) {
    const boosted = Math.max(resolved, Math.floor((available || 1) * 0.75));
    resolved = Math.max(1, Math.min(memoryConstrainedCap, boosted));
  }
  return resolved;
};

/**
 * Create aggregated skip logger with per-reason sampling and final summary.
 *
 * @param {{treeSitterConfig?:object|null,log?:(line:string)=>void|null}} input
 * @returns {{record:(reason:string,message:string|(()=>string))=>void,flush:()=>void}}
 */
const createSkipLogger = ({ treeSitterConfig, log }) => {
  const schedulerConfig = treeSitterConfig?.scheduler || {};
  const sampleLimitRaw = Number(
    schedulerConfig.skipLogSampleLimit
      ?? schedulerConfig.logSkipSampleLimit
      ?? schedulerConfig.skipSampleLimit
      ?? TREE_SITTER_SKIP_SAMPLE_LIMIT_DEFAULT
  );
  const sampleLimit = Number.isFinite(sampleLimitRaw) && sampleLimitRaw >= 0
    ? Math.floor(sampleLimitRaw)
    : TREE_SITTER_SKIP_SAMPLE_LIMIT_DEFAULT;
  const emitSamples = schedulerConfig.logSkips !== false;
  const counts = new Map();
  const sampleCounts = new Map();

  const record = (reason, message) => {
    const reasonKey = reason || 'unknown';
    counts.set(reasonKey, (counts.get(reasonKey) || 0) + 1);
    if (!emitSamples || !log || sampleLimit <= 0 || !message) return;
    const seen = sampleCounts.get(reasonKey) || 0;
    if (seen >= sampleLimit) return;
    const rendered = typeof message === 'function' ? message() : message;
    if (!rendered) return;
    log(rendered);
    sampleCounts.set(reasonKey, seen + 1);
  };

  const flush = () => {
    if (!log || !counts.size) return;
    for (const reasonKey of Array.from(counts.keys()).sort(compareStrings)) {
      const count = counts.get(reasonKey) || 0;
      if (!count) continue;
      const samples = sampleCounts.get(reasonKey) || 0;
      const suppressed = Math.max(0, count - samples);
      if (suppressed > 0) {
        log(`[tree-sitter:schedule] skip summary ${reasonKey}: ${count} total (${samples} sampled, ${suppressed} suppressed)`);
      } else {
        log(`[tree-sitter:schedule] skip summary ${reasonKey}: ${count} total`);
      }
    }
  };

  return { record, flush };
};

/**
 * Build scheduler planning artifacts for tree-sitter subprocess execution.
 *
 * @param {{
 *  mode:'code'|'prose'|'records'|'extracted-prose',
 *  runtime:object,
 *  entries:Array<object|string>,
 *  outDir:string,
 *  fileTextCache?:Map<string,object>|null,
 *  abortSignal?:AbortSignal|null,
 *  log?:(line:string)=>void|null
 * }} input
 * @returns {Promise<object|null>}
 */
export const buildTreeSitterSchedulerPlan = async ({
  mode,
  runtime,
  entries,
  outDir,
  fileTextCache = null,
  abortSignal = null,
  log = null
}) => {
  if (mode !== 'code') return null;
  const treeSitterConfig = runtime?.languageOptions?.treeSitter || null;
  if (!treeSitterConfig || treeSitterConfig.enabled === false) return null;
  const strict = treeSitterConfig?.strict === true;
  const skipOnParseError = runtime?.languageOptions?.skipOnParseError === true;
  const skipLogger = createSkipLogger({ treeSitterConfig, log });
  const recordSkip = (reason, message) => skipLogger.record(reason, message);

  const paths = resolveTreeSitterSchedulerPaths(outDir);
  await fs.mkdir(paths.baseDir, { recursive: true });
  await fs.mkdir(paths.jobsDir, { recursive: true });

  const groups = new Map(); // grammarKey -> { grammarKey, languages:Set<string>, jobs:Array<object> }
  const requiredNativeLanguages = new Set();
  const treeSitterOptions = { treeSitter: treeSitterConfig };
  const effectiveMode = mode;

  const resolveEntrySortKey = (entry) => {
    if (!entry) return '';
    if (typeof entry === 'string') return toPosix(String(entry));
    if (typeof entry?.rel === 'string' && entry.rel) return toPosix(entry.rel);
    if (typeof entry?.abs === 'string' && entry.abs) {
      return toPosix(path.relative(runtime.root, entry.abs));
    }
    const resolved = resolveEntryPaths(entry, runtime.root);
    return resolved?.relKey ? toPosix(resolved.relKey) : '';
  };

  const sortedEntriesWithKeys = Array.isArray(entries)
    ? entries.map((entry, stableIndex) => ({
      entry,
      stableIndex,
      sortKey: resolveEntrySortKey(entry)
    }))
    : [];
  sortedEntriesWithKeys.sort((a, b) => {
    const sortDelta = compareStrings(a.sortKey, b.sortKey);
    if (sortDelta !== 0) return sortDelta;
    return a.stableIndex - b.stableIndex;
  });
  const plannerIoConcurrency = resolvePlannerIoConcurrency(treeSitterConfig, sortedEntriesWithKeys.length);

  const entryResults = await runWithConcurrency(
    sortedEntriesWithKeys,
    plannerIoConcurrency,
    async (sortedEntry) => {
      const entry = sortedEntry?.entry;
      throwIfAborted(abortSignal);
      if (!entry) return { jobs: [], requiredLanguages: [] };
      if (entry?.treeSitterDisabled === true) return { jobs: [], requiredLanguages: [] };
      const { abs, relKey } = resolveEntryPaths(entry, runtime.root);
      if (!abs || !relKey) return { jobs: [], requiredLanguages: [] };

      let stat = null;
      try {
        // Mirror file processor behavior: use lstat so we can reliably detect
        // symlinks (stat() follows them).
        stat = await fs.lstat(abs);
      } catch (err) {
        recordSkip('lstat-failed', () => (
          `[tree-sitter:schedule] skip ${relKey}: lstat failed (${err?.code || 'ERR'})`
        ));
        return { jobs: [], requiredLanguages: [] };
      }
      if (stat?.isSymbolicLink?.()) {
        recordSkip('symlink', () => `[tree-sitter:schedule] skip ${relKey}: symlink`);
        return { jobs: [], requiredLanguages: [] };
      }
      if (stat && typeof stat.isFile === 'function' && !stat.isFile()) {
        recordSkip('not-file', () => `[tree-sitter:schedule] skip ${relKey}: not a file`);
        return { jobs: [], requiredLanguages: [] };
      }
      if (entry?.skip) {
        const reason = entry.skip?.reason || 'skip';
        recordSkip('entry-skip', () => `[tree-sitter:schedule] skip ${relKey}: ${reason}`);
        return { jobs: [], requiredLanguages: [] };
      }
      if (entry?.scan?.skip) {
        const reason = entry.scan.skip?.reason || 'skip';
        recordSkip('scan-skip', () => `[tree-sitter:schedule] skip ${relKey}: ${reason}`);
        return { jobs: [], requiredLanguages: [] };
      }
      if (isMinifiedName(path.basename(abs))) {
        recordSkip('minified', () => `[tree-sitter:schedule] skip ${relKey}: minified`);
        return { jobs: [], requiredLanguages: [] };
      }

      const ext = typeof entry?.ext === 'string' && entry.ext ? entry.ext : path.extname(abs);
      const langHint = getLanguageForFile(ext, relKey);
      const primaryLanguageId = langHint?.id || null;
      if (shouldSkipTreeSitterPlanningForPath({ relKey, languageId: primaryLanguageId })) {
        recordSkip('policy', () => (
          `[tree-sitter:schedule] skip ${primaryLanguageId || 'unknown'} file: policy (${relKey})`
        ));
        return { jobs: [], requiredLanguages: [] };
      }
      const { maxBytes, maxLines } = resolveTreeSitterLimits({
        languageId: primaryLanguageId,
        treeSitterConfig
      });
      if (typeof maxBytes === 'number' && maxBytes > 0 && Number.isFinite(stat?.size) && stat.size > maxBytes) {
        recordSkip('file-max-bytes', () => (
          `[tree-sitter:schedule] skip ${primaryLanguageId || 'unknown'} file: maxBytes (${stat.size} > ${maxBytes})`
        ));
        return { jobs: [], requiredLanguages: [] };
      }
      const knownLines = Number(entry?.lines);
      if (typeof maxLines === 'number' && maxLines > 0 && Number.isFinite(knownLines) && knownLines > maxLines) {
        recordSkip('file-max-lines', () => (
          `[tree-sitter:schedule] skip ${primaryLanguageId || 'unknown'} file: maxLines (${knownLines} > ${maxLines})`
        ));
        return { jobs: [], requiredLanguages: [] };
      }

      let text = null;
      let buffer = null;
      let hash = null;
      const cached = fileTextCache?.get && relKey ? fileTextCache.get(relKey) : null;
      if (cached && typeof cached === 'object') {
        if (typeof cached.text === 'string') text = cached.text;
        if (Buffer.isBuffer(cached.buffer)) buffer = cached.buffer;
        if (typeof cached.hash === 'string' && cached.hash) hash = cached.hash;
      }
      if (!text) {
        try {
          const decoded = await readTextFileWithHash(abs, { buffer, stat });
          text = decoded.text;
          buffer = decoded.buffer;
          hash = decoded.hash;
          if (fileTextCache?.set && relKey) {
            fileTextCache.set(relKey, {
              text,
              buffer,
              hash: decoded.hash,
              size: stat?.size ?? buffer.length,
              mtimeMs: stat?.mtimeMs ?? null,
              encoding: decoded.encoding || null,
              encodingFallback: decoded.usedFallback,
              encodingConfidence: decoded.confidence
            });
          }
        } catch (err) {
          const code = err?.code || null;
          if (code === 'ERR_SYMLINK') {
            recordSkip('symlink', () => `[tree-sitter:schedule] skip ${relKey}: symlink`);
            return { jobs: [], requiredLanguages: [] };
          }
          const reason = (code === 'EACCES' || code === 'EPERM' || code === 'EISDIR')
            ? 'unreadable'
            : 'read-failure';
          recordSkip(reason, () => `[tree-sitter:schedule] skip ${relKey}: ${reason} (${code || 'ERR'})`);
          return { jobs: [], requiredLanguages: [] };
        }
      }
      if (!hash) {
        const decoded = await readTextFileWithHash(abs, { buffer, stat });
        hash = decoded.hash;
        if (!text) text = decoded.text;
        if (!buffer) buffer = decoded.buffer;
      }
      const fileVersionSignature = createTreeSitterFileVersionSignature({
        size: stat?.size,
        mtimeMs: stat?.mtimeMs,
        hash
      });

      let segments = null;
      try {
        segments = discoverSegments({
          text,
          ext,
          relPath: relKey,
          mode: effectiveMode,
          languageId: primaryLanguageId,
          context: null,
          segmentsConfig: runtime.segmentsConfig,
          extraSegments: []
        });
        await assignSegmentUids({ text, segments, ext, mode: effectiveMode });
      } catch (err) {
        const message = err?.message || String(err);
        if (skipOnParseError) {
          recordSkip('parse-error', () => `[tree-sitter:schedule] skip ${relKey}: parse-error (${message})`);
          return { jobs: [], requiredLanguages: [] };
        }
        throw new Error(`[tree-sitter:schedule] segment discovery failed for ${relKey}: ${message}`);
      }

      const jobs = [];
      const requiredLanguages = new Set();
      for (const segment of segments || []) {
        if (!segment) continue;
        const tokenMode = resolveSegmentTokenMode(segment);
        if (tokenMode !== 'code') continue;
        if (!shouldIndexSegment(segment, tokenMode, effectiveMode)) continue;

        const segmentExt = resolveSegmentExt(ext, segment);
        const rawLanguageId = segment.languageId || primaryLanguageId || null;
        const languageId = resolveTreeSitterLanguageForSegment(rawLanguageId, segmentExt);
        if (!languageId || !TREE_SITTER_LANG_IDS.has(languageId)) continue;
        if (!isTreeSitterSchedulerLanguage(languageId)) continue;
        if (!isTreeSitterEnabled(treeSitterOptions, languageId)) continue;

        const segmentText = text.slice(segment.start, segment.end);
        if (exceedsTreeSitterLimits({ text: segmentText, languageId, treeSitterConfig, recordSkip })) {
          continue;
        }

        const target = resolveNativeTreeSitterTarget(languageId, segmentExt);
        if (!target) {
          if (strict) {
            throw new Error(`[tree-sitter:schedule] missing grammar target for ${languageId} (${relKey}).`);
          }
          recordSkip('grammar-target-unavailable', () => (
            `[tree-sitter:schedule] skip ${languageId} segment: grammar target unavailable (${relKey})`
          ));
          continue;
        }
        const grammarKey = target.grammarKey;

        const segmentUid = segment.segmentUid || null;
        const virtualPath = buildVfsVirtualPath({
          containerPath: relKey,
          segmentUid,
          effectiveExt: segmentExt
        });
        const relationExtractionOnly = entry?.treeSitterRelationOnly === true
          || entry?.relationExtractionOnly === true
          || entry?.relationsOnly === true
          || segment?.meta?.relationExtractionOnly === true
          || segment?.meta?.relationOnly === true;
        const parseEstimate = estimateSegmentParseCost(segmentText);
        const estimatedParseCost = relationExtractionOnly
          ? Math.max(MIN_ESTIMATED_PARSE_COST, Math.floor(parseEstimate.estimatedParseCost * 0.75))
          : parseEstimate.estimatedParseCost;

        requiredLanguages.add(languageId);
        jobs.push({
          schemaVersion: '1.0.0',
          virtualPath,
          grammarKey,
          runtimeKind: target.runtimeKind,
          languageId,
          containerPath: relKey,
          containerExt: ext,
          effectiveExt: segmentExt,
          segmentStart: segment.start,
          segmentEnd: segment.end,
          parseMode: relationExtractionOnly ? 'lightweight-relations' : 'full',
          estimatedLineCount: parseEstimate.lineCount,
          estimatedTokenCount: parseEstimate.tokenCount,
          estimatedTokenDensity: parseEstimate.tokenDensity,
          estimatedParseCost,
          fileVersionSignature,
          segment
        });
      }
      return { jobs, requiredLanguages: Array.from(requiredLanguages) };
    },
    { signal: abortSignal }
  );

  for (const result of entryResults || []) {
    throwIfAborted(abortSignal);
    if (!result) continue;
    for (const languageId of result.requiredLanguages || []) {
      requiredNativeLanguages.add(languageId);
    }
    for (const job of result.jobs || []) {
      const grammarKey = job.grammarKey;
      if (!groups.has(grammarKey)) {
        groups.set(grammarKey, { grammarKey, languages: new Set(), jobs: [] });
      }
      const group = groups.get(grammarKey);
      group.languages.add(job.languageId);
      group.jobs.push(job);
    }
  }

  const requiredNative = Array.from(requiredNativeLanguages).sort(compareStrings);
  const preflight = preflightNativeTreeSitterGrammars(requiredNative, { log });
  if (!preflight.ok) {
    const blocked = Array.from(new Set([...(preflight.missing || []), ...(preflight.unavailable || [])]));
    if (strict) {
      const details = [
        preflight.missing?.length ? `missing=${preflight.missing.join(',')}` : null,
        preflight.unavailable?.length ? `unavailable=${preflight.unavailable.join(',')}` : null
      ].filter(Boolean).join(' ');
      throw new Error(`[tree-sitter:schedule] grammar preflight failed ${details}`.trim());
    }
    if (blocked.length) {
      const blockedSet = new Set(blocked);
      for (const [grammarKey, group] of groups.entries()) {
        let writeJobIndex = 0;
        for (let readJobIndex = 0; readJobIndex < group.jobs.length; readJobIndex += 1) {
          const job = group.jobs[readJobIndex];
          if (blockedSet.has(job.languageId)) continue;
          group.jobs[writeJobIndex] = job;
          writeJobIndex += 1;
        }
        group.jobs.length = writeJobIndex;
        for (const languageId of group.languages) {
          if (blockedSet.has(languageId)) group.languages.delete(languageId);
        }
        if (!group.jobs.length) groups.delete(grammarKey);
      }
      if (log) {
        log(`[tree-sitter:schedule] grammar preflight unavailable; skipping languages: ${blocked.join(', ')}`);
      }
    }
  }

  const { entriesByGrammarKey: observedRowsPerSecByGrammar } = await loadTreeSitterSchedulerAdaptiveProfile({
    runtime,
    treeSitterConfig,
    log
  });
  const grammarKeys = Array.from(groups.keys());
  grammarKeys.sort(compareStrings);
  const schedulerConfig = treeSitterConfig?.scheduler || {};
  const groupList = [];
  for (const grammarKey of grammarKeys) {
    const group = groups.get(grammarKey);
    if (!group) continue;
    if (group.jobs.length > 1) group.jobs.sort(sortJobs);
    const baseGroup = {
      grammarKey,
      languages: Array.from(group.languages).sort(compareStrings),
      jobs: group.jobs
    };
    const sharded = shardGrammarGroup({
      group: baseGroup,
      schedulerConfig,
      observedRowsPerSecByGrammar
    });
    for (const bucketGroup of sharded) {
      const waves = splitGrammarBucketIntoWaves({
        group: bucketGroup,
        schedulerConfig,
        observedRowsPerSecByGrammar
      });
      for (const wave of waves) {
        groupList.push(wave);
      }
    }
  }
  const executionOrder = buildContinuousWaveExecutionOrder(groupList);
  const laneDiagnostics = buildLaneDiagnostics(groupList);
  const { finalGrammarKeys, groupMeta, totalJobs } = buildPlanGroupArtifacts(groupList);

  const plan = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    mode,
    repoRoot: runtime.root,
    repoCacheRoot: runtime?.repoCacheRoot || null,
    outDir,
    jobs: totalJobs,
    grammarKeys: finalGrammarKeys,
    executionOrder,
    groupMeta,
    laneDiagnostics,
    requiredNativeLanguages: requiredNative,
    treeSitterConfig
  };

  await writeJsonObjectFile(paths.planPath, { fields: plan, atomic: true });
  for (const group of groupList) {
    const jobPath = paths.jobPathForGrammarKey(group.grammarKey);
    await writeJsonLinesFile(jobPath, group.jobs, { atomic: true, compression: null });
  }

  skipLogger.flush();
  return { plan, groups: groupList, paths };
};

export const treeSitterSchedulerPlannerInternals = Object.freeze({
  estimateSegmentParseCost,
  summarizeGrammarJobs,
  resolveAdaptiveBucketTargetJobs,
  resolveAdaptiveWaveTargetJobs,
  resolveAdaptiveBucketTargetCost,
  resolveAdaptiveWaveTargetCost,
  assignPathAwareBuckets,
  summarizeBucketMetrics,
  shardGrammarGroup,
  splitGrammarBucketIntoWaves,
  buildContinuousWaveExecutionOrder,
  buildLaneDiagnostics
});
