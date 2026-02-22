import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { throwIfAborted } from '../../../shared/abort.js';
import { toPosix } from '../../../shared/files.js';
import { compareStrings } from '../../../shared/sort.js';
import { runWithConcurrency } from '../../../shared/concurrency.js';
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
const MIN_ESTIMATED_PARSE_COST = 1;
const MAX_BUCKET_REBALANCE_ITERATIONS = 4;

const countLines = (text, maxLines = null) => {
  if (!text) return 0;
  const capped = Number.isFinite(Number(maxLines)) && Number(maxLines) > 0
    ? Math.floor(Number(maxLines))
    : null;
  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
    if (capped && count > capped) return count;
  }
  return count;
};

const resolveTreeSitterLimits = ({ languageId, treeSitterConfig }) => {
  const config = treeSitterConfig && typeof treeSitterConfig === 'object' ? treeSitterConfig : {};
  const perLanguage = (config.byLanguage && languageId && config.byLanguage[languageId]) || {};
  const maxBytes = perLanguage.maxBytes ?? config.maxBytes;
  const maxLines = perLanguage.maxLines ?? config.maxLines;
  return { maxBytes, maxLines };
};

const exceedsTreeSitterLimits = ({ text, languageId, treeSitterConfig, recordSkip }) => {
  const { maxBytes, maxLines } = resolveTreeSitterLimits({ languageId, treeSitterConfig });
  if (typeof maxBytes === 'number' && maxBytes > 0) {
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > maxBytes) {
      if (recordSkip) {
        recordSkip('segment-max-bytes', () => (
          `[tree-sitter:schedule] skip ${languageId} segment: maxBytes (${bytes} > ${maxBytes})`
        ));
      }
      return true;
    }
  }
  if (typeof maxLines === 'number' && maxLines > 0) {
    const lines = countLines(text, maxLines);
    if (lines > maxLines) {
      if (recordSkip) {
        recordSkip('segment-max-lines', () => (
          `[tree-sitter:schedule] skip ${languageId} segment: maxLines (${lines} > ${maxLines})`
        ));
      }
      return true;
    }
  }
  return false;
};

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

