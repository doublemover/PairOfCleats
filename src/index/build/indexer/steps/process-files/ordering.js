import { compareStrings } from '../../../../../shared/sort.js';

export const normalizeOwnershipSegment = (value, fallback = 'unknown') => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/[^a-zA-Z0-9._:-]+/g, '_');
};

/**
 * Resolve deterministic entry order index with compatibility fallbacks.
 *
 * @param {object} entry
 * @param {number|null} [fallbackIndex=null]
 * @returns {number|null}
 */
export const resolveEntryOrderIndex = (entry, fallbackIndex = null) => {
  if (Number.isFinite(entry?.orderIndex)) return Math.floor(entry.orderIndex);
  if (Number.isFinite(entry?.canonicalOrderIndex)) return Math.floor(entry.canonicalOrderIndex);
  if (Number.isFinite(fallbackIndex)) return Math.max(0, Math.floor(fallbackIndex));
  return null;
};

export const sortEntriesByOrderIndex = (entries) => {
  if (!Array.isArray(entries) || entries.length <= 1) {
    return Array.isArray(entries) ? entries : [];
  }
  return [...entries]
    .map((entry, index) => ({
      entry,
      index,
      orderIndex: resolveEntryOrderIndex(entry, index)
    }))
    .sort((a, b) => {
      const aOrder = Number.isFinite(a.orderIndex) ? a.orderIndex : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isFinite(b.orderIndex) ? b.orderIndex : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.index - b.index;
    })
    .map((item) => item.entry);
};

/**
 * Build stable shard subset id used for retries/merge-plan determinism.
 *
 * @param {object} workItem
 * @returns {string}
 */
export const resolveShardSubsetId = (workItem) => {
  const shardId = normalizeOwnershipSegment(
    String(workItem?.shard?.id || workItem?.shard?.label || 'unknown'),
    'unknown'
  );
  const partIndex = Number.isFinite(workItem?.partIndex)
    ? Math.max(1, Math.floor(workItem.partIndex))
    : 1;
  const partTotal = Number.isFinite(workItem?.partTotal)
    ? Math.max(partIndex, Math.floor(workItem.partTotal))
    : partIndex;
  return `${shardId}#${String(partIndex).padStart(4, '0')}/${String(partTotal).padStart(4, '0')}`;
};

/**
 * Resolve minimum order index represented by one shard work item.
 *
 * @param {object} workItem
 * @returns {number|null}
 */
export const resolveShardSubsetMinOrderIndex = (workItem) => {
  const list = Array.isArray(workItem?.entries) ? workItem.entries : [];
  let minIndex = null;
  for (let i = 0; i < list.length; i += 1) {
    const value = resolveEntryOrderIndex(list[i], i);
    if (!Number.isFinite(value)) continue;
    minIndex = minIndex == null ? value : Math.min(minIndex, value);
  }
  return Number.isFinite(minIndex) ? Math.floor(minIndex) : null;
};

/**
 * Resolve minimum order index represented by one shard work item.
 *
 * @param {object} workItem
 * @returns {number|null}
 */
export const resolveShardWorkItemMinOrderIndex = (workItem) => {
  const precomputed = Number(workItem?.firstOrderIndex);
  if (Number.isFinite(precomputed)) return Math.floor(precomputed);
  if (!workItem || typeof workItem !== 'object') return null;
  return resolveShardSubsetMinOrderIndex(workItem);
};

/**
 * Build deterministic merge order for sharded processing outputs.
 *
 * Primary sort key is minimum file order index, followed by shard id and part
 * metadata to guarantee stable merge ordering across runs.
 *
 * @param {object[]} [workItems=[]]
 * @returns {Array<{mergeIndex:number,subsetId:string,shardId:string|null,partIndex:number,partTotal:number,firstOrderIndex:number|null,fileCount:number}>}
 */
export const buildDeterministicShardMergePlan = (workItems = []) => {
  const list = Array.isArray(workItems)
    ? workItems.filter((workItem) => workItem && typeof workItem === 'object')
    : [];
  return list
    .map((workItem) => ({
      workItem,
      firstOrderIndex: resolveShardWorkItemMinOrderIndex(workItem)
    }))
    .sort((left, right) => {
      const aOrder = Number.isFinite(left.firstOrderIndex) ? left.firstOrderIndex : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isFinite(right.firstOrderIndex) ? right.firstOrderIndex : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const aShard = String(left.workItem?.shard?.id || left.workItem?.shard?.label || '');
      const bShard = String(right.workItem?.shard?.id || right.workItem?.shard?.label || '');
      const shardCmp = compareStrings(aShard, bShard);
      if (shardCmp !== 0) return shardCmp;
      const aPartIndex = Number.isFinite(left.workItem?.partIndex) ? Math.floor(left.workItem.partIndex) : 1;
      const bPartIndex = Number.isFinite(right.workItem?.partIndex) ? Math.floor(right.workItem.partIndex) : 1;
      if (aPartIndex !== bPartIndex) return aPartIndex - bPartIndex;
      const aPartTotal = Number.isFinite(left.workItem?.partTotal) ? Math.floor(left.workItem.partTotal) : 1;
      const bPartTotal = Number.isFinite(right.workItem?.partTotal) ? Math.floor(right.workItem.partTotal) : 1;
      return aPartTotal - bPartTotal;
    })
    .map((entry, index) => {
      const workItem = entry.workItem;
      return {
        mergeIndex: index + 1,
        subsetId: resolveShardSubsetId(workItem),
        shardId: workItem?.shard?.id || null,
        partIndex: Number.isFinite(workItem?.partIndex) ? Math.floor(workItem.partIndex) : 1,
        partTotal: Number.isFinite(workItem?.partTotal) ? Math.floor(workItem.partTotal) : 1,
        firstOrderIndex: Number.isFinite(entry.firstOrderIndex)
          ? entry.firstOrderIndex
          : null,
        fileCount: Array.isArray(workItem?.entries) ? workItem.entries.length : 0
      };
    });
};

