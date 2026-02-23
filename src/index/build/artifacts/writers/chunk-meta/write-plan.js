import { log } from '../../../../../shared/progress.js';
import { MAX_JSON_BYTES } from '../../../../../shared/artifact-io.js';
import { ensureDiskSpace, formatBytes } from '../../../../../shared/disk-space.js';
import {
  extractChunkMetaColdFields,
  stripChunkMetaColdFields
} from '../../../../../shared/chunk-meta-cold.js';
import { isTestingEnv } from '../../../../../shared/env.js';
import { recordArtifactTelemetry } from '../../helpers.js';
import { buildTrimMetadata } from '../../trim-policy.js';
import { applyByteBudget } from '../../../byte-budget.js';
import {
  createChunkMetaBucketCollector,
  mapRows,
  resolveChunkMetaMaxBytes,
  serializeAndCacheRow
} from './shared.js';
import { analyzeChunkMetaRows } from './scan.js';
import {
  COMPAT_CHUNK_META_JSON_MAX_BYTES,
  COMPAT_CHUNK_META_JSON_MAX_ROWS
} from './constants.js';

/**
 * Resolve chunk-meta output strategy, collect ordering stats, and emit stage telemetry.
 *
 * @param {object} input
 * @param {string} input.outDir
 * @param {string|null} [input.mode]
 * @param {(start?:number,end?:number,trackStats?:boolean)=>IterableIterator<object>} input.chunkMetaIterator
 * @param {object} input.chunkMetaPlan
 * @param {number|null} [input.maxJsonBytes]
 * @param {object|null} [input.byteBudget]
 * @param {object|null} [input.stageCheckpoints]
 * @returns {Promise<object>}
 */
