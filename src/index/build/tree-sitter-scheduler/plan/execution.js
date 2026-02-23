import { compareStrings } from '../../../../shared/sort.js';
import {
  normalizePositiveInt,
  normalizePositiveNumber,
  summarizeLoadDistribution,
  sumJobEstimatedParseCost
} from './metrics.js';

/**
 * Resolve per-group parse cost with fallback to aggregated job cost.
 *
 * @param {object} group
 * @returns {number}
 */
const resolveGroupEstimatedParseCost = (group) => {
  const jobs = Array.isArray(group?.jobs) ? group.jobs : [];
  return normalizePositiveNumber(
    group?.estimatedParseCost,
    sumJobEstimatedParseCost(jobs)
  ) || 0;
};

/**
 * Build deterministic interleaved execution order across bucket waves.
 *
 * @param {Array<object>} groups
 * @returns {string[]}
 */
export const buildContinuousWaveExecutionOrder = (groups) => {
  const entries = Array.isArray(groups) ? groups : [];
  const byBucket = new Map();
  for (const group of entries) {
    if (!group?.grammarKey) continue;
    const bucketKey = group.bucketKey || group.grammarKey;
    if (!byBucket.has(bucketKey)) byBucket.set(bucketKey, []);
    byBucket.get(bucketKey).push(group);
  }

  const bucketKeys = Array.from(byBucket.keys()).sort(compareStrings);
  const cursors = new Map();
  let maxWaveCount = 1;

  for (const bucketKey of bucketKeys) {
    const list = byBucket.get(bucketKey) || [];
    list.sort((a, b) => {
      const waveA = Number(a?.wave?.waveIndex || 1);
      const waveB = Number(b?.wave?.waveIndex || 1);
      if (waveA !== waveB) return waveA - waveB;
      return compareStrings(a?.grammarKey || '', b?.grammarKey || '');
    });
    cursors.set(bucketKey, 0);

    let waveCount = 1;
    for (const item of list) {
      waveCount = Math.max(
        waveCount,
        Number(item?.wave?.waveIndex || 1),
        Number(item?.wave?.waveCount || 1)
      );
    }
    maxWaveCount = Math.max(maxWaveCount, waveCount);
  }

  const order = [];
  for (let waveIndex = 1; waveIndex <= maxWaveCount; waveIndex += 1) {
    for (const bucketKey of bucketKeys) {
      const list = byBucket.get(bucketKey) || [];
      let cursor = cursors.get(bucketKey) || 0;
      while (cursor < list.length) {
        const candidate = list[cursor];
        const candidateWaveIndex = Number(candidate?.wave?.waveIndex || 1);
        if (candidateWaveIndex < waveIndex) {
          cursor += 1;
          continue;
        }
        if (candidateWaveIndex === waveIndex && candidate?.grammarKey) {
          order.push(candidate.grammarKey);
          cursor += 1;
        }
        break;
      }
      cursors.set(bucketKey, cursor);
    }
  }

  return order.length ? order : entries.map((group) => group.grammarKey).filter(Boolean);
};

/**
 * Build lane/bucket imbalance diagnostics for planner artifacts.
 *
 * @param {Array<object>} groups
 * @returns {{byBaseGrammar:object,summary:object}}
 */
export const buildLaneDiagnostics = (groups) => {
  const entries = Array.isArray(groups) ? groups : [];
  const byBaseGrammar = new Map();

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
      const estimatedParseCost = resolveGroupEstimatedParseCost(group);
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
 * Build final planner metadata derived from finalized group list.
 *
 * @param {Array<object>} groups
 * @returns {{finalGrammarKeys:Array<string>,groupMeta:object,totalJobs:number}}
 */
export const buildPlanGroupArtifacts = (groups) => {
  const entries = Array.isArray(groups) ? groups : [];
  const finalGrammarKeys = new Array(entries.length);
  const groupMeta = {};
  let totalJobs = 0;

  for (let index = 0; index < entries.length; index += 1) {
    const group = entries[index];
    const grammarKey = group?.grammarKey;
    finalGrammarKeys[index] = grammarKey;

    const jobs = Array.isArray(group?.jobs) ? group.jobs : [];
    const jobCount = jobs.length;
    totalJobs += jobCount;

    if (!grammarKey) continue;

    const estimatedParseCost = resolveGroupEstimatedParseCost(group);
    const laneMetrics = group?.laneMetrics && typeof group.laneMetrics === 'object'
      ? group.laneMetrics
      : {};
    const bucketCostMetrics = laneMetrics?.bucketMetrics?.cost || {};

    groupMeta[grammarKey] = {
      baseGrammarKey: group.baseGrammarKey || grammarKey,
      bucketKey: group.bucketKey || grammarKey,
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

  finalGrammarKeys.sort(compareStrings);
  return {
    finalGrammarKeys,
    groupMeta,
    totalJobs
  };
};