/**
 * Resolve per-subset retry policy for clustered shard execution.
 *
 * @param {object} runtime
 * @returns {{enabled:boolean,maxSubsetRetries:number,retryDelayMs:number}}
 */
export const resolveClusterSubsetRetryConfig = (runtime) => {
  const clusterConfig = runtime?.shards?.cluster && typeof runtime.shards.cluster === 'object'
    ? runtime.shards.cluster
    : {};
  const maxSubsetRetries = Number.isFinite(Number(clusterConfig.maxSubsetRetries))
    ? Math.max(0, Math.floor(Number(clusterConfig.maxSubsetRetries)))
    : (clusterConfig.enabled === true ? 1 : 0);
  const retryDelayMs = Number.isFinite(Number(clusterConfig.retryDelayMs))
    ? Math.max(0, Math.floor(Number(clusterConfig.retryDelayMs)))
    : 250;
  return {
    enabled: maxSubsetRetries > 0,
    maxSubsetRetries,
    retryDelayMs
  };
};

/**
 * Execute shard subsets sequentially with bounded retry policy.
 *
 * @param {{
 *  workItems?:object[],
 *  executeWorkItem:Function,
 *  maxSubsetRetries?:number,
 *  retryDelayMs?:number,
 *  onRetry?:Function|null,
 *  isRetryableError?:Function|null
 * }} [input]
 * @returns {Promise<{attemptsBySubset:Record<string,number>,retriedSubsetIds:string[],recoveredSubsetIds:string[]}>}
 */
export const runShardSubsetsWithRetry = async ({
  workItems,
  executeWorkItem,
  maxSubsetRetries = 0,
  retryDelayMs = 0,
  onRetry = null,
  isRetryableError = null
} = {}) => {
  const list = Array.isArray(workItems)
    ? workItems.filter((workItem) => workItem && typeof workItem === 'object')
    : [];
  if (typeof executeWorkItem !== 'function') {
    throw new TypeError('executeWorkItem must be a function');
  }
  const normalizedMaxRetries = Number.isFinite(Number(maxSubsetRetries))
    ? Math.max(0, Math.floor(Number(maxSubsetRetries)))
    : 0;
  const normalizedRetryDelayMs = Number.isFinite(Number(retryDelayMs))
    ? Math.max(0, Math.floor(Number(retryDelayMs)))
    : 0;
  const maxAttempts = normalizedMaxRetries + 1;
  const attemptsBySubset = new Map();
  const retriedSubsetIds = new Set();
  const recoveredSubsetIds = new Set();
  for (const workItem of list) {
    const subsetId = resolveShardSubsetId(workItem);
    let attempt = 0;
    while (true) {
      attempt += 1;
      attemptsBySubset.set(subsetId, attempt);
      try {
        await executeWorkItem(workItem, {
          subsetId,
          attempt,
          maxAttempts,
          isRetry: attempt > 1
        });
        if (attempt > 1) recoveredSubsetIds.add(subsetId);
        break;
      } catch (err) {
        const retryable = typeof isRetryableError === 'function'
          ? isRetryableError(err)
          : err?.retryable !== false;
        const hasAttemptsLeft = attempt < maxAttempts;
        if (!retryable || !hasAttemptsLeft) {
          if (err && typeof err === 'object') {
            if (!('shardSubsetId' in err)) err.shardSubsetId = subsetId;
            err.shardSubsetAttempt = attempt;
            err.shardSubsetMaxAttempts = maxAttempts;
          }
          throw err;
        }
        retriedSubsetIds.add(subsetId);
        if (typeof onRetry === 'function') {
          await onRetry({
            workItem,
            subsetId,
            attempt,
            maxAttempts,
            error: err
          });
        }
        if (normalizedRetryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, normalizedRetryDelayMs));
        }
      }
    }
  }
  return {
    attemptsBySubset: Object.fromEntries(attemptsBySubset.entries()),
    retriedSubsetIds: Array.from(retriedSubsetIds),
    recoveredSubsetIds: Array.from(recoveredSubsetIds)
  };
};
