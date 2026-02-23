import { countLinesForEntries } from '../../../../../shared/file-stats.js';
import { planShards } from '../../../shards.js';

/**
 * Resolve stage1 shard feature weights used by shard planning heuristics.
 *
 * @param {{relationsEnabled?:boolean,runtime?:object}} [input]
 * @returns {{relations:number,flow:number,treeSitter:number,tooling:number,embeddings:number}}
 */
export const buildShardFeatureWeights = ({
  relationsEnabled = false,
  runtime = null
} = {}) => ({
  relations: relationsEnabled ? 0.15 : 0,
  flow: (runtime?.astDataflowEnabled || runtime?.controlFlowEnabled) ? 0.1 : 0,
  treeSitter: runtime?.languageOptions?.treeSitter?.enabled !== false ? 0.1 : 0,
  tooling: runtime?.toolingEnabled ? 0.1 : 0,
  embeddings: runtime?.embeddingEnabled ? 0.2 : 0
});

/**
 * Build public shard-summary rows persisted to timing/manifest payloads.
 *
 * @param {object[]|null} shardPlan
 * @returns {object[]}
 */
export const buildShardSummary = (shardPlan) => {
  if (!Array.isArray(shardPlan) || shardPlan.length === 0) return [];
  const summary = new Array(shardPlan.length);
  for (let i = 0; i < shardPlan.length; i += 1) {
    const shard = shardPlan[i] || {};
    const entries = Array.isArray(shard.entries) ? shard.entries : [];
    summary[i] = {
      id: shard.id,
      label: shard.label || shard.id,
      dir: shard.dir,
      lang: shard.lang,
      fileCount: entries.length,
      lineCount: shard.lineCount || 0,
      byteCount: shard.byteCount || 0,
      costMs: shard.costMs || 0
    };
  }
  return summary;
};

/**
 * Seed shard execution metadata before worker/subset scheduling starts.
 *
 * @param {{
 *  shardsEnabled?:boolean,
 *  clusterModeEnabled?:boolean,
 *  clusterDeterministicMerge?:boolean,
 *  shardCount?:number
 * }} [input]
 * @returns {object}
 */
export const createInitialShardExecutionMeta = ({
  shardsEnabled = false,
  clusterModeEnabled = false,
  clusterDeterministicMerge = true,
  shardCount = 0
} = {}) => {
  if (!shardsEnabled) return { enabled: false };
  return {
    enabled: true,
    mode: clusterModeEnabled ? 'cluster' : 'local',
    mergeOrder: clusterDeterministicMerge ? 'stable' : 'adaptive',
    deterministicMerge: clusterDeterministicMerge,
    shardCount: Number.isFinite(shardCount) ? Math.max(0, Math.floor(shardCount)) : 0,
    subsetCount: 0,
    workerCount: 1,
    workers: [],
    mergeOrderCount: 0,
    mergeOrderPreview: [],
    mergeOrderTail: [],
    retry: {
      enabled: false,
      maxSubsetRetries: 0,
      retryDelayMs: 0,
      attemptedSubsets: 0,
      retriedSubsets: 0,
      recoveredSubsets: 0,
      failedSubsets: 0
    }
  };
};

/**
 * Resolve shard preflight state before queue planning/worker execution.
 *
 * Sequencing-sensitive: call this after `assignFileIndexes()` so
 * `hasPositiveLineCounts` can reuse the same entry pass and avoid an extra
 * full-array scan before shard planning.
 *
 * @param {{
 *  entries:object[],
 *  runtime:object,
 *  mode:string,
 *  relationsEnabled?:boolean,
 *  shardPerfProfile?:object|null,
 *  discoveryLineCounts?:Map<string,number>|null,
 *  hasPositiveLineCounts?:boolean,
 *  timing?:object|null,
 *  verbose?:boolean,
 *  log?:Function,
 *  countLinesForEntriesFn?:Function,
 *  planShardsFn?:Function
 * }} input
 * @returns {Promise<{
 *  clusterModeEnabled:boolean,
 *  clusterDeterministicMerge:boolean,
 *  lineCounts:Map<string,number>|null,
 *  shardFeatureWeights:object,
 *  shardPlan:object[]|null,
 *  shardSummary:object[],
 *  shardExecutionMeta:object
 * }>}
 */
export const resolveShardPlanningPreflight = async ({
  entries,
  runtime,
  mode,
  relationsEnabled = false,
  shardPerfProfile = null,
  discoveryLineCounts = null,
  hasPositiveLineCounts = false,
  timing = null,
  verbose = false,
  log = () => {},
  countLinesForEntriesFn = countLinesForEntries,
  planShardsFn = planShards
}) => {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const runCountLinesForEntries = typeof countLinesForEntriesFn === 'function'
    ? countLinesForEntriesFn
    : countLinesForEntries;
  const runPlanShards = typeof planShardsFn === 'function'
    ? planShardsFn
    : planShards;
  const shardsEnabled = runtime?.shards?.enabled === true;
  const clusterModeEnabled = runtime?.shards?.cluster?.enabled === true;
  const clusterDeterministicMerge = runtime?.shards?.cluster?.deterministicMerge !== false;
  let lineCounts = discoveryLineCounts instanceof Map ? discoveryLineCounts : null;
  if (shardsEnabled && !lineCounts && hasPositiveLineCounts !== true) {
    const lineStart = Date.now();
    const cpuConcurrency = Number.isFinite(runtime?.cpuConcurrency)
      ? Math.max(1, Math.floor(runtime.cpuConcurrency))
      : 1;
    const lineConcurrency = Math.max(1, Math.min(128, cpuConcurrency * 2));
    if (verbose === true) {
      log(`→ Shard planning: counting lines (${lineConcurrency} workers)...`);
    }
    lineCounts = await runCountLinesForEntries(safeEntries, { concurrency: lineConcurrency });
    if (timing && typeof timing === 'object') {
      timing.lineCountsMs = Date.now() - lineStart;
    }
  }
  const shardFeatureWeights = buildShardFeatureWeights({
    relationsEnabled,
    runtime
  });
  const shardPlan = shardsEnabled
    ? runPlanShards(safeEntries, {
      mode,
      maxShards: runtime.shards.maxShards,
      minFiles: runtime.shards.minFiles,
      dirDepth: runtime.shards.dirDepth,
      lineCounts,
      perfProfile: shardPerfProfile,
      featureWeights: shardFeatureWeights,
      maxShardBytes: runtime.shards.maxShardBytes,
      maxShardLines: runtime.shards.maxShardLines
    })
    : null;
  return {
    clusterModeEnabled,
    clusterDeterministicMerge,
    lineCounts,
    shardFeatureWeights,
    shardPlan,
    shardSummary: buildShardSummary(shardPlan),
    shardExecutionMeta: createInitialShardExecutionMeta({
      shardsEnabled,
      clusterModeEnabled,
      clusterDeterministicMerge,
      shardCount: Array.isArray(shardPlan) ? shardPlan.length : 0
    })
  };
};
