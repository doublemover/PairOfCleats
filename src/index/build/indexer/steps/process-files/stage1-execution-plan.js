import { showProgress } from '../../../../../shared/progress.js';
import { compareStrings } from '../../../../../shared/sort.js';
import { planShardBatches } from '../../../shards.js';
import {
  buildDeterministicShardMergePlan,
  resolveEntryOrderIndex,
  resolveShardSubsetId,
  resolveShardWorkItemMinOrderIndex
} from './ordering.js';

/**
 * Assign deterministic 1-based file indices used in logs and ownership ids.
 *
 * @param {object[]} entries
 * @returns {{hasPositiveLineCounts:boolean}}
 */
export const assignFileIndexes = (entries) => {
  let hasPositiveLineCounts = false;
  if (!Array.isArray(entries)) {
    return { hasPositiveLineCounts };
  }
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!entry || typeof entry !== 'object') continue;
    entry.fileIndex = i + 1;
    if (!hasPositiveLineCounts && Number.isFinite(entry.lines) && entry.lines > 0) {
      hasPositiveLineCounts = true;
    }
  }
  return { hasPositiveLineCounts };
};

/**
 * Build ordered-progress seed data from entry order indexes.
 *
 * `startOrderIndex` tracks the earliest explicitly known order index while
 * `expectedOrderIndices` includes fallback-indexed entries for strict
 * completion accounting.
 *
 * @param {object[]} entries
 * @returns {{startOrderIndex:number,expectedOrderIndices:number[]}}
 */
export const resolveOrderedEntryProgressPlan = (entries) => {
  const safeEntries = Array.isArray(entries) ? entries : [];
  let minIndex = null;
  const expected = new Set();
  for (let i = 0; i < safeEntries.length; i += 1) {
    const entry = safeEntries[i];
    if (!entry || typeof entry !== 'object') continue;
    const startValue = resolveEntryOrderIndex(entry, null);
    if (Number.isFinite(startValue)) {
      minIndex = minIndex == null ? startValue : Math.min(minIndex, startValue);
    }
    const expectedValue = resolveEntryOrderIndex(entry, i);
    if (Number.isFinite(expectedValue)) expected.add(Math.floor(expectedValue));
  }
  return {
    startOrderIndex: Number.isFinite(minIndex) ? Math.max(0, Math.floor(minIndex)) : 0,
    expectedOrderIndices: Array.from(expected).sort((a, b) => a - b)
  };
};

/**
 * Create a shared stage1 progress tracker that supports ordered and shard-local
 * progress updates without double-counting.
 *
 * @param {{
 *  total?:number,
 *  mode?:string,
 *  checkpoint?:object,
 *  onTick?:Function,
 *  showProgressFn?:Function
 * }} [input]
 * @returns {{
 *  progress:{total:number,count:number,tick:Function},
 *  markOrderedEntryComplete:Function
 * }}
 */
export const createStage1ProgressTracker = ({
  total = 0,
  mode = 'unknown',
  checkpoint = null,
  onTick = null,
  showProgressFn = showProgress
} = {}) => {
  const completedOrderIndexes = new Set();
  const progressReporter = typeof showProgressFn === 'function'
    ? showProgressFn
    : showProgress;
  const safeTotal = Number.isFinite(Number(total))
    ? Math.max(0, Math.floor(Number(total)))
    : 0;
  const progress = {
    total: safeTotal,
    count: 0,
    tick() {
      this.count += 1;
      if (typeof onTick === 'function') onTick(this.count);
      progressReporter('Files', this.count, this.total, { stage: 'processing', mode });
      checkpoint?.tick?.();
    }
  };
  /**
   * Advance progress exactly once per order index.
   *
   * @param {number|null} orderIndex
   * @param {{count:number,total:number,meta:object}|null} [shardProgress]
   * @returns {boolean}
   */
  const markOrderedEntryComplete = (orderIndex, shardProgress = null) => {
    if (!progress || typeof progress.tick !== 'function') return false;
    if (Number.isFinite(orderIndex)) {
      const normalizedOrderIndex = Math.floor(orderIndex);
      if (completedOrderIndexes.has(normalizedOrderIndex)) return false;
      completedOrderIndexes.add(normalizedOrderIndex);
    }
    progress.tick();
    if (shardProgress) {
      shardProgress.count += 1;
      progressReporter('Shard', shardProgress.count, shardProgress.total, shardProgress.meta);
    }
    return true;
  };
  return {
    progress,
    markOrderedEntryComplete
  };
};

