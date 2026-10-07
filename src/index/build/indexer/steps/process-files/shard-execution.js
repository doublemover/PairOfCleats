import { toArray } from '../../../../../shared/iterables.js';
import { createShardRuntime } from '../process-files/runtime.js';
import { normalizeOwnershipSegment, runShardSubsetsWithRetry } from '../process-files/ordering.js';

/**
 * Execute the stage1 file-processing workload either as one direct pass or as a
 * multi-worker shard plan, while returning normalized shard summary metadata.
 *
 * @param {object} input
 * @returns {Promise<{shardSummary:object[],shardExecutionMeta:object}>}
 */
export const executeStage1ShardProcessing = async ({
  entries,
  runtime,
  state,
  envConfig,
  mode,
  relationsEnabled,
  shardPlan,
  initialShardSummary = [],
  shardQueuePlan = null,
  clusterModeEnabled = false,
  clusterDeterministicMerge = true,
  clusterRetryConfig = { enabled: false, maxSubsetRetries: 0, retryDelayMs: 0 },
  awaitStage1Barrier,
  processEntries,
  orderedAppender,
  abortProcessing,
  log,
  logLine
}) => {
  let shardSummary = Array.isArray(initialShardSummary) ? [...initialShardSummary] : [];
  let shardExecutionMeta = runtime.shards?.enabled
    ? {
      enabled: true,
      mode: clusterModeEnabled ? 'cluster' : 'local',
      mergeOrder: clusterDeterministicMerge ? 'stable' : 'adaptive',
      deterministicMerge: clusterDeterministicMerge,
      shardCount: Array.isArray(shardPlan) ? shardPlan.length : 0,
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
    }
    : { enabled: false };
  if (shardPlan && shardPlan.length > 1 && shardQueuePlan) {
    const {
      shardExecutionPlan,
      shardExecutionOrderById,
      totals: {
        totalFiles,
        totalLines,
        totalBytes,
        totalCost
      },
      shardWorkPlan,
      shardMergePlan,
      mergeOrderByShardId,
      shardBatches,
      shardConcurrency,
      perShardFileConcurrency,
      perShardImportConcurrency,
      perShardEmbeddingConcurrency
    } = shardQueuePlan;
    if (envConfig.verbose === true) {
      const top = shardExecutionPlan.slice(0, Math.min(10, shardExecutionPlan.length));
      const costLabel = totalCost ? `, est ${Math.round(totalCost).toLocaleString()}ms` : '';
      log(`→ Shard plan: ${shardPlan.length} shards, ${totalFiles.toLocaleString()} files, ${totalLines.toLocaleString()} lines${costLabel}.`);
      for (const shard of top) {
        const lineCount = shard.lineCount || 0;
        const byteCount = shard.byteCount || 0;
        const costMs = shard.costMs || 0;
        const costText = costMs ? ` | est ${Math.round(costMs).toLocaleString()}ms` : '';
        log(`[shards] ${shard.label || shard.id} | files ${shard.entries.length.toLocaleString()} | lines ${lineCount.toLocaleString()} | bytes ${byteCount.toLocaleString()}${costText}`);
      }
      const splitGroups = new Map();
      for (const shard of shardPlan) {
        if (!shard.splitFrom) continue;
        const group = splitGroups.get(shard.splitFrom) || { count: 0, lines: 0, bytes: 0, cost: 0 };
        group.count += 1;
        group.lines += shard.lineCount || 0;
        group.bytes += shard.byteCount || 0;
        group.cost += shard.costMs || 0;
        splitGroups.set(shard.splitFrom, group);
      }
      for (const [label, group] of splitGroups) {
        const costText = group.cost ? `, est ${Math.round(group.cost).toLocaleString()}ms` : '';
        log(`[shards] split ${label} -> ${group.count} parts (${group.lines.toLocaleString()} lines, ${group.bytes.toLocaleString()} bytes${costText})`);
      }
    }
    shardSummary = shardSummary.map((summary) => ({
      ...summary,
      executionOrder: shardExecutionOrderById.get(summary.id) || null,
      mergeOrder: mergeOrderByShardId.get(summary.id) || null
    }));
    const shardModeLabel = clusterModeEnabled ? 'cluster' : 'local';
    const mergeModeLabel = clusterDeterministicMerge ? 'stable' : 'adaptive';
    const clusterRetryEnabled = clusterModeEnabled && clusterRetryConfig.enabled;
    const retryStats = {
      retriedSubsetIds: new Set(),
      recoveredSubsetIds: new Set(),
      failedSubsetIds: new Set()
    };
    log(
      `→ Sharding enabled: ${shardPlan.length} shards `
        + `(mode=${shardModeLabel}, merge=${mergeModeLabel}, concurrency=${shardConcurrency}, `
        + `per-shard files=${perShardFileConcurrency}, subset-retry=${clusterRetryEnabled
          ? `${clusterRetryConfig.maxSubsetRetries}x@${clusterRetryConfig.retryDelayMs}ms`
          : 'off'}).`
    );
    const mergeOrderIds = shardMergePlan.map((entry) => entry.subsetId);
    if (clusterModeEnabled) {
      const preview = mergeOrderIds.slice(0, 12).join(', ');
      const overflow = mergeOrderIds.length > 12
        ? ` … (+${mergeOrderIds.length - 12} more)`
        : '';
      log(`[shards] deterministic merge order (${mergeModeLabel}): ${preview || 'none'}${overflow}`);
    }
    const workerContexts = shardBatches.map((batch, workerIndex) => ({
      workerId: `${shardModeLabel}-worker-${String(workerIndex + 1).padStart(2, '0')}`,
      workerIndex: workerIndex + 1,
      batch,
      subsetCount: batch.length
    }));
    /**
     * Execute one shard worker and normalize worker-level failures.
     *
     * @param {object} workerContext
     * @returns {Promise<object>}
     */
    const runShardWorker = async (workerContext) => {
      const { workerId, workerIndex, batch } = workerContext;
      const shardRuntime = createShardRuntime(runtime, {
        fileConcurrency: perShardFileConcurrency,
        importConcurrency: perShardImportConcurrency,
        embeddingConcurrency: perShardEmbeddingConcurrency
      });
      shardRuntime.clusterWorker = {
        id: workerId,
        index: workerIndex,
        mode: shardModeLabel
      };
      logLine(
        `[shards] worker ${workerId} starting (${batch.length} subset${batch.length === 1 ? '' : 's'})`,
        {
          kind: 'status',
          mode,
          stage: 'processing',
          shardWorkerId: workerId,
          shardWorkerIndex: workerIndex,
          shardWorkerSubsetCount: batch.length
        }
      );
      try {
        const retryResult = await runShardSubsetsWithRetry({
          workItems: batch,
          executeWorkItem: async (workItem, retryContext) => {
            const {
              shard,
              entries: shardEntries,
              partIndex,
              partTotal,
              shardIndex,
              shardTotal,
              subsetId,
              mergeIndex
            } = workItem;
            const shardLabel = shard.label || shard.id;
            let shardBracket = shardLabel === shard.id ? null : shard.id;
            if (partTotal > 1) {
              const partLabel = `part ${partIndex}/${partTotal}`;
              shardBracket = shardBracket ? `${shardBracket} ${partLabel}` : partLabel;
            }
            const shardDisplay = shardLabel + (shardBracket ? ` [${shardBracket}]` : '');
            log(
              `→ Shard ${shardIndex}/${shardTotal}: ${shardDisplay} (${shardEntries.length} files)`
                + ` [worker=${workerId} subset=${subsetId} merge=${mergeIndex ?? '?'} `
                + `attempt=${retryContext.attempt}/${retryContext.maxAttempts}]`,
              {
                shardId: shard.id,
                shardIndex,
                shardTotal,
                partIndex,
                partTotal,
                fileCount: shardEntries.length,
                shardWorkerId: workerId,
                shardSubsetId: subsetId,
                shardSubsetMergeOrder: mergeIndex ?? null,
                shardSubsetAttempt: retryContext.attempt,
                shardSubsetMaxAttempts: retryContext.maxAttempts
              }
            );
            await awaitStage1Barrier(processEntries({
              entries: shardEntries,
              runtime: shardRuntime,
              shardMeta: {
                ...shard,
                partIndex,
                partTotal,
                shardIndex,
                shardTotal,
                display: shardDisplay,
                subsetId,
                workerId,
                mergeIndex,
                attempt: retryContext.attempt,
                maxAttempts: retryContext.maxAttempts,
                allowRetry: clusterRetryEnabled
              },
              stateRef: state
            }));
          },
          maxSubsetRetries: clusterRetryEnabled ? clusterRetryConfig.maxSubsetRetries : 0,
          retryDelayMs: clusterRetryEnabled ? clusterRetryConfig.retryDelayMs : 0,
          onRetry: ({ subsetId, attempt, maxAttempts, error }) => {
            logLine(
              `[shards] retrying subset ${subsetId} `
                + `(attempt ${attempt + 1}/${maxAttempts}): ${error?.message || error}`,
              {
                kind: 'warning',
                mode,
                stage: 'processing',
                shardWorkerId: workerId,
                shardSubsetId: subsetId,
                shardSubsetAttempt: attempt,
                shardSubsetMaxAttempts: maxAttempts,
                shardSubsetRetrying: true
              }
            );
          }
        });
        for (const subsetId of toArray(retryResult.retriedSubsetIds)) {
          retryStats.retriedSubsetIds.add(subsetId);
        }
        for (const subsetId of toArray(retryResult.recoveredSubsetIds)) {
          retryStats.recoveredSubsetIds.add(subsetId);
        }
        logLine(
          `[shards] worker ${workerId} complete (${batch.length} subset${batch.length === 1 ? '' : 's'})`,
          {
            kind: 'status',
            mode,
            stage: 'processing',
            shardWorkerId: workerId,
            shardWorkerIndex: workerIndex,
            shardWorkerSubsetCount: batch.length
          }
        );
      } finally {
        await shardRuntime.destroy?.();
      }
    };
    const workerResults = await awaitStage1Barrier(Promise.allSettled(
      workerContexts.map((workerContext) => runShardWorker(workerContext))
    ));
    const workerFailures = workerResults
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    for (const failure of workerFailures) {
      const subsetId = failure?.shardSubsetId;
      if (subsetId) retryStats.failedSubsetIds.add(subsetId);
    }
    if (workerFailures.length) {
      const firstFailure = workerFailures[0] || new Error('shard worker failed');
      orderedAppender.abort(firstFailure);
      abortProcessing(firstFailure);
      throw firstFailure;
    }
    shardExecutionMeta = {
      enabled: true,
      mode: shardModeLabel,
      mergeOrder: mergeModeLabel,
      deterministicMerge: clusterDeterministicMerge,
      shardCount: shardPlan.length,
      subsetCount: shardWorkPlan.length,
      workerCount: workerContexts.length,
      workers: workerContexts.map((workerContext) => ({
        workerId: workerContext.workerId,
        subsetCount: workerContext.subsetCount,
        subsetIds: workerContext.batch.map((workItem) => workItem.subsetId)
      })),
      mergeOrderCount: mergeOrderIds.length,
      mergeOrderPreview: mergeOrderIds.slice(0, 64),
      mergeOrderTail: mergeOrderIds.length > 64
        ? mergeOrderIds.slice(-8)
        : [],
      retry: {
        enabled: clusterRetryEnabled,
        maxSubsetRetries: clusterRetryEnabled ? clusterRetryConfig.maxSubsetRetries : 0,
        retryDelayMs: clusterRetryEnabled ? clusterRetryConfig.retryDelayMs : 0,
        attemptedSubsets: shardWorkPlan.length,
        retriedSubsets: retryStats.retriedSubsetIds.size,
        recoveredSubsets: retryStats.recoveredSubsetIds.size,
        failedSubsets: retryStats.failedSubsetIds.size
      }
    };
  } else {
    await awaitStage1Barrier(processEntries({ entries, runtime, stateRef: state }));
    if (runtime.shards?.enabled) {
      shardSummary = shardSummary.map((summary, index) => ({
        ...summary,
        executionOrder: index + 1,
        mergeOrder: index + 1
      }));
      const defaultSubsetId = shardSummary[0]?.id
        ? `${normalizeOwnershipSegment(shardSummary[0].id, 'unknown')}#0001/0001`
        : null;
      shardExecutionMeta = {
        ...shardExecutionMeta,
        shardCount: shardSummary.length,
        subsetCount: shardSummary.length,
        workerCount: 1,
        workers: [{
          workerId: `${clusterModeEnabled ? 'cluster' : 'local'}-worker-01`,
          subsetCount: shardSummary.length,
          subsetIds: defaultSubsetId ? [defaultSubsetId] : []
        }],
        mergeOrderCount: defaultSubsetId ? 1 : 0,
        mergeOrderPreview: defaultSubsetId ? [defaultSubsetId] : [],
        mergeOrderTail: [],
        retry: {
          enabled: false,
          maxSubsetRetries: 0,
          retryDelayMs: 0,
          attemptedSubsets: shardSummary.length,
          retriedSubsets: 0,
          recoveredSubsets: 0,
          failedSubsets: 0
        }
      };
    }
  }
  return {
    shardSummary,
    shardExecutionMeta
  };
};