export const resolveChunkMetaWritePlan = async ({
  outDir,
  mode,
  chunkMetaIterator,
  chunkMetaPlan,
  maxJsonBytes = MAX_JSON_BYTES,
  byteBudget = null,
  stageCheckpoints
}) => {
  const {
    chunkMetaFormat,
    chunkMetaStreaming,
    chunkMetaUseJsonl,
    chunkMetaUseShards,
    chunkMetaUseColumnar,
    chunkMetaEstimatedJsonlBytes,
    chunkMetaShardSize,
    chunkMetaCount,
    maxJsonBytes: plannedMaxJsonBytes
  } = chunkMetaPlan;
  const resolvedMaxJsonBytes = resolveChunkMetaMaxBytes(plannedMaxJsonBytes ?? maxJsonBytes);
  let enableHotColdSplit = chunkMetaStreaming !== true;
  const projectHotEntry = (entry) => (
    enableHotColdSplit ? stripChunkMetaColdFields(entry) : entry
  );
  const projectColdEntry = (entry) => (
    enableHotColdSplit ? extractChunkMetaColdFields(entry) : null
  );
  const scanChunkMeta = ({ collectRows = false } = {}) => (
    analyzeChunkMetaRows({
      chunkMetaIterator,
      chunkMetaCount,
      resolvedMaxJsonBytes,
      projectHotEntry,
      projectColdEntry,
      collectRows,
      includeJsonArrayBytes: false
    })
  );
  const measureChunkMeta = () => (
    analyzeChunkMetaRows({
      chunkMetaIterator,
      chunkMetaCount,
      resolvedMaxJsonBytes,
      projectHotEntry,
      projectColdEntry,
      collectRows: false,
      includeJsonArrayBytes: true
    })
  );

  let resolvedUseJsonl = chunkMetaUseJsonl;
  let resolvedUseShards = chunkMetaUseShards;
  let resolvedUseColumnar = chunkMetaUseColumnar;
  let streamingAdaptiveSharding = false;
  let measured = null;
  let collected = null;
  let jsonlScan = null;
  let outOfOrder = false;
  let firstOutOfOrder = null;

  if (chunkMetaStreaming && resolvedUseJsonl) {
    resolvedUseColumnar = false;
    resolvedUseShards = chunkMetaShardSize > 0 && chunkMetaCount > chunkMetaShardSize;
    if (!resolvedUseShards) {
      // Streaming mode avoids a full pre-scan, so force byte-bounded shard writes.
      // If the output fits in a single part we promote it back to chunk_meta.jsonl.
      if (chunkMetaCount > 0) {
        resolvedUseShards = true;
        streamingAdaptiveSharding = true;
      }
    }
  }

  if (!resolvedUseJsonl) {
    measured = chunkMetaCount
      ? measureChunkMeta()
      : { totalJsonBytes: 2, totalJsonlBytes: 0, total: 0 };
    if (resolvedMaxJsonBytes && measured.totalJsonBytes > resolvedMaxJsonBytes) {
      resolvedUseColumnar = false;
      resolvedUseJsonl = true;
      resolvedUseShards = true;
      log(
        `Chunk metadata measured ~${formatBytes(measured.totalJsonBytes)}; ` +
        `using jsonl-sharded to stay under ${formatBytes(resolvedMaxJsonBytes)}.`
      );
    }
  }

  if (resolvedUseJsonl && !chunkMetaStreaming) {
    jsonlScan = scanChunkMeta({ collectRows: false });
    outOfOrder = !jsonlScan.ordered;
    firstOutOfOrder = jsonlScan.firstOutOfOrder;
    if (firstOutOfOrder) {
      log(
        `[chunk_meta] out-of-order ids detected (prev=${firstOutOfOrder.prevId ?? 'null'}, ` +
        `next=${firstOutOfOrder.nextId ?? 'null'}).`
      );
    }
    if (jsonlScan.firstIdMismatch) {
      log(
        `[chunk_meta] docId alignment mismatch at index ${jsonlScan.firstIdMismatch.index} ` +
        `(id=${jsonlScan.firstIdMismatch.id ?? 'null'}).`
      );
    }
    if (resolvedMaxJsonBytes && jsonlScan.totalJsonlBytes > resolvedMaxJsonBytes) {
      resolvedUseShards = true;
      if (!chunkMetaUseShards) {
        log(
          `Chunk metadata measured ~${formatBytes(jsonlScan.totalJsonlBytes)}; ` +
          `using jsonl-sharded to stay under ${formatBytes(resolvedMaxJsonBytes)}.`
        );
      }
    }
    if (outOfOrder) {
      if (enableHotColdSplit) {
        enableHotColdSplit = false;
        jsonlScan.coldJsonlBytes = 0;
      }
      const collector = createChunkMetaBucketCollector({
        outDir,
        maxJsonBytes: resolvedMaxJsonBytes,
        chunkMetaCount
      });
      // Bucket-by-id keeps each run mergeable without a full in-memory sort.
      const rowsForCollector = mapRows(
        chunkMetaIterator(0, chunkMetaCount, false),
        (entry) => projectHotEntry(entry)
      );
      for (const hotEntry of rowsForCollector) {
        const { line, lineBytes } = serializeAndCacheRow(hotEntry);
        const rowBytes = lineBytes + 1;
        if (resolvedMaxJsonBytes && rowBytes > resolvedMaxJsonBytes) {
          throw new Error(`chunk_meta entry exceeds max JSON size (${rowBytes} bytes).`);
        }
        await collector.append(hotEntry, { line, lineBytes: rowBytes });
      }
      collected = await collector.finalize();
    }
  } else if (resolvedUseJsonl) {
    jsonlScan = {
      totalJsonlBytes: Number.isFinite(chunkMetaEstimatedJsonlBytes)
        ? Math.max(0, Math.floor(chunkMetaEstimatedJsonlBytes))
        : 0,
      coldJsonlBytes: 0,
      total: chunkMetaCount,
      maxRowBytes: 0,
      ordered: true,
      firstOutOfOrder: null,
      firstIdMismatch: null,
      orderingHash: null,
      orderingCount: chunkMetaCount
    };
  }

  if (chunkMetaIterator.stats?.trimmedMetaV2) {
    const samples = chunkMetaIterator.stats.trimmedSamples || [];
    const sampleText = samples.length
      ? ` (sample: ${samples.map((entry) => `${entry.chunkId || 'unknown'}:${entry.file || 'unknown'}`).join(', ')})`
      : '';
    log(
      `[metaV2] trimmed ${chunkMetaIterator.stats.trimmedMetaV2} chunk_meta entries ` +
      `to fit ${formatBytes(resolvedMaxJsonBytes)}${sampleText}`
    );
  }

  const trimmedEntries = chunkMetaIterator.stats?.trimmedEntries || 0;
  const trimmedMetaV2 = chunkMetaIterator.stats?.trimmedMetaV2 || 0;
  const trimmedFields = chunkMetaIterator.stats?.trimmedFields || null;
  const trimmedFieldsPayload = trimmedFields && Object.keys(trimmedFields).length
    ? trimmedFields
    : null;
  const trimMaxRowBytes = Math.max(jsonlScan?.maxRowBytes || 0, measured?.maxRowBytes || 0);
  const trimMetadata = {
    ...buildTrimMetadata(chunkMetaIterator.stats, {
      trimmedFields: trimmedFieldsPayload,
      trimmedRows: trimmedEntries,
      droppedRows: 0,
      maxRowBytes: trimMaxRowBytes
    }),
    trimmedEntries,
    trimmedMetaV2
  };

  if (resolvedUseJsonl && jsonlScan) {
    const budgetInfo = applyByteBudget({
      budget: byteBudget,
      totalBytes: jsonlScan.totalJsonlBytes,
      label: 'chunk_meta',
      stageCheckpoints,
      logger: log
    });
    const orderInfo = {
      ordered: jsonlScan.ordered,
      sortedBy: outOfOrder ? 'id' : 'none',
      firstOutOfOrder: firstOutOfOrder || null,
      firstIdMismatch: jsonlScan.firstIdMismatch || null,
      bucketSize: collected?.bucketSize || null,
      bucketCount: collected?.buckets?.length || null
    };
    recordArtifactTelemetry(stageCheckpoints, {
      stage: 'stage2',
      artifact: 'chunk_meta',
      rows: jsonlScan.total,
      bytes: jsonlScan.totalJsonlBytes,
      maxRowBytes: jsonlScan.maxRowBytes,
      trimmedRows: trimmedEntries,
      droppedRows: 0,
      extra: {
        format: resolvedUseShards ? 'jsonl-sharded' : 'jsonl',
        streaming: chunkMetaStreaming === true,
        adaptiveSharding: streamingAdaptiveSharding,
        hotColdSplit: enableHotColdSplit,
        coldBytes: jsonlScan.coldJsonlBytes || 0,
        trim: trimMetadata,
        order: orderInfo,
        budget: budgetInfo
      }
    });
  } else if (measured) {
    const budgetInfo = applyByteBudget({
      budget: byteBudget,
      totalBytes: measured.totalJsonBytes,
      label: 'chunk_meta',
      stageCheckpoints,
      logger: log
    });
    recordArtifactTelemetry(stageCheckpoints, {
      stage: 'stage2',
      artifact: 'chunk_meta',
      rows: measured.total,
      bytes: measured.totalJsonBytes,
      maxRowBytes: measured.maxRowBytes,
      trimmedRows: trimmedEntries,
      droppedRows: 0,
      extra: {
        format: 'json',
        hotColdSplit: false,
        trim: trimMetadata,
        budget: budgetInfo
      }
    });
  }

  chunkMetaPlan.chunkMetaUseJsonl = resolvedUseJsonl;
  chunkMetaPlan.chunkMetaUseShards = resolvedUseShards;
  chunkMetaPlan.chunkMetaUseColumnar = resolvedUseColumnar;

  const requiredBytes = resolvedUseJsonl
    ? (
      (jsonlScan?.totalJsonlBytes || 0)
      + (enableHotColdSplit ? (jsonlScan?.coldJsonlBytes || 0) : 0)
    )
    : (measured?.totalJsonBytes || 0);
  const orderingHash = jsonlScan?.orderingHash || measured?.orderingHash || null;
  const orderingCount = jsonlScan?.orderingCount || measured?.orderingCount || 0;

  await ensureDiskSpace({
    targetPath: outDir,
    requiredBytes,
    label: mode ? `${mode} chunk_meta` : 'chunk_meta'
  });

  const shouldWriteCompatChunkMetaJson = Boolean(
    resolvedUseJsonl
    && !resolvedUseShards
    && chunkMetaFormat !== 'jsonl'
    && (
      isTestingEnv()
      || (
        Number.isFinite(Number(chunkMetaCount))
        && Number(chunkMetaCount) <= COMPAT_CHUNK_META_JSON_MAX_ROWS
        && Number.isFinite(Number(jsonlScan?.totalJsonlBytes || 0))
        && Number(jsonlScan?.totalJsonlBytes || 0) <= COMPAT_CHUNK_META_JSON_MAX_BYTES
      )
    )
  );

  return {
    resolvedMaxJsonBytes,
    resolvedUseJsonl,
    resolvedUseShards,
    resolvedUseColumnar,
    streamingAdaptiveSharding,
    measured,
    jsonlScan,
    collected,
    outOfOrder,
    firstOutOfOrder,
    enableHotColdSplit,
    projectHotEntry,
    projectColdEntry,
    shouldWriteCompatChunkMetaJson,
    trimMetadata,
    orderingHash,
    orderingCount
  };
};