const buildStage1ShardWorkPlan = ({
  shardExecutionPlan,
  shardIndexById,
  totals
}) => {
  const work = [];
  const totalShards = shardExecutionPlan.length;
  const totalFiles = totals.totalFiles;
  const totalLines = totals.totalLines;
  const totalBytes = totals.totalBytes;
  const totalCost = totals.totalCost;
  for (const shard of shardExecutionPlan) {
    const shardIndex = shardIndexById.get(shard.id) || 1;
    const fileCount = shard.entries.length;
    const costPerFile = shard.costMs && fileCount ? shard.costMs / fileCount : 0;
    const fileShare = totalFiles > 0 ? fileCount / totalFiles : 0;
    const lineCount = shard.lineCount || 0;
    const lineShare = totalLines > 0 ? lineCount / totalLines : 0;
    const byteCount = shard.byteCount || 0;
    const byteShare = totalBytes > 0 ? byteCount / totalBytes : 0;
    const costMs = shard.costMs || 0;
    const costShare = totalCost > 0 ? costMs / totalCost : 0;
    const share = Math.max(fileShare, lineShare, byteShare, costShare);
    let parts = 1;
    if (share > 0.05) parts = share > 0.1 ? 4 : 2;
    parts = Math.min(parts, Math.max(1, fileCount));
    if (parts <= 1) {
      work.push({
        shard,
        entries: shard.entries,
        partIndex: 1,
        partTotal: 1,
        predictedCostMs: costPerFile ? costPerFile * fileCount : costMs,
        shardIndex,
        shardTotal: totalShards
      });
      continue;
    }
    const perPart = Math.ceil(fileCount / parts);
    for (let i = 0; i < parts; i += 1) {
      const start = i * perPart;
      const end = Math.min(start + perPart, fileCount);
      if (start >= end) continue;
      const partCount = end - start;
      work.push({
        shard,
        entries: shard.entries.slice(start, end),
        partIndex: i + 1,
        partTotal: parts,
        predictedCostMs: costPerFile ? costPerFile * partCount : costMs / parts,
        shardIndex,
        shardTotal: totalShards
      });
    }
  }
  return work;
};

/**
 * Resolve stage1 shard execution queue/worker plan while preserving deterministic
 * merge metadata used by shard retries and ordered appender integration.
 *
 * @param {{
 *  shardPlan:object[],
 *  runtime:object,
 *  clusterModeEnabled?:boolean,
 *  clusterDeterministicMerge?:boolean
 * }} input
 * @returns {{
 *  shardExecutionPlan:object[],
 *  shardExecutionOrderById:Map<string,number>,
 *  totals:{totalFiles:number,totalLines:number,totalBytes:number,totalCost:number},
 *  shardWorkPlan:object[],
 *  shardMergePlan:object[],
 *  mergeOrderByShardId:Map<string,number>,
 *  shardBatches:object[][],
 *  shardConcurrency:number,
 *  perShardFileConcurrency:number,
 *  perShardImportConcurrency:number,
 *  perShardEmbeddingConcurrency:number
 * }}
 */
