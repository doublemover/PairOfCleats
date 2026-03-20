import { toPosix } from '../../../../../shared/files.js';
import { toArray } from '../../../../../shared/iterables.js';
import { coercePositiveInt } from '../../../../../shared/number-coerce.js';
import { compareStrings } from '../../../../../shared/sort.js';
import { planShardBatches } from '../../../shards.js';
import {
  buildDeterministicShardMergePlan,
  resolveEntryOrderIndex,
  resolveShardSubsetId,
  resolveShardWorkItemMinOrderIndex
} from './ordering.js';

export const clampShardConcurrencyToRuntime = (runtime, requestedConcurrency) => {
  const requested = coercePositiveInt(requestedConcurrency) ?? 1;
  const caps = [
    coercePositiveInt(runtime?.fileConcurrency),
    coercePositiveInt(runtime?.cpuConcurrency),
    coercePositiveInt(runtime?.importConcurrency)
  ].filter((value) => Number.isFinite(value) && value > 0);
  if (!caps.length) return Math.max(1, requested);
  return Math.max(1, Math.min(requested, ...caps));
};

const compareShardWorkItemsForDeterministicMerge = (left, right) => {
  const aOrder = Number.isFinite(left?.firstOrderIndex) ? left.firstOrderIndex : Number.MAX_SAFE_INTEGER;
  const bOrder = Number.isFinite(right?.firstOrderIndex) ? right.firstOrderIndex : Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder - bOrder;
  const aMerge = Number.isFinite(left?.mergeIndex) ? left.mergeIndex : Number.MAX_SAFE_INTEGER;
  const bMerge = Number.isFinite(right?.mergeIndex) ? right.mergeIndex : Number.MAX_SAFE_INTEGER;
  if (aMerge !== bMerge) return aMerge - bMerge;
  const aShard = left?.shard?.id || left?.shard?.label || '';
  const bShard = right?.shard?.id || right?.shard?.label || '';
  return compareStrings(aShard, bShard);
};

export const sortShardBatchesByDeterministicMergeOrder = (shardBatches) => {
  if (!Array.isArray(shardBatches) || shardBatches.length === 0) return [];
  const sortedEntries = shardBatches.map((batch) => {
    const list = Array.isArray(batch) ? [...batch] : [];
    return list.sort(compareShardWorkItemsForDeterministicMerge);
  });
  return sortedEntries.sort((leftBatch, rightBatch) => {
    const leftHead = leftBatch[0] || null;
    const rightHead = rightBatch[0] || null;
    return compareShardWorkItemsForDeterministicMerge(leftHead, rightHead);
  });
};

export const assignFileIndexes = (entries) => {
  if (!Array.isArray(entries)) return;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!entry || typeof entry !== 'object') continue;
    entry.fileIndex = i + 1;
  }
};

export const resolveStableEntryOrderIndex = (entry, fallbackIndex = null) => {
  const explicitOrderIndex = resolveEntryOrderIndex(entry, null);
  if (Number.isFinite(explicitOrderIndex)) {
    return Math.floor(explicitOrderIndex);
  }
  if (Number.isFinite(entry?.fileIndex)) {
    return Math.max(0, Math.floor(entry.fileIndex) - 1);
  }
  if (Number.isFinite(fallbackIndex)) {
    return Math.max(0, Math.floor(fallbackIndex));
  }
  return null;
};

export const resolveOrderedEntryProgressPlan = (entries) => {
  const safeEntries = Array.isArray(entries) ? entries : [];
  let minIndex = null;
  const expected = new Set();
  const orderIndexToRel = new Map();
  for (let i = 0; i < safeEntries.length; i += 1) {
    const entry = safeEntries[i];
    if (!entry || typeof entry !== 'object') continue;
    const startValue = resolveStableEntryOrderIndex(entry, null);
    if (Number.isFinite(startValue)) {
      minIndex = minIndex == null ? startValue : Math.min(minIndex, startValue);
    }
    const expectedValue = resolveStableEntryOrderIndex(entry, i);
    if (Number.isFinite(expectedValue)) {
      const normalizedExpected = Math.floor(expectedValue);
      expected.add(normalizedExpected);
      if (!orderIndexToRel.has(normalizedExpected)) {
        const rel = entry.rel || toPosix(entry.abs || '');
        if (typeof rel === 'string' && rel) {
          orderIndexToRel.set(normalizedExpected, rel);
        }
      }
    }
  }
  return {
    startOrderIndex: Number.isFinite(minIndex) ? Math.max(0, Math.floor(minIndex)) : 0,
    expectedOrderIndices: Array.from(expected).sort((a, b) => a - b),
    orderIndexToRel
  };
};

