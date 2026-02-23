import {
  createChunkMetaArtifactPaths,
  enqueueBinaryColumnarChunkMetaWrite,
  enqueueColumnarOrJsonChunkMetaWrites,
  enqueueJsonlChunkMetaWrites,
  logChunkMetaWriteMode,
  removeStaleChunkMetaArtifacts
} from './persistence.js';
import { createChunkMetaRowAssembly } from './row-assembly.js';
import { resolveChunkMetaWritePlan } from './write-plan.js';

// Comparator checks remain mandatory in row fanout merges ({ validateComparator: true }).

/**
 * Queue chunk-meta artifact writes for all enabled formats (json/jsonl/shards/
 * columnar/hot-cold split), adapting output strategy to measured row size and
 * configured byte budgets.
 *
 * @param {object} input
 * @returns {Promise<{orderingHash:string|null,orderingCount:number}>}
 */
export const enqueueChunkMetaArtifacts = async ({
  outDir,
  mode,
  chunkMetaIterator,
  chunkMetaPlan,
  maxJsonBytes,
  byteBudget = null,
  compression = null,
  gzipOptions = null,
  enqueueJsonArray,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel,
  stageCheckpoints
}) => {
  const chunkMetaCount = chunkMetaPlan.chunkMetaCount;
  const planState = await resolveChunkMetaWritePlan({
    outDir,
    mode,
    chunkMetaIterator,
    chunkMetaPlan,
    maxJsonBytes,
    byteBudget,
    stageCheckpoints
  });

  const paths = createChunkMetaArtifactPaths({ outDir, compression });
  await removeStaleChunkMetaArtifacts({
    paths,
    resolvedUseJsonl: planState.resolvedUseJsonl,
    resolvedUseShards: planState.resolvedUseShards,
    resolvedUseColumnar: planState.resolvedUseColumnar,
    chunkMetaBinaryColumnar: chunkMetaPlan?.chunkMetaBinaryColumnar,
    shouldWriteCompatChunkMetaJson: planState.shouldWriteCompatChunkMetaJson
  });

  logChunkMetaWriteMode({
    paths,
    resolvedUseJsonl: planState.resolvedUseJsonl,
    resolvedUseShards: planState.resolvedUseShards,
    resolvedUseColumnar: planState.resolvedUseColumnar,
    chunkMetaStreaming: chunkMetaPlan?.chunkMetaStreaming === true,
    enableHotColdSplit: planState.enableHotColdSplit
  });

  const sharedState = {
    preparedColumnarHotRows: null
  };

  if (planState.resolvedUseJsonl) {
    const rowAssembly = createChunkMetaRowAssembly({
      chunkMetaIterator,
      chunkMetaCount,
      collected: planState.collected,
      projectHotEntry: planState.projectHotEntry,
      projectColdEntry: planState.projectColdEntry,
      compatJsonPath: paths.compatJsonPath,
      shouldWriteCompatChunkMetaJson: planState.shouldWriteCompatChunkMetaJson
    });

    await enqueueJsonlChunkMetaWrites({
      paths,
      rowAssembly,
      chunkMetaCount,
      resolvedUseShards: planState.resolvedUseShards,
      resolvedMaxJsonBytes: planState.resolvedMaxJsonBytes,
      chunkMetaShardSize: chunkMetaPlan?.chunkMetaShardSize,
      compression,
      gzipOptions,
      streamingAdaptiveSharding: planState.streamingAdaptiveSharding,
      enableHotColdSplit: planState.enableHotColdSplit,
      shouldWriteCompatChunkMetaJson: planState.shouldWriteCompatChunkMetaJson,
      trimMetadata: planState.trimMetadata,
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel
    });
  } else {
    enqueueColumnarOrJsonChunkMetaWrites({
      paths,
      chunkMetaIterator,
      chunkMetaCount,
      resolvedUseColumnar: planState.resolvedUseColumnar,
      shouldWriteCompatChunkMetaJson: planState.shouldWriteCompatChunkMetaJson,
      outOfOrder: planState.outOfOrder,
      projectHotEntry: planState.projectHotEntry,
      enqueueWrite,
      enqueueJsonArray,
      addPieceFile,
      formatArtifactLabel,
      sharedState
    });
  }

  enqueueBinaryColumnarChunkMetaWrite({
    paths,
    chunkMetaBinaryColumnar: chunkMetaPlan?.chunkMetaBinaryColumnar === true,
    chunkMetaEstimatedJsonlBytes: chunkMetaPlan?.chunkMetaEstimatedJsonlBytes,
    chunkMetaCount,
    chunkMetaIterator,
    projectHotEntry: planState.projectHotEntry,
    outOfOrder: planState.outOfOrder,
    orderingHash: planState.orderingHash,
    orderingCount: planState.orderingCount,
    sharedState,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel
  });

  return {
    orderingHash: planState.orderingHash,
    orderingCount: planState.orderingCount
  };
};