export const resolveStage1ShardExecutionQueuePlan = ({
  shardPlan,
  runtime,
  clusterModeEnabled = false,
  clusterDeterministicMerge = true
}) => {
  const shardExecutionPlan = [...shardPlan].sort((a, b) => {
    if (clusterModeEnabled && clusterDeterministicMerge) {
      return compareStrings(a.id, b.id);
    }
    const costDelta = (b.costMs || 0) - (a.costMs || 0);
    if (costDelta !== 0) return costDelta;
    const lineDelta = (b.lineCount || 0) - (a.lineCount || 0);
    if (lineDelta !== 0) return lineDelta;
    const sizeDelta = b.entries.length - a.entries.length;
    if (sizeDelta !== 0) return sizeDelta;
    return compareStrings(a.label || a.id, b.label || b.id);
  });
  const shardIndexById = new Map();
  const shardExecutionOrderById = new Map();
  for (let i = 0; i < shardExecutionPlan.length; i += 1) {
    const index = i + 1;
    const shardId = shardExecutionPlan[i]?.id;
    shardIndexById.set(shardId, index);
    shardExecutionOrderById.set(shardId, index);
  }
  const totals = {
    totalFiles: 0,
    totalLines: 0,
    totalBytes: 0,
    totalCost: 0
  };
  for (const shard of shardPlan) {
    totals.totalFiles += Array.isArray(shard?.entries) ? shard.entries.length : 0;
    totals.totalLines += shard?.lineCount || 0;
    totals.totalBytes += shard?.byteCount || 0;
    totals.totalCost += shard?.costMs || 0;
  }
  const shardWorkPlan = buildStage1ShardWorkPlan({
    shardExecutionPlan,
    shardIndexById,
    totals
  }).map((workItem) => ({
    ...workItem,
    subsetId: resolveShardSubsetId(workItem),
    firstOrderIndex: resolveShardWorkItemMinOrderIndex(workItem)
  }));
  const shardMergePlan = buildDeterministicShardMergePlan(shardWorkPlan);
  const mergeOrderBySubsetId = new Map(
    shardMergePlan.map((entry) => [entry.subsetId, entry.mergeIndex])
  );
  const mergeOrderByShardId = new Map();
  for (const entry of shardMergePlan) {
    const shardId = entry?.shardId;
    if (!shardId || mergeOrderByShardId.has(shardId)) continue;
    mergeOrderByShardId.set(shardId, entry.mergeIndex);
  }
  for (const workItem of shardWorkPlan) {
    workItem.mergeIndex = mergeOrderBySubsetId.get(workItem.subsetId) || null;
  }
  const defaultShardConcurrency = Math.max(
    1,
    Math.min(32, runtime.fileConcurrency, runtime.cpuConcurrency)
  );
  let shardConcurrency = Number.isFinite(runtime.shards?.cluster?.workerCount)
    ? Math.max(1, Math.floor(runtime.shards.cluster.workerCount))
    : (Number.isFinite(runtime.shards.maxWorkers)
      ? Math.max(1, Math.floor(runtime.shards.maxWorkers))
      : defaultShardConcurrency);
  shardConcurrency = Math.min(shardConcurrency, runtime.fileConcurrency);
  let shardBatches = planShardBatches(shardWorkPlan, shardConcurrency, {
    resolveWeight: (workItem) => Number.isFinite(workItem.predictedCostMs)
      ? workItem.predictedCostMs
      : (workItem.shard.costMs || workItem.shard.lineCount || workItem.entries.length || 0),
    resolveTieBreaker: (workItem) => {
      const shardId = workItem.shard?.id || workItem.shard?.label || '';
      const part = Number.isFinite(workItem.partIndex) ? workItem.partIndex : 0;
      return `${shardId}:${part}`;
    }
  });
  if (shardBatches.length) {
    shardBatches = shardBatches.map((batch) => [...batch].sort((a, b) => {
      const aOrder = Number.isFinite(a?.firstOrderIndex) ? a.firstOrderIndex : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isFinite(b?.firstOrderIndex) ? b.firstOrderIndex : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const aMerge = Number.isFinite(a?.mergeIndex) ? a.mergeIndex : Number.MAX_SAFE_INTEGER;
      const bMerge = Number.isFinite(b?.mergeIndex) ? b.mergeIndex : Number.MAX_SAFE_INTEGER;
      if (aMerge !== bMerge) return aMerge - bMerge;
      const aShard = a?.shard?.id || a?.shard?.label || '';
      const bShard = b?.shard?.id || b?.shard?.label || '';
      return compareStrings(aShard, bShard);
    }));
  }
  if (!shardBatches.length && shardWorkPlan.length) {
    shardBatches = [shardWorkPlan.slice()];
  }
  shardConcurrency = Math.max(1, shardBatches.length);
  const perShardFileConcurrency = Math.max(
    1,
    Math.min(4, Math.floor(runtime.fileConcurrency / shardConcurrency))
  );
  const perShardImportConcurrency = Math.max(1, Math.floor(runtime.importConcurrency / shardConcurrency));
  const baseEmbedConcurrency = Number.isFinite(runtime.embeddingConcurrency)
    ? runtime.embeddingConcurrency
    : runtime.cpuConcurrency;
  const perShardEmbeddingConcurrency = Math.max(
    1,
    Math.min(perShardFileConcurrency, Math.floor(baseEmbedConcurrency / shardConcurrency))
  );
  return {
    shardExecutionPlan,
    shardExecutionOrderById,
    totals,
    shardWorkPlan,
    shardMergePlan,
    mergeOrderByShardId,
    shardBatches,
    shardConcurrency,
    perShardFileConcurrency,
    perShardImportConcurrency,
    perShardEmbeddingConcurrency
  };
};