export const resolveStage1OrderingIntegrity = ({
  expectedOrderIndices = [],
  completedOrderIndices = [],
  progressCount = 0,
  progressTotal = 0,
  terminalCount = null,
  committedCount = null,
  totalSeqCount = null
} = {}) => {
  const expected = Array.isArray(expectedOrderIndices)
    ? expectedOrderIndices
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .map((value) => Math.floor(value))
    : [];
  const expectedSet = new Set(expected);
  const completedSet = new Set();
  for (const value of toArray(completedOrderIndices)) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) continue;
    completedSet.add(Math.floor(parsed));
  }
  const missingIndices = [];
  for (const index of expectedSet) {
    if (!completedSet.has(index)) missingIndices.push(index);
  }
  missingIndices.sort((a, b) => a - b);
  const normalizedProgressCount = Math.max(0, Math.floor(Number(progressCount) || 0));
  const normalizedProgressTotal = Math.max(0, Math.floor(Number(progressTotal) || 0));
  const progressComplete = normalizedProgressTotal === 0
    || normalizedProgressCount >= normalizedProgressTotal;
  const normalizedTerminalCount = Number.isFinite(Number(terminalCount))
    ? Math.max(0, Math.floor(Number(terminalCount)))
    : null;
  const normalizedCommittedCount = Number.isFinite(Number(committedCount))
    ? Math.max(0, Math.floor(Number(committedCount)))
    : null;
  const normalizedTotalSeqCount = Number.isFinite(Number(totalSeqCount))
    ? Math.max(0, Math.floor(Number(totalSeqCount)))
    : null;
  const terminalComplete = normalizedTotalSeqCount == null
    || (normalizedTerminalCount != null && normalizedTerminalCount === normalizedTotalSeqCount);
  const commitComplete = normalizedTotalSeqCount == null
    || (normalizedCommittedCount != null && normalizedCommittedCount === normalizedTotalSeqCount);
  return {
    ok: missingIndices.length === 0 && progressComplete && terminalComplete && commitComplete,
    expectedCount: expectedSet.size,
    completedCount: completedSet.size,
    terminalCount: normalizedTerminalCount,
    committedCount: normalizedCommittedCount,
    totalSeqCount: normalizedTotalSeqCount,
    missingIndices,
    missingCount: missingIndices.length,
    progressComplete,
    progressCount: normalizedProgressCount,
    progressTotal: normalizedProgressTotal
  };
};

export const buildStage1ShardWorkPlan = ({
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
        shardIndex: shardIndexById.get(shard.id) || 1,
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
        shardIndex: shardIndexById.get(shard.id) || 1,
        shardTotal: totalShards
      });
    }
  }
  return work;
};

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
  const shardIndexById = new Map(
    shardExecutionPlan.map((shard, index) => [shard.id, index + 1])
  );
  const shardExecutionOrderById = new Map(
    shardExecutionPlan.map((shard, index) => [shard.id, index + 1])
  );
  const totals = {
    totalFiles: shardPlan.reduce((sum, shard) => sum + shard.entries.length, 0),
    totalLines: shardPlan.reduce((sum, shard) => sum + (shard.lineCount || 0), 0),
    totalBytes: shardPlan.reduce((sum, shard) => sum + (shard.byteCount || 0), 0),
    totalCost: shardPlan.reduce((sum, shard) => sum + (shard.costMs || 0), 0)
  };
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
  shardConcurrency = clampShardConcurrencyToRuntime(runtime, shardConcurrency);
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
    shardBatches = sortShardBatchesByDeterministicMergeOrder(shardBatches);
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
