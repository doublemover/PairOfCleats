import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../../../../shared/progress.js';
import { MAX_JSON_BYTES } from '../../../../../shared/artifact-io.js';
import { writeBinaryRowFrames } from '../../../../../shared/artifact-io/binary-columnar.js';
import { ensureDiskSpace, formatBytes } from '../../../../../shared/disk-space.js';
import { createOrderingHasher } from '../../../../../shared/order.js';
import {
  extractChunkMetaColdFields,
  stripChunkMetaColdFields
} from '../../../../../shared/chunk-meta-cold.js';
import {
  replaceFile,
  writeJsonArrayFile,
  writeJsonLinesFileAsync,
  writeJsonLinesSharded,
  writeJsonLinesShardedAsync,
  writeJsonObjectFile
} from '../../../../../shared/json-stream.js';
import { fromPosix } from '../../../../../shared/files.js';
import { isTestingEnv } from '../../../../../shared/env.js';
import { mergeSortedRuns } from '../../../../../shared/merge.js';
import {
  createOffsetsMeta,
  recordArtifactTelemetry
} from '../../helpers.js';
import { applyByteBudget } from '../../../byte-budget.js';
import {
  buildJsonlVariantPaths,
  buildShardedPartEntries,
  removeArtifacts,
  resolveJsonlExtension,
  writeShardedJsonlMeta
} from '../_common.js';
import {
  createChunkMetaBucketCollector,
  mapRows,
  compareChunkMetaIdOnly,
  resolveChunkMetaMaxBytes,
  serializeAndCacheRow
} from './shared.js';
import {
  buildColumnarChunkMeta,
  buildColumnarChunkMetaFromRows
} from './iterator.js';
import {
  COMPAT_CHUNK_META_JSON_MAX_BYTES,
  COMPAT_CHUNK_META_JSON_MAX_ROWS
} from './constants.js';

/**
 * Queue chunk-meta artifact writes for all enabled formats (json/jsonl/shards/
 * columnar/hot-cold split), adapting output strategy to measured row size and
 * configured byte budgets.
 *
 * @param {object} input
 * @returns {Promise<void>}
 */