const hashString = (value) => {
  const text = String(value || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const normalizePositiveNumber = (value, fallback = null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const normalizePositiveInt = (value, fallback = null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
};

const isWordLikeCharCode = (code) => (
  (code >= 48 && code <= 57)
  || (code >= 65 && code <= 90)
  || (code >= 97 && code <= 122)
  || code === 95
  || code === 36
);

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

const resolveJobEstimatedParseCost = (job) => {
  const estimated = normalizePositiveNumber(job?.estimatedParseCost);
  if (estimated) return estimated;
  const span = normalizePositiveNumber(
    Number(job?.segmentEnd) - Number(job?.segmentStart),
    MIN_ESTIMATED_PARSE_COST
  );
  return Math.max(MIN_ESTIMATED_PARSE_COST, Math.ceil(span / 64));
};

const summarizeGrammarJobs = (jobs) => {
  const list = Array.isArray(jobs) ? jobs : [];
  if (!list.length) {
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
  const costs = list
    .map((job) => resolveJobEstimatedParseCost(job))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!costs.length) {
    return {
      jobCount: list.length,
      totalEstimatedCost: list.length,
      avgCost: 1,
      minCost: 1,
      maxCost: 1,
      p95Cost: 1,
      skewRatio: 1
    };
  }
  const totalEstimatedCost = costs.reduce((sum, value) => sum + value, 0);
  const jobCount = list.length;
  const avgCost = totalEstimatedCost / Math.max(1, jobCount);
  const minCost = costs[0];
  const maxCost = costs[costs.length - 1];
  const p95Cost = costs[Math.max(0, Math.floor((costs.length - 1) * 0.95))];
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

const resolveObservedProfileEntry = (grammarKey, observedRowsPerSecByGrammar) => {
  if (!(observedRowsPerSecByGrammar instanceof Map) || !grammarKey) return null;
  const raw = observedRowsPerSecByGrammar.get(grammarKey);
  if (!raw || typeof raw !== 'object') {
    const parsed = normalizePositiveNumber(raw, null);
    return parsed ? { rowsPerSec: parsed } : null;
  }
  return raw;
};

const resolveObservedRowsPerSec = (grammarKey, observedRowsPerSecByGrammar) => {
  const entry = resolveObservedProfileEntry(grammarKey, observedRowsPerSecByGrammar);
  if (!entry) return null;
  return normalizePositiveNumber(entry?.rowsPerSec, null);
};

const resolveObservedCostPerSec = (grammarKey, observedRowsPerSecByGrammar) => {
  const entry = resolveObservedProfileEntry(grammarKey, observedRowsPerSecByGrammar);
  if (!entry) return null;
  return normalizePositiveNumber(entry?.costPerSec, null);
};

const resolveObservedTailDurationMs = (grammarKey, observedRowsPerSecByGrammar) => {
  const entry = resolveObservedProfileEntry(grammarKey, observedRowsPerSecByGrammar);
  if (!entry) return null;
  return normalizePositiveNumber(entry?.tailDurationMs, null);
};

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

const summarizeLoadDistribution = (loads) => {
  const normalized = Array.isArray(loads)
    ? loads.map((value) => Number(value) || 0)
    : [];
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
  const total = normalized.reduce((sum, value) => sum + value, 0);
  const avg = total / normalized.length;
  const min = normalized.reduce((acc, value) => Math.min(acc, value), Number.POSITIVE_INFINITY);
  const max = normalized.reduce((acc, value) => Math.max(acc, value), Number.NEGATIVE_INFINITY);
  const nonZero = normalized.filter((value) => value > 0);
  const minNonZero = nonZero.length ? Math.min(...nonZero) : 0;
  const variance = normalized.reduce((sum, value) => {
    const delta = value - avg;
    return sum + (delta * delta);
  }, 0) / normalized.length;
  const stdDev = Math.sqrt(Math.max(0, variance));
  return {
    loads: normalized,
    total,
    avg,
    min,
    minNonZero,
    max,
    spreadRatio: minNonZero > 0 ? (max / minNonZero) : (max > 0 ? max : 0),
    imbalanceRatio: avg > 0 ? (max / avg) : 0,
    stdDev
  };
};

const summarizeBucketMetrics = (buckets) => {
  const list = Array.isArray(buckets) ? buckets : [];
  const costLoads = list.map((bucketJobs) => (
    (Array.isArray(bucketJobs) ? bucketJobs : [])
      .reduce((sum, job) => sum + resolveJobEstimatedParseCost(job), 0)
  ));
  const jobLoads = list.map((bucketJobs) => (
    Array.isArray(bucketJobs) ? bucketJobs.length : 0
  ));
  return {
    cost: summarizeLoadDistribution(costLoads),
    jobs: summarizeLoadDistribution(jobLoads)
  };
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
  for (const job of jobs) {
    const key = job?.containerPath || job?.virtualPath || '';
    const dirKey = toPosix(path.dirname(String(key || ''))).toLowerCase() || '.';
    if (!jobsByDir.has(dirKey)) jobsByDir.set(dirKey, []);
    jobsByDir.get(dirKey).push(job);
  }
  const groups = Array.from(jobsByDir.entries())
    .map(([dirKey, dirJobs]) => ({
      dirKey,
      dirJobs: dirJobs.slice().sort(sortJobs),
      dirEstimatedCost: dirJobs.reduce((sum, job) => sum + resolveJobEstimatedParseCost(job), 0)
    }))
    .sort((a, b) => {
      const costDelta = b.dirEstimatedCost - a.dirEstimatedCost;
      if (costDelta !== 0) return costDelta;
      const sizeDelta = b.dirJobs.length - a.dirJobs.length;
      if (sizeDelta !== 0) return sizeDelta;
      return compareStrings(a.dirKey, b.dirKey);
    });
  const totalEstimatedCost = jobs.reduce((sum, job) => sum + resolveJobEstimatedParseCost(job), 0);
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
      const sortedByCost = dirJobs.slice().sort((a, b) => {
        const costDelta = resolveJobEstimatedParseCost(b) - resolveJobEstimatedParseCost(a);
        if (costDelta !== 0) return costDelta;
        return sortJobs(a, b);
      });
      for (const job of sortedByCost) {
        const jobCost = resolveJobEstimatedParseCost(job);
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
  return buckets.map((bucketJobs) => bucketJobs.sort(sortJobs));
};

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
    const bucketEstimatedCost = bucketJobs.reduce((sum, job) => sum + resolveJobEstimatedParseCost(job), 0);
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

const splitGrammarBucketIntoWaves = ({
  group,
  schedulerConfig = {},
  observedRowsPerSecByGrammar = null
}) => {
  const jobs = Array.isArray(group?.jobs) ? group.jobs : [];
  if (!jobs.length) return [];
  const totalEstimatedCost = jobs.reduce((sum, job) => sum + resolveJobEstimatedParseCost(job), 0);
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

const buildContinuousWaveExecutionOrder = (groups) => {
  const byBucket = new Map();
  const entries = Array.isArray(groups) ? groups : [];
  for (const group of entries) {
    if (!group?.grammarKey) continue;
    const bucketKey = group.bucketKey || group.grammarKey;
    if (!byBucket.has(bucketKey)) byBucket.set(bucketKey, []);
    byBucket.get(bucketKey).push(group);
  }
  const bucketKeys = Array.from(byBucket.keys()).sort(compareStrings);
  let maxWaveCount = 1;
  for (const bucketKey of bucketKeys) {
    const list = byBucket.get(bucketKey) || [];
    list.sort((a, b) => {
      const waveA = Number(a?.wave?.waveIndex || 1);
      const waveB = Number(b?.wave?.waveIndex || 1);
      if (waveA !== waveB) return waveA - waveB;
      return compareStrings(a?.grammarKey || '', b?.grammarKey || '');
    });
    const waveCount = list.reduce((max, item) => (
      Math.max(
        max,
        Number(item?.wave?.waveIndex || 1),
        Number(item?.wave?.waveCount || 1)
      )
    ), 1);
    maxWaveCount = Math.max(maxWaveCount, waveCount);
  }
  const order = [];
  for (let waveIndex = 1; waveIndex <= maxWaveCount; waveIndex += 1) {
    for (const bucketKey of bucketKeys) {
      const list = byBucket.get(bucketKey) || [];
      const next = list.find((item) => Number(item?.wave?.waveIndex || 1) === waveIndex);
      if (next?.grammarKey) order.push(next.grammarKey);
    }
  }
  return order.length ? order : entries.map((group) => group.grammarKey).filter(Boolean);
};

const buildLaneDiagnostics = (groups) => {
  const byBaseGrammar = new Map();
  const entries = Array.isArray(groups) ? groups : [];
  for (const group of entries) {
    if (!group?.grammarKey) continue;
    const baseGrammarKey = group.baseGrammarKey || group.grammarKey;
    if (!byBaseGrammar.has(baseGrammarKey)) byBaseGrammar.set(baseGrammarKey, []);
    byBaseGrammar.get(baseGrammarKey).push(group);
  }
  const diagnosticsByBaseGrammar = {};
  const imbalanceRatios = [];
  for (const [baseGrammarKey, items] of byBaseGrammar.entries()) {
    const bucketCostByKey = new Map();
    const bucketJobsByKey = new Map();
    const waveCountsByBucketKey = new Map();
    let totalJobs = 0;
    let totalEstimatedCost = 0;
    let highCardinality = false;
    for (const group of items) {
      const bucketKey = group.bucketKey || group.grammarKey;
      const jobs = Array.isArray(group.jobs) ? group.jobs.length : 0;
      const estimatedParseCost = normalizePositiveNumber(
        group.estimatedParseCost,
        Array.isArray(group.jobs)
          ? group.jobs.reduce((sum, job) => sum + resolveJobEstimatedParseCost(job), 0)
          : 0
      ) || 0;
      totalJobs += jobs;
      totalEstimatedCost += estimatedParseCost;
      bucketCostByKey.set(bucketKey, (bucketCostByKey.get(bucketKey) || 0) + estimatedParseCost);
      bucketJobsByKey.set(bucketKey, (bucketJobsByKey.get(bucketKey) || 0) + jobs);
      waveCountsByBucketKey.set(bucketKey, (waveCountsByBucketKey.get(bucketKey) || 0) + 1);
      if (group?.laneMetrics?.highCardinality === true) highCardinality = true;
    }
    const bucketCostLoads = Array.from(bucketCostByKey.values());
    const bucketJobLoads = Array.from(bucketJobsByKey.values());
    const bucketCostStats = summarizeLoadDistribution(bucketCostLoads);
    const bucketJobStats = summarizeLoadDistribution(bucketJobLoads);
    const waveDepthStats = summarizeLoadDistribution(Array.from(waveCountsByBucketKey.values()));
    imbalanceRatios.push(bucketCostStats.imbalanceRatio || 0);
    diagnosticsByBaseGrammar[baseGrammarKey] = {
      bucketCount: bucketCostLoads.length,
      totalJobs,
      totalEstimatedCost,
      avgEstimatedCostPerJob: totalJobs > 0 ? (totalEstimatedCost / totalJobs) : 0,
      highCardinality,
      bucketCost: {
        avg: bucketCostStats.avg,
        max: bucketCostStats.max,
        min: bucketCostStats.min,
        imbalanceRatio: bucketCostStats.imbalanceRatio,
        spreadRatio: bucketCostStats.spreadRatio,
        stdDev: bucketCostStats.stdDev
      },
      bucketJobs: {
        avg: bucketJobStats.avg,
        max: bucketJobStats.max,
        min: bucketJobStats.min,
        imbalanceRatio: bucketJobStats.imbalanceRatio,
        spreadRatio: bucketJobStats.spreadRatio,
        stdDev: bucketJobStats.stdDev
      },
      waveDepth: {
        avg: waveDepthStats.avg,
        max: waveDepthStats.max,
        min: waveDepthStats.min
      }
    };
  }
  const imbalanceSummary = summarizeLoadDistribution(imbalanceRatios);
  return {
    byBaseGrammar: diagnosticsByBaseGrammar,
    summary: {
      grammarCount: Object.keys(diagnosticsByBaseGrammar).length,
      avgImbalanceRatio: imbalanceSummary.avg,
      maxImbalanceRatio: imbalanceSummary.max,
      minImbalanceRatio: imbalanceSummary.min
    }
  };
};

/**
 * Resolve planner I/O concurrency for scheduler plan building.
 * Uses explicit scheduler overrides when provided, otherwise derives from
 * host parallelism with an upper safety cap.
 *
 * @param {object|null|undefined} treeSitterConfig
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

  const sortedEntries = Array.isArray(entries) ? entries.slice() : [];
  sortedEntries.sort((a, b) => compareStrings(resolveEntrySortKey(a), resolveEntrySortKey(b)));
  const plannerIoConcurrency = resolvePlannerIoConcurrency(treeSitterConfig, sortedEntries.length);

  const entryResults = await runWithConcurrency(
    sortedEntries,
    plannerIoConcurrency,
    async (entry) => {
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
        group.jobs = group.jobs.filter((job) => !blockedSet.has(job.languageId));
        group.languages = new Set(Array.from(group.languages).filter((id) => !blockedSet.has(id)));
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
  const grammarKeys = Array.from(groups.keys()).sort(compareStrings);
  const baseGroupList = grammarKeys.map((grammarKey) => {
    const group = groups.get(grammarKey);
    group.jobs.sort(sortJobs);
    return {
      grammarKey,
      languages: Array.from(group.languages).sort(compareStrings),
      jobs: group.jobs
    };
  });
  const schedulerConfig = treeSitterConfig?.scheduler || {};
  const groupList = [];
  for (const group of baseGroupList) {
    const sharded = shardGrammarGroup({
      group,
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
  const finalGrammarKeys = groupList.map((group) => group.grammarKey).sort(compareStrings);
  const groupMeta = {};
  for (const group of groupList) {
    if (!group?.grammarKey) continue;
    const jobCount = Array.isArray(group.jobs) ? group.jobs.length : 0;
    const estimatedParseCost = normalizePositiveNumber(
      group.estimatedParseCost,
      Array.isArray(group.jobs)
        ? group.jobs.reduce((sum, job) => sum + resolveJobEstimatedParseCost(job), 0)
        : 0
    ) || 0;
    const laneMetrics = group?.laneMetrics && typeof group.laneMetrics === 'object'
      ? group.laneMetrics
      : {};
    const bucketCostMetrics = laneMetrics?.bucketMetrics?.cost || {};
    groupMeta[group.grammarKey] = {
      baseGrammarKey: group.baseGrammarKey || group.grammarKey,
      bucketKey: group.bucketKey || group.grammarKey,
      wave: group.wave || null,
      shard: group.shard || null,
      languages: Array.isArray(group.languages) ? group.languages : [],
      jobs: jobCount,
      estimatedParseCost,
      avgEstimatedParseCostPerJob: jobCount > 0 ? (estimatedParseCost / jobCount) : 0,
      highCardinality: laneMetrics?.highCardinality === true,
      targetJobs: normalizePositiveInt(laneMetrics?.targetJobs, null),
      targetCost: normalizePositiveNumber(laneMetrics?.targetCost, null),
      laneImbalanceRatio: normalizePositiveNumber(bucketCostMetrics?.imbalanceRatio, null),
      laneSpreadRatio: normalizePositiveNumber(bucketCostMetrics?.spreadRatio, null),
      laneState: laneMetrics?.laneState || null
    };
  }

  const plan = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    mode,
    repoRoot: runtime.root,
    repoCacheRoot: runtime?.repoCacheRoot || null,
    outDir,
    jobs: groupList.reduce((sum, group) => sum + group.jobs.length, 0),
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