export const enqueueChunkMetaArtifacts = async ({
  outDir,
  mode,
  chunkMetaIterator,
  chunkMetaPlan,
  maxJsonBytes = MAX_JSON_BYTES,
  byteBudget = null,
  compression = null,
  gzipOptions = null,
  enqueueJsonArray,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel,
  stageCheckpoints
}) => {
  const {
    chunkMetaFormat,
    chunkMetaStreaming,
    chunkMetaUseJsonl,
    chunkMetaUseShards,
    chunkMetaUseColumnar,
    chunkMetaBinaryColumnar,
    chunkMetaEstimatedJsonlBytes,
    chunkMetaShardSize,
    chunkMetaCount,
    maxJsonBytes: plannedMaxJsonBytes
  } = chunkMetaPlan;
  const resolvedMaxJsonBytes = resolveChunkMetaMaxBytes(plannedMaxJsonBytes ?? maxJsonBytes);
  const removeArtifact = async (targetPath) => {
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
    } catch {}
  };
  let enableHotColdSplit = chunkMetaStreaming !== true;
  const projectHotEntry = (entry) => (
    enableHotColdSplit ? stripChunkMetaColdFields(entry) : entry
  );
  const projectColdEntry = (entry) => (
    enableHotColdSplit ? extractChunkMetaColdFields(entry) : null
  );
  const scanChunkMeta = ({ collectRows = false } = {}) => {
    let totalJsonlBytes = 0;
    let coldJsonlBytes = 0;
    let total = 0;
    let maxRowBytes = 0;
    let ordered = true;
    let firstOutOfOrder = null;
    let lastId = null;
    let firstIdMismatch = null;
    const orderingHasher = createOrderingHasher();
    const hotRows = collectRows ? [] : null;
    const coldRows = collectRows ? [] : null;
    chunkMetaIterator.resetStats?.();
    for (const entry of chunkMetaIterator(0, chunkMetaCount, true)) {
      const hotEntry = projectHotEntry(entry);
      const { line, lineBytes } = serializeAndCacheRow(hotEntry);
      orderingHasher.update(line);
      maxRowBytes = Math.max(maxRowBytes, lineBytes);
      if (resolvedMaxJsonBytes && (lineBytes + 1) > resolvedMaxJsonBytes) {
        throw new Error(`chunk_meta entry exceeds max JSON size (${lineBytes} bytes).`);
      }
      totalJsonlBytes += lineBytes + 1;
      if (hotRows) hotRows.push(hotEntry);
      const coldEntry = projectColdEntry(entry);
      if (coldEntry) {
        const { lineBytes: coldLineBytes } = serializeAndCacheRow(coldEntry);
        if (resolvedMaxJsonBytes && (coldLineBytes + 1) > resolvedMaxJsonBytes) {
          throw new Error(`chunk_meta_cold entry exceeds max JSON size (${coldLineBytes} bytes).`);
        }
        coldJsonlBytes += coldLineBytes + 1;
        if (coldRows) coldRows.push(coldEntry);
      }
      total += 1;
      const id = Number.isFinite(hotEntry?.id) ? hotEntry.id : null;
      if (id == null || id !== (total - 1)) {
        if (!firstIdMismatch) {
          firstIdMismatch = { index: total - 1, id };
        }
      }
      if (id == null) {
        if (!firstOutOfOrder) firstOutOfOrder = { prevId: lastId, nextId: id };
        ordered = false;
      } else if (Number.isFinite(lastId) && id < lastId) {
        if (!firstOutOfOrder) firstOutOfOrder = { prevId: lastId, nextId: id };
        ordered = false;
      }
      if (id != null) lastId = id;
    }
    const orderingResult = total ? orderingHasher.digest() : null;
    return {
      totalJsonlBytes,
      coldJsonlBytes,
      total,
      maxRowBytes,
      ordered,
      firstOutOfOrder,
      firstIdMismatch,
      orderingHash: orderingResult?.hash || null,
      orderingCount: orderingResult?.count || 0,
      hotRows,
      coldRows
    };
  };
  const measureChunkMeta = () => {
    let totalJsonBytes = 2;
    let totalJsonlBytes = 0;
    let coldJsonlBytes = 0;
    let total = 0;
    let maxRowBytes = 0;
    const orderingHasher = createOrderingHasher();
    chunkMetaIterator.resetStats?.();
    for (const entry of chunkMetaIterator(0, chunkMetaCount, true)) {
      const hotEntry = projectHotEntry(entry);
      const { line, lineBytes } = serializeAndCacheRow(hotEntry);
      orderingHasher.update(line);
      maxRowBytes = Math.max(maxRowBytes, lineBytes);
      if (resolvedMaxJsonBytes && (lineBytes + 1) > resolvedMaxJsonBytes) {
        throw new Error(`chunk_meta entry exceeds max JSON size (${lineBytes} bytes).`);
      }
      totalJsonBytes += lineBytes + (total > 0 ? 1 : 0);
      totalJsonlBytes += lineBytes + 1;
      const coldEntry = projectColdEntry(entry);
      if (coldEntry) {
        const { lineBytes: coldLineBytes } = serializeAndCacheRow(coldEntry);
        if (resolvedMaxJsonBytes && (coldLineBytes + 1) > resolvedMaxJsonBytes) {
          throw new Error(`chunk_meta_cold entry exceeds max JSON size (${coldLineBytes} bytes).`);
        }
        coldJsonlBytes += coldLineBytes + 1;
      }
      total += 1;
    }
    const orderingResult = total ? orderingHasher.digest() : null;
    return {
      totalJsonBytes,
      totalJsonlBytes,
      coldJsonlBytes,
      total,
      maxRowBytes,
      orderingHash: orderingResult?.hash || null,
      orderingCount: orderingResult?.count || 0
    };
  };

  let resolvedUseJsonl = chunkMetaUseJsonl;
  let resolvedUseShards = chunkMetaUseShards;
  let resolvedUseColumnar = chunkMetaUseColumnar;
  let streamingAdaptiveSharding = false;
  let measured = null;
  let collected = null;
  let jsonlScan = null;
  let outOfOrder = false;
  let firstOutOfOrder = null;
  let preparedColumnarHotRows = null;
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
      const rowsForCollector = mapRows(chunkMetaIterator(0, chunkMetaCount, false), (entry) => projectHotEntry(entry));
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
        trimmedMetaV2,
        trimmedFields: trimmedFieldsPayload,
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
        trimmedMetaV2,
        trimmedFields: trimmedFieldsPayload,
        budget: budgetInfo
      }
    });
  }
  chunkMetaPlan.chunkMetaUseJsonl = resolvedUseJsonl;
  chunkMetaPlan.chunkMetaUseShards = resolvedUseShards;
  chunkMetaPlan.chunkMetaUseColumnar = resolvedUseColumnar;
  const requiredBytes = resolvedUseJsonl
    ? ((jsonlScan?.totalJsonlBytes || 0) + (enableHotColdSplit ? (jsonlScan?.coldJsonlBytes || 0) : 0))
    : (measured?.totalJsonBytes || 0);
  const orderingHash = jsonlScan?.orderingHash || measured?.orderingHash || null;
  const orderingCount = jsonlScan?.orderingCount || measured?.orderingCount || 0;
  await ensureDiskSpace({
    targetPath: outDir,
    requiredBytes,
    label: mode ? `${mode} chunk_meta` : 'chunk_meta'
  });

  const jsonlExtension = resolveJsonlExtension(compression);
  const jsonlName = `chunk_meta.${jsonlExtension}`;
  const jsonlPath = path.join(outDir, jsonlName);
  const compatJsonPath = path.join(outDir, 'chunk_meta.json');
  const offsetsConfig = compression ? null : { suffix: 'offsets.bin' };
  const offsetsPath = offsetsConfig ? `${jsonlPath}.${offsetsConfig.suffix}` : null;
  const coldJsonlName = `chunk_meta_cold.${jsonlExtension}`;
  const coldJsonlPath = path.join(outDir, coldJsonlName);
  const coldOffsetsPath = offsetsConfig ? `${coldJsonlPath}.${offsetsConfig.suffix}` : null;
  const columnarPath = path.join(outDir, 'chunk_meta.columnar.json');
  const binaryDataPath = path.join(outDir, 'chunk_meta.binary-columnar.bin');
  const binaryOffsetsPath = path.join(outDir, 'chunk_meta.binary-columnar.offsets.bin');
  const binaryLengthsPath = path.join(outDir, 'chunk_meta.binary-columnar.lengths.varint');
  const binaryMetaPath = path.join(outDir, 'chunk_meta.binary-columnar.meta.json');
  const removeJsonlVariants = async () => removeArtifacts(
    buildJsonlVariantPaths({ outDir, baseName: 'chunk_meta', includeOffsets: true })
  );
  const removeColdJsonlVariants = async () => removeArtifacts(
    buildJsonlVariantPaths({ outDir, baseName: 'chunk_meta_cold', includeOffsets: true })
  );

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

  if (resolvedUseJsonl) {
    if (!shouldWriteCompatChunkMetaJson) {
      await removeArtifact(path.join(outDir, 'chunk_meta.json'));
    }
    await removeArtifact(path.join(outDir, 'chunk_meta.json.gz'));
    await removeArtifact(path.join(outDir, 'chunk_meta.json.zst'));
    await removeArtifact(columnarPath);
    if (resolvedUseShards) {
      // When writing sharded JSONL output, ensure any prior unsharded JSONL output is removed.
      await removeJsonlVariants();
      await removeColdJsonlVariants();
    } else {
      // When writing unsharded JSONL output, remove any stale shard artifacts.
      // The loader prefers chunk_meta.meta.json / chunk_meta.parts over chunk_meta.jsonl.
      await removeArtifact(path.join(outDir, 'chunk_meta.meta.json'));
      await removeArtifact(path.join(outDir, 'chunk_meta.parts'));
      await removeArtifact(path.join(outDir, 'chunk_meta_cold.meta.json'));
      await removeArtifact(path.join(outDir, 'chunk_meta_cold.parts'));
    }
  } else {
    await removeJsonlVariants();
    await removeColdJsonlVariants();
    await removeArtifact(path.join(outDir, 'chunk_meta.meta.json'));
    await removeArtifact(path.join(outDir, 'chunk_meta.parts'));
    await removeArtifact(path.join(outDir, 'chunk_meta_cold.meta.json'));
    await removeArtifact(path.join(outDir, 'chunk_meta_cold.parts'));
    if (!resolvedUseColumnar) {
      await removeArtifact(columnarPath);
    }
  }
  if (!chunkMetaBinaryColumnar) {
    await removeArtifact(binaryDataPath);
    await removeArtifact(binaryOffsetsPath);
    await removeArtifact(binaryLengthsPath);
    await removeArtifact(binaryMetaPath);
  }

  if (resolvedUseJsonl) {
    if (resolvedUseShards) {
      log(`[chunk_meta] writing sharded JSONL -> ${path.join(outDir, 'chunk_meta.parts')}`);
    } else {
      log(`[chunk_meta] writing JSONL -> ${jsonlPath}`);
    }
    if (chunkMetaStreaming) {
      log('[chunk_meta] streaming mode enabled (single-pass JSONL writer).');
    }
    if (enableHotColdSplit) {
      log('[chunk_meta] hot/cold split enabled for JSONL artifacts.');
    }
  } else if (resolvedUseColumnar) {
    log(`[chunk_meta] writing columnar -> ${columnarPath}`);
  } else {
    log(`[chunk_meta] writing JSON -> ${path.join(outDir, 'chunk_meta.json')}`);
  }

  if (resolvedUseJsonl) {
    const rows = collected?.rows || null;
    const runs = collected?.runs || null;
    const buckets = collected?.buckets || null;
    const bucketSize = collected?.bucketSize || null;
    const createItemsSource = () => {
      let items = chunkMetaIterator();
      let itemsAsync = false;
      if (buckets) {
        itemsAsync = true;
        items = (async function* bucketIterator() {
          for (const bucket of buckets) {
            const result = bucket?.result;
            if (!result) continue;
            if (result.runs) {
              yield* mergeSortedRuns(result.runs, { compare: compareChunkMetaIdOnly, validateComparator: true });
            } else if (Array.isArray(result.rows)) {
              for (const row of result.rows) yield row;
            }
          }
        })();
      } else if (runs) {
        itemsAsync = true;
        items = mergeSortedRuns(runs, { compare: compareChunkMetaIdOnly, validateComparator: true });
      } else if (rows) {
        items = rows;
      }
      return { items, itemsAsync };
    };
    const createHotItemsSource = () => {
      const source = createItemsSource();
      if (buckets || runs || rows) return source;
      return {
        ...source,
        items: mapRows(source.items, (entry) => projectHotEntry(entry))
      };
    };
    const createColdItemsSource = () => {
      const source = createItemsSource();
      return {
        ...source,
        items: mapRows(source.items, (entry) => projectColdEntry(entry))
      };
    };
    let materializedHotRowsCache = null;
    let materializedHotRowsPromise = null;
    const materializeHotRows = async () => {
      if (Array.isArray(materializedHotRowsCache)) return materializedHotRowsCache;
      if (materializedHotRowsPromise) return materializedHotRowsPromise;
      materializedHotRowsPromise = (async () => {
        const { items, itemsAsync } = createHotItemsSource();
        if (itemsAsync) {
          const materialized = [];
          for await (const item of items) {
            materialized.push(item);
          }
          materializedHotRowsCache = materialized;
          return materialized;
        }
        if (Array.isArray(items)) {
          materializedHotRowsCache = items;
          return items;
        }
        const materialized = Array.from(items || []);
        materializedHotRowsCache = materialized;
        return materialized;
      })().finally(() => {
        materializedHotRowsPromise = null;
      });
      return materializedHotRowsPromise;
    };
    const writeCompatChunkMetaJson = async () => {
      if (!shouldWriteCompatChunkMetaJson) return;
      const { items, itemsAsync } = createHotItemsSource();
      if (itemsAsync) {
        const materialized = await materializeHotRows();
        await writeJsonArrayFile(compatJsonPath, materialized, { atomic: true });
        return;
      }
      await writeJsonArrayFile(compatJsonPath, items, { atomic: true });
    };
    let collectedCleaned = false;
    const cleanupCollected = async () => {
      if (collectedCleaned) return;
      collectedCleaned = true;
      if (collected?.cleanup) await collected.cleanup();
    };
    if (!enableHotColdSplit) {
      await removeColdJsonlVariants();
      await removeArtifact(path.join(outDir, 'chunk_meta_cold.meta.json'));
      await removeArtifact(path.join(outDir, 'chunk_meta_cold.parts'));
    }
    if (resolvedUseShards) {
      const metaPath = path.join(outDir, 'chunk_meta.meta.json');
      enqueueWrite(
        formatArtifactLabel(metaPath),
        async () => {
          const { items, itemsAsync } = createHotItemsSource();
          const result = itemsAsync
            ? await writeJsonLinesShardedAsync({
              dir: outDir,
              partsDirName: 'chunk_meta.parts',
              partPrefix: 'chunk_meta.part-',
              items,
              maxBytes: resolvedMaxJsonBytes,
              maxItems: chunkMetaShardSize,
              atomic: true,
              compression,
              gzipOptions,
              offsets: offsetsConfig
            })
            : await writeJsonLinesSharded({
              dir: outDir,
              partsDirName: 'chunk_meta.parts',
              partPrefix: 'chunk_meta.part-',
              items,
              maxBytes: resolvedMaxJsonBytes,
              maxItems: chunkMetaShardSize,
              atomic: true,
              compression,
              gzipOptions,
              offsets: offsetsConfig
            });
          const canPromoteFromSinglePart = streamingAdaptiveSharding
            && !enableHotColdSplit
            && result.parts.length === 1
            && (
              !offsetsPath
              || (Array.isArray(result.offsets) && result.offsets.length === 1)
            );
          if (canPromoteFromSinglePart) {
            const relPath = result.parts[0];
            const absPath = path.join(outDir, fromPosix(relPath));
            await replaceFile(absPath, jsonlPath);
            if (offsetsPath && Array.isArray(result.offsets) && result.offsets[0]) {
              const relOffsetPath = result.offsets[0];
              const absOffsetPath = path.join(outDir, fromPosix(relOffsetPath));
              await replaceFile(absOffsetPath, offsetsPath);
            }
            await removeArtifact(path.join(outDir, 'chunk_meta.parts'));
            await removeArtifact(metaPath);
            addPieceFile({
              type: 'chunks',
              name: 'chunk_meta',
              format: 'jsonl',
              count: chunkMetaCount,
              compression: compression || null
            }, jsonlPath);
            if (offsetsPath) {
              addPieceFile({
                type: 'chunks',
                name: 'chunk_meta_offsets',
                format: 'bin',
                count: chunkMetaCount
              }, offsetsPath);
            }
            await writeCompatChunkMetaJson();
            if (!shouldWriteCompatChunkMetaJson) {
              await removeArtifact(compatJsonPath);
            }
            await cleanupCollected();
            return;
          }
          const parts = buildShardedPartEntries(result);
          const offsetsMeta = createOffsetsMeta({
            suffix: offsetsConfig?.suffix || null,
            parts: result.offsets,
            compression: 'none'
          });
          await writeShardedJsonlMeta({
            metaPath,
            artifact: 'chunk_meta',
            compression,
            result,
            parts,
            extensions: {
              trim: {
                trimmedEntries,
                trimmedMetaV2,
                trimmedFields: trimmedFieldsPayload
              },
              ...(bucketSize ? { orderBuckets: { size: bucketSize, count: buckets.length } } : {}),
              ...(offsetsMeta ? { offsets: offsetsMeta } : {})
            }
          });
          for (let i = 0; i < result.parts.length; i += 1) {
            const relPath = result.parts[i];
            const absPath = path.join(outDir, fromPosix(relPath));
            addPieceFile({
              type: 'chunks',
              name: 'chunk_meta',
              format: 'jsonl',
              count: result.counts[i] || 0,
              compression: compression || null
            }, absPath);
          }
          if (Array.isArray(result.offsets)) {
            for (let i = 0; i < result.offsets.length; i += 1) {
              const relPath = result.offsets[i];
              if (!relPath) continue;
              const absPath = path.join(outDir, fromPosix(relPath));
              addPieceFile({
                type: 'chunks',
                name: 'chunk_meta_offsets',
                format: 'bin',
                count: result.counts[i] || 0
              }, absPath);
            }
          }
          addPieceFile({ type: 'chunks', name: 'chunk_meta_meta', format: 'json' }, metaPath);
          // Sharded outputs should never leave a chunk_meta.json alias behind.
          await removeArtifact(compatJsonPath);
          await cleanupCollected();
        }
      );
      if (enableHotColdSplit) {
        const coldMetaPath = path.join(outDir, 'chunk_meta_cold.meta.json');
        enqueueWrite(
          formatArtifactLabel(coldMetaPath),
          async () => {
            const { items, itemsAsync } = createColdItemsSource();
            const result = itemsAsync
              ? await writeJsonLinesShardedAsync({
                dir: outDir,
                partsDirName: 'chunk_meta_cold.parts',
                partPrefix: 'chunk_meta_cold.part-',
                items,
                maxBytes: resolvedMaxJsonBytes,
                maxItems: chunkMetaShardSize,
                atomic: true,
                compression,
                gzipOptions,
                offsets: offsetsConfig
              })
              : await writeJsonLinesSharded({
                dir: outDir,
                partsDirName: 'chunk_meta_cold.parts',
                partPrefix: 'chunk_meta_cold.part-',
                items,
                maxBytes: resolvedMaxJsonBytes,
                maxItems: chunkMetaShardSize,
                atomic: true,
                compression,
                gzipOptions,
                offsets: offsetsConfig
              });
            const parts = buildShardedPartEntries(result);
            const offsetsMeta = createOffsetsMeta({
              suffix: offsetsConfig?.suffix || null,
              parts: result.offsets,
              compression: 'none'
            });
            await writeShardedJsonlMeta({
              metaPath: coldMetaPath,
              artifact: 'chunk_meta_cold',
              compression,
              result,
              parts,
              extensions: {
                ...(offsetsMeta ? { offsets: offsetsMeta } : {})
              }
            });
            for (let i = 0; i < result.parts.length; i += 1) {
              const relPath = result.parts[i];
              const absPath = path.join(outDir, fromPosix(relPath));
              addPieceFile({
                type: 'chunks',
                name: 'chunk_meta_cold',
                format: 'jsonl',
                count: result.counts[i] || 0,
                compression: compression || null
              }, absPath);
            }
            if (Array.isArray(result.offsets)) {
              for (let i = 0; i < result.offsets.length; i += 1) {
                const relPath = result.offsets[i];
                if (!relPath) continue;
                const absPath = path.join(outDir, fromPosix(relPath));
                addPieceFile({
                  type: 'chunks',
                  name: 'chunk_meta_cold_offsets',
                  format: 'bin',
                  count: result.counts[i] || 0
                }, absPath);
              }
            }
            addPieceFile({ type: 'chunks', name: 'chunk_meta_cold_meta', format: 'json' }, coldMetaPath);
            await cleanupCollected();
          }
        );
      }
    } else {
      enqueueWrite(
        formatArtifactLabel(jsonlPath),
        async () => {
          const { items } = createHotItemsSource();
          await writeJsonLinesFileAsync(
            jsonlPath,
            items,
            {
              atomic: true,
              compression,
              gzipOptions,
              offsets: offsetsPath ? { path: offsetsPath, atomic: true } : null,
              maxBytes: resolvedMaxJsonBytes
            }
          );
          await writeCompatChunkMetaJson();
          await cleanupCollected();
        }
      );
      addPieceFile({
        type: 'chunks',
        name: 'chunk_meta',
        format: 'jsonl',
        count: chunkMetaCount,
        compression: compression || null
      }, jsonlPath);
      if (offsetsPath) {
        addPieceFile({
          type: 'chunks',
          name: 'chunk_meta_offsets',
          format: 'bin',
          count: chunkMetaCount
        }, offsetsPath);
      }
      if (enableHotColdSplit) {
        enqueueWrite(
          formatArtifactLabel(coldJsonlPath),
          async () => {
            const { items } = createColdItemsSource();
            await writeJsonLinesFileAsync(
              coldJsonlPath,
              items,
              {
                atomic: true,
                compression,
                gzipOptions,
                offsets: coldOffsetsPath ? { path: coldOffsetsPath, atomic: true } : null,
                maxBytes: resolvedMaxJsonBytes
              }
            );
            await cleanupCollected();
          }
        );
        addPieceFile({
          type: 'chunks',
          name: 'chunk_meta_cold',
          format: 'jsonl',
          count: chunkMetaCount,
          compression: compression || null
        }, coldJsonlPath);
        if (coldOffsetsPath) {
          addPieceFile({
            type: 'chunks',
            name: 'chunk_meta_cold_offsets',
            format: 'bin',
            count: chunkMetaCount
          }, coldOffsetsPath);
        }
      }
    }
  } else if (resolvedUseColumnar) {
    enqueueWrite(
      formatArtifactLabel(columnarPath),
      async () => {
        let columnarRows = null;
        if (shouldWriteCompatChunkMetaJson) {
          const compatRows = [];
          for (const entry of chunkMetaIterator(0, chunkMetaCount, false)) {
            compatRows.push(projectHotEntry(entry));
          }
          if (outOfOrder) compatRows.sort(compareChunkMetaIdOnly);
          columnarRows = compatRows;
          preparedColumnarHotRows = compatRows;
          await writeJsonArrayFile(path.join(outDir, 'chunk_meta.json'), compatRows, { atomic: true });
        } else {
          await removeArtifact(path.join(outDir, 'chunk_meta.json'));
        }
        await removeArtifact(path.join(outDir, 'chunk_meta.json.gz'));
        await removeArtifact(path.join(outDir, 'chunk_meta.json.zst'));
        const payload = Array.isArray(columnarRows)
          ? buildColumnarChunkMetaFromRows(columnarRows)
          : buildColumnarChunkMeta(chunkMetaIterator, chunkMetaCount);
        await writeJsonObjectFile(columnarPath, { fields: payload, atomic: true });
      }
    );
    addPieceFile({
      type: 'chunks',
      name: 'chunk_meta',
      format: 'columnar',
      count: chunkMetaCount
    }, columnarPath);
  } else {
    enqueueJsonArray('chunk_meta', chunkMetaIterator(), {
      piece: { type: 'chunks', name: 'chunk_meta', count: chunkMetaCount }
    });
  }
  if (chunkMetaBinaryColumnar) {
    enqueueWrite(
      formatArtifactLabel(binaryMetaPath),
      async () => {
        const toAsyncIterable = (rows) => {
          if (rows && typeof rows[Symbol.asyncIterator] === 'function') return rows;
          return (async function* rowIterator() {
            for (const row of rows || []) {
              yield row;
            }
          })();
        };
        const fileTable = [];
        const fileRefByPath = new Map();
        let sourceRows = Array.isArray(preparedColumnarHotRows)
          ? preparedColumnarHotRows
          : mapRows(chunkMetaIterator(0, chunkMetaCount, false), (entry) => projectHotEntry(entry));
        if (outOfOrder) {
          const materialized = [];
          for await (const row of toAsyncIterable(sourceRows)) {
            materialized.push(row);
          }
          materialized.sort(compareChunkMetaIdOnly);
          sourceRows = materialized;
        }
        const rowPayloads = (async function* payloadIterator() {
          for await (const hotEntry of toAsyncIterable(sourceRows)) {
            if (!hotEntry || typeof hotEntry !== 'object') continue;
            const next = { ...hotEntry };
            const file = typeof hotEntry.file === 'string' ? hotEntry.file : null;
            if (file) {
              let fileRef = fileRefByPath.get(file);
              if (!Number.isInteger(fileRef)) {
                fileRef = fileTable.length;
                fileRefByPath.set(file, fileRef);
                fileTable.push(file);
              }
              next.fileRef = fileRef;
              delete next.file;
            }
            yield JSON.stringify(next);
          }
        })();
        const frames = await writeBinaryRowFrames({
          rowBuffers: rowPayloads,
          dataPath: binaryDataPath,
          offsetsPath: binaryOffsetsPath,
          lengthsPath: binaryLengthsPath
        });
        await writeJsonObjectFile(binaryMetaPath, {
          fields: {
            format: 'binary-columnar-v1',
            rowEncoding: 'json-rows',
            count: frames.count,
            data: path.basename(binaryDataPath),
            offsets: path.basename(binaryOffsetsPath),
            lengths: path.basename(binaryLengthsPath),
            orderingHash,
            orderingCount
          },
          arrays: {
            fileTable
          },
          atomic: true
        });
      }
    );
    addPieceFile({
      type: 'chunks',
      name: 'chunk_meta_binary_columnar',
      format: 'binary-columnar',
      count: chunkMetaCount
    }, binaryDataPath);
    addPieceFile({
      type: 'chunks',
      name: 'chunk_meta_binary_columnar_offsets',
      format: 'binary',
      count: chunkMetaCount
    }, binaryOffsetsPath);
    addPieceFile({
      type: 'chunks',
      name: 'chunk_meta_binary_columnar_lengths',
      format: 'varint',
      count: chunkMetaCount
    }, binaryLengthsPath);
    addPieceFile({
      type: 'chunks',
      name: 'chunk_meta_binary_columnar_meta',
      format: 'json'
    }, binaryMetaPath);
  }
  return { orderingHash, orderingCount };
};

