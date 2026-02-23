import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../../../../shared/progress.js';
import {
  CHUNK_META_PART_PREFIX,
  CHUNK_META_PARTS_DIR,
  expandMetaPartPaths
} from '../../../../../shared/artifact-io.js';
import { writeBinaryRowFrames } from '../../../../../shared/artifact-io/binary-columnar.js';
import {
  replaceFile,
  writeJsonArrayFile,
  writeJsonLinesFileAsync,
  writeJsonLinesSharded,
  writeJsonLinesShardedAsync,
  writeJsonObjectFile
} from '../../../../../shared/json-stream.js';
import { createOffsetsMeta } from '../../helpers.js';
import {
  buildJsonlVariantPaths,
  buildShardedPartEntries,
  removeArtifacts,
  resolveJsonlExtension,
  writeShardedJsonlMeta
} from '../_common.js';
import { buildColumnarChunkMeta, buildColumnarChunkMetaFromRows } from './iterator.js';
import { compareChunkMetaIdOnly, mapRows } from './shared.js';

const removeArtifact = async (targetPath) => {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
  } catch {}
};

/**
 * Resolve all chunk_meta artifact target paths for the selected compression.
 *
 * @param {{outDir:string,compression?:string|null}} input
 * @returns {object}
 */
export const createChunkMetaArtifactPaths = ({ outDir, compression = null }) => {
  const jsonlExtension = resolveJsonlExtension(compression);
  const jsonlName = `chunk_meta.${jsonlExtension}`;
  const jsonlPath = path.join(outDir, jsonlName);
  const compatJsonPath = path.join(outDir, 'chunk_meta.json');
  const compatJsonGzPath = path.join(outDir, 'chunk_meta.json.gz');
  const compatJsonZstPath = path.join(outDir, 'chunk_meta.json.zst');
  const offsetsConfig = compression ? null : { suffix: 'offsets.bin' };
  const offsetsPath = offsetsConfig ? `${jsonlPath}.${offsetsConfig.suffix}` : null;
  const coldJsonlName = `chunk_meta_cold.${jsonlExtension}`;
  const coldJsonlPath = path.join(outDir, coldJsonlName);
  const coldOffsetsPath = offsetsConfig ? `${coldJsonlPath}.${offsetsConfig.suffix}` : null;
  const chunkMetaMetaPath = path.join(outDir, 'chunk_meta.meta.json');
  const chunkMetaPartsPath = path.join(outDir, CHUNK_META_PARTS_DIR);
  const chunkMetaColdMetaPath = path.join(outDir, 'chunk_meta_cold.meta.json');
  const chunkMetaColdPartsPath = path.join(outDir, 'chunk_meta_cold.parts');
  const columnarPath = path.join(outDir, 'chunk_meta.columnar.json');
  const binaryDataPath = path.join(outDir, 'chunk_meta.binary-columnar.bin');
  const binaryOffsetsPath = path.join(outDir, 'chunk_meta.binary-columnar.offsets.bin');
  const binaryLengthsPath = path.join(outDir, 'chunk_meta.binary-columnar.lengths.varint');
  const binaryMetaPath = path.join(outDir, 'chunk_meta.binary-columnar.meta.json');
  const expandPartPaths = (parts) => expandMetaPartPaths(parts, outDir);
  const removeJsonlVariants = async () => removeArtifacts(
    buildJsonlVariantPaths({ outDir, baseName: 'chunk_meta', includeOffsets: true })
  );
  const removeColdJsonlVariants = async () => removeArtifacts(
    buildJsonlVariantPaths({ outDir, baseName: 'chunk_meta_cold', includeOffsets: true })
  );

  return {
    jsonlExtension,
    jsonlName,
    jsonlPath,
    compatJsonPath,
    compatJsonGzPath,
    compatJsonZstPath,
    offsetsConfig,
    offsetsPath,
    coldJsonlName,
    coldJsonlPath,
    coldOffsetsPath,
    chunkMetaMetaPath,
    chunkMetaPartsPath,
    chunkMetaColdMetaPath,
    chunkMetaColdPartsPath,
    columnarPath,
    binaryDataPath,
    binaryOffsetsPath,
    binaryLengthsPath,
    binaryMetaPath,
    expandPartPaths,
    removeJsonlVariants,
    removeColdJsonlVariants
  };
};

/**
 * Remove stale artifacts that conflict with the selected chunk_meta layout.
 *
 * @param {object} input
 * @returns {Promise<void>}
 */
export const removeStaleChunkMetaArtifacts = async ({
  paths,
  resolvedUseJsonl,
  resolvedUseShards,
  resolvedUseColumnar,
  chunkMetaBinaryColumnar,
  shouldWriteCompatChunkMetaJson
}) => {
  if (resolvedUseJsonl) {
    if (!shouldWriteCompatChunkMetaJson) {
      await removeArtifact(paths.compatJsonPath);
    }
    await removeArtifact(paths.compatJsonGzPath);
    await removeArtifact(paths.compatJsonZstPath);
    await removeArtifact(paths.columnarPath);
    if (resolvedUseShards) {
      // When writing sharded JSONL output, ensure any prior unsharded JSONL output is removed.
      await paths.removeJsonlVariants();
      await paths.removeColdJsonlVariants();
    } else {
      // When writing unsharded JSONL output, remove any stale shard artifacts.
      // The loader prefers chunk_meta.meta.json / chunk_meta.parts over chunk_meta.jsonl.
      await removeArtifact(paths.chunkMetaMetaPath);
      await removeArtifact(paths.chunkMetaPartsPath);
      await removeArtifact(paths.chunkMetaColdMetaPath);
      await removeArtifact(paths.chunkMetaColdPartsPath);
    }
  } else {
    await paths.removeJsonlVariants();
    await paths.removeColdJsonlVariants();
    await removeArtifact(paths.chunkMetaMetaPath);
    await removeArtifact(paths.chunkMetaPartsPath);
    await removeArtifact(paths.chunkMetaColdMetaPath);
    await removeArtifact(paths.chunkMetaColdPartsPath);
    if (!resolvedUseColumnar) {
      await removeArtifact(paths.columnarPath);
    }
  }
  if (!chunkMetaBinaryColumnar) {
    await removeArtifact(paths.binaryDataPath);
    await removeArtifact(paths.binaryOffsetsPath);
    await removeArtifact(paths.binaryLengthsPath);
    await removeArtifact(paths.binaryMetaPath);
  }
};

/**
 * Emit chunk_meta writer mode logs after stale-artifact cleanup.
 *
 * @param {object} input
 * @returns {void}
 */
export const logChunkMetaWriteMode = ({
  paths,
  resolvedUseJsonl,
  resolvedUseShards,
  resolvedUseColumnar,
  chunkMetaStreaming,
  enableHotColdSplit
}) => {
  if (resolvedUseJsonl) {
    if (resolvedUseShards) {
      log('[chunk_meta] writing sharded JSONL', {
        fileOnlyLine: `[chunk_meta] writing sharded JSONL -> ${paths.chunkMetaPartsPath}`
      });
    } else {
      log('[chunk_meta] writing JSONL', {
        fileOnlyLine: `[chunk_meta] writing JSONL -> ${paths.jsonlPath}`
      });
    }
    if (chunkMetaStreaming) {
      log('[chunk_meta] streaming mode enabled (single-pass JSONL writer).');
    }
    if (enableHotColdSplit) {
      log('[chunk_meta] hot/cold split enabled for JSONL artifacts.');
    }
  } else if (resolvedUseColumnar) {
    log('[chunk_meta] writing columnar', {
      fileOnlyLine: `[chunk_meta] writing columnar -> ${paths.columnarPath}`
    });
  } else {
    log('[chunk_meta] writing JSON', {
      fileOnlyLine: `[chunk_meta] writing JSON -> ${paths.compatJsonPath}`
    });
  }
};

const addShardedPieceFiles = ({
  result,
  parts,
  pieceName,
  offsetsPieceName,
  compression,
  addPieceFile,
  expandPartPaths
}) => {
  const shardPaths = expandPartPaths(result.parts);
  for (let i = 0; i < result.parts.length; i += 1) {
    const absPath = shardPaths[i];
    addPieceFile({
      type: 'chunks',
      name: pieceName,
      format: 'jsonl',
      count: result.counts[i] || 0,
      compression: compression || null
    }, absPath);
  }
  if (Array.isArray(result.offsets)) {
    const offsetPaths = expandPartPaths(result.offsets);
    for (let i = 0; i < result.offsets.length; i += 1) {
      const absPath = offsetPaths[i];
      if (!absPath) continue;
      addPieceFile({
        type: 'chunks',
        name: offsetsPieceName,
        format: 'bin',
        count: result.counts[i] || 0
      }, absPath);
    }
  }
};

/**
 * Queue chunk_meta JSONL writes (unsharded or sharded, optional cold fanout).
 *
 * @param {object} input
 * @returns {Promise<void>}
 */
export const enqueueJsonlChunkMetaWrites = async ({
  paths,
  rowAssembly,
  chunkMetaCount,
  resolvedUseShards,
  resolvedMaxJsonBytes,
  chunkMetaShardSize,
  compression = null,
  gzipOptions = null,
  streamingAdaptiveSharding = false,
  enableHotColdSplit = false,
  shouldWriteCompatChunkMetaJson = false,
  trimMetadata,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel
}) => {
  if (!enableHotColdSplit) {
    await paths.removeColdJsonlVariants();
    await removeArtifact(paths.chunkMetaColdMetaPath);
    await removeArtifact(paths.chunkMetaColdPartsPath);
  }

  if (resolvedUseShards) {
    enqueueWrite(
      formatArtifactLabel(paths.chunkMetaMetaPath),
      async () => {
        const { items, itemsAsync } = rowAssembly.createHotItemsSource();
        const result = itemsAsync
          ? await writeJsonLinesShardedAsync({
            dir: path.dirname(paths.chunkMetaMetaPath),
            partsDirName: CHUNK_META_PARTS_DIR,
            partPrefix: CHUNK_META_PART_PREFIX,
            items,
            maxBytes: resolvedMaxJsonBytes,
            maxItems: chunkMetaShardSize,
            atomic: true,
            compression,
            gzipOptions,
            offsets: paths.offsetsConfig
          })
          : await writeJsonLinesSharded({
            dir: path.dirname(paths.chunkMetaMetaPath),
            partsDirName: CHUNK_META_PARTS_DIR,
            partPrefix: CHUNK_META_PART_PREFIX,
            items,
            maxBytes: resolvedMaxJsonBytes,
            maxItems: chunkMetaShardSize,
            atomic: true,
            compression,
            gzipOptions,
            offsets: paths.offsetsConfig
          });

        const canPromoteFromSinglePart = streamingAdaptiveSharding
          && !enableHotColdSplit
          && result.parts.length === 1
          && (
            !paths.offsetsPath
            || (Array.isArray(result.offsets) && result.offsets.length === 1)
          );
        if (canPromoteFromSinglePart) {
          const absPath = paths.expandPartPaths(result.parts)[0];
          await replaceFile(absPath, paths.jsonlPath);
          if (paths.offsetsPath && Array.isArray(result.offsets) && result.offsets[0]) {
            const absOffsetPath = paths.expandPartPaths(result.offsets)[0];
            await replaceFile(absOffsetPath, paths.offsetsPath);
          }
          await removeArtifact(paths.chunkMetaPartsPath);
          await removeArtifact(paths.chunkMetaMetaPath);
          addPieceFile({
            type: 'chunks',
            name: 'chunk_meta',
            format: 'jsonl',
            count: chunkMetaCount,
            compression: compression || null
          }, paths.jsonlPath);
          if (paths.offsetsPath) {
            addPieceFile({
              type: 'chunks',
              name: 'chunk_meta_offsets',
              format: 'bin',
              count: chunkMetaCount
            }, paths.offsetsPath);
          }
          await rowAssembly.writeCompatChunkMetaJson();
          if (!shouldWriteCompatChunkMetaJson) {
            await removeArtifact(paths.compatJsonPath);
          }
          await rowAssembly.cleanupCollected();
          return;
        }

        const parts = buildShardedPartEntries(result);
        const offsetsMeta = createOffsetsMeta({
          suffix: paths.offsetsConfig?.suffix || null,
          parts: result.offsets,
          compression: 'none'
        });
        await writeShardedJsonlMeta({
          metaPath: paths.chunkMetaMetaPath,
          artifact: 'chunk_meta',
          compression,
          result,
          parts,
          extensions: {
            trim: trimMetadata,
            ...(rowAssembly.bucketSize
              ? {
                orderBuckets: {
                  size: rowAssembly.bucketSize,
                  count: rowAssembly.buckets.length
                }
              }
              : {}),
            ...(offsetsMeta ? { offsets: offsetsMeta } : {})
          }
        });

        addShardedPieceFiles({
          result,
          parts,
          pieceName: 'chunk_meta',
          offsetsPieceName: 'chunk_meta_offsets',
          compression,
          addPieceFile,
          expandPartPaths: paths.expandPartPaths
        });
        addPieceFile(
          { type: 'chunks', name: 'chunk_meta_meta', format: 'json' },
          paths.chunkMetaMetaPath
        );

        // Sharded outputs should never leave a chunk_meta.json alias behind.
        await removeArtifact(paths.compatJsonPath);
        await rowAssembly.cleanupCollected();
      }
    );

    if (enableHotColdSplit) {
      enqueueWrite(
        formatArtifactLabel(paths.chunkMetaColdMetaPath),
        async () => {
          const { items, itemsAsync } = rowAssembly.createColdItemsSource();
          const result = itemsAsync
            ? await writeJsonLinesShardedAsync({
              dir: path.dirname(paths.chunkMetaColdMetaPath),
              partsDirName: 'chunk_meta_cold.parts',
              partPrefix: 'chunk_meta_cold.part-',
              items,
              maxBytes: resolvedMaxJsonBytes,
              maxItems: chunkMetaShardSize,
              atomic: true,
              compression,
              gzipOptions,
              offsets: paths.offsetsConfig
            })
            : await writeJsonLinesSharded({
              dir: path.dirname(paths.chunkMetaColdMetaPath),
              partsDirName: 'chunk_meta_cold.parts',
              partPrefix: 'chunk_meta_cold.part-',
              items,
              maxBytes: resolvedMaxJsonBytes,
              maxItems: chunkMetaShardSize,
              atomic: true,
              compression,
              gzipOptions,
              offsets: paths.offsetsConfig
            });

          const parts = buildShardedPartEntries(result);
          const offsetsMeta = createOffsetsMeta({
            suffix: paths.offsetsConfig?.suffix || null,
            parts: result.offsets,
            compression: 'none'
          });
          await writeShardedJsonlMeta({
            metaPath: paths.chunkMetaColdMetaPath,
            artifact: 'chunk_meta_cold',
            compression,
            result,
            parts,
            extensions: {
              ...(offsetsMeta ? { offsets: offsetsMeta } : {})
            }
          });

          addShardedPieceFiles({
            result,
            parts,
            pieceName: 'chunk_meta_cold',
            offsetsPieceName: 'chunk_meta_cold_offsets',
            compression,
            addPieceFile,
            expandPartPaths: paths.expandPartPaths
          });
          addPieceFile(
            { type: 'chunks', name: 'chunk_meta_cold_meta', format: 'json' },
            paths.chunkMetaColdMetaPath
          );
          await rowAssembly.cleanupCollected();
        }
      );
    }
    return;
  }

  enqueueWrite(
    formatArtifactLabel(paths.jsonlPath),
    async () => {
      let compatRows = null;
      const hotSource = rowAssembly.createHotItemsSource();
      let hotItems = hotSource.items;
      if (shouldWriteCompatChunkMetaJson && hotSource.itemsAsync) {
        // Async item sources (spill merges) are expensive to replay.
        compatRows = await rowAssembly.materializeHotRows();
        hotItems = compatRows;
      } else if (shouldWriteCompatChunkMetaJson && Array.isArray(hotItems)) {
        compatRows = hotItems;
      }
      await writeJsonLinesFileAsync(
        paths.jsonlPath,
        hotItems,
        {
          atomic: true,
          compression,
          gzipOptions,
          offsets: paths.offsetsPath ? { path: paths.offsetsPath, atomic: true } : null,
          maxBytes: resolvedMaxJsonBytes
        }
      );
      await rowAssembly.writeCompatChunkMetaJson(compatRows);
      await rowAssembly.cleanupCollected();
    }
  );
  addPieceFile({
    type: 'chunks',
    name: 'chunk_meta',
    format: 'jsonl',
    count: chunkMetaCount,
    compression: compression || null
  }, paths.jsonlPath);
  if (paths.offsetsPath) {
    addPieceFile({
      type: 'chunks',
      name: 'chunk_meta_offsets',
      format: 'bin',
      count: chunkMetaCount
    }, paths.offsetsPath);
  }

  if (enableHotColdSplit) {
    enqueueWrite(
      formatArtifactLabel(paths.coldJsonlPath),
      async () => {
        const { items } = rowAssembly.createColdItemsSource();
        await writeJsonLinesFileAsync(
          paths.coldJsonlPath,
          items,
          {
            atomic: true,
            compression,
            gzipOptions,
            offsets: paths.coldOffsetsPath ? { path: paths.coldOffsetsPath, atomic: true } : null,
            maxBytes: resolvedMaxJsonBytes
          }
        );
        await rowAssembly.cleanupCollected();
      }
    );
    addPieceFile({
      type: 'chunks',
      name: 'chunk_meta_cold',
      format: 'jsonl',
      count: chunkMetaCount,
      compression: compression || null
    }, paths.coldJsonlPath);
    if (paths.coldOffsetsPath) {
      addPieceFile({
        type: 'chunks',
        name: 'chunk_meta_cold_offsets',
        format: 'bin',
        count: chunkMetaCount
      }, paths.coldOffsetsPath);
    }
  }
};

/**
 * Queue non-JSONL chunk_meta writes (columnar or legacy JSON array path).
 *
 * @param {object} input
 * @returns {void}
 */
export const enqueueColumnarOrJsonChunkMetaWrites = ({
  paths,
  chunkMetaIterator,
  chunkMetaCount,
  resolvedUseColumnar,
  shouldWriteCompatChunkMetaJson,
  outOfOrder,
  projectHotEntry,
  enqueueWrite,
  enqueueJsonArray,
  addPieceFile,
  formatArtifactLabel,
  sharedState
}) => {
  if (resolvedUseColumnar) {
    enqueueWrite(
      formatArtifactLabel(paths.columnarPath),
      async () => {
        let columnarRows = null;
        if (shouldWriteCompatChunkMetaJson) {
          const compatRows = [];
          for (const entry of chunkMetaIterator(0, chunkMetaCount, false)) {
            compatRows.push(projectHotEntry(entry));
          }
          if (outOfOrder) compatRows.sort(compareChunkMetaIdOnly);
          columnarRows = compatRows;
          sharedState.preparedColumnarHotRows = compatRows;
          await writeJsonArrayFile(paths.compatJsonPath, compatRows, { atomic: true });
        } else {
          await removeArtifact(paths.compatJsonPath);
        }
        await removeArtifact(paths.compatJsonGzPath);
        await removeArtifact(paths.compatJsonZstPath);
        const payload = Array.isArray(columnarRows)
          ? buildColumnarChunkMetaFromRows(columnarRows)
          : buildColumnarChunkMeta(chunkMetaIterator, chunkMetaCount);
        await writeJsonObjectFile(paths.columnarPath, { fields: payload, atomic: true });
      }
    );
    addPieceFile({
      type: 'chunks',
      name: 'chunk_meta',
      format: 'columnar',
      count: chunkMetaCount
    }, paths.columnarPath);
    return;
  }

  enqueueJsonArray('chunk_meta', chunkMetaIterator(), {
    piece: { type: 'chunks', name: 'chunk_meta', count: chunkMetaCount }
  });
};

const toAsyncIterable = (rows) => {
  if (rows && typeof rows[Symbol.asyncIterator] === 'function') return rows;
  return (async function* rowIterator() {
    for (const row of rows || []) {
      yield row;
    }
  })();
};

/**
 * Queue optional binary-columnar chunk_meta write.
 *
 * @param {object} input
 * @returns {void}
 */
export const enqueueBinaryColumnarChunkMetaWrite = ({
  paths,
  chunkMetaBinaryColumnar,
  chunkMetaEstimatedJsonlBytes,
  chunkMetaCount,
  chunkMetaIterator,
  projectHotEntry,
  outOfOrder,
  orderingHash,
  orderingCount,
  sharedState,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel
}) => {
  if (!chunkMetaBinaryColumnar) return;
  const binaryColumnarEstimatedBytes = Number.isFinite(Number(chunkMetaEstimatedJsonlBytes))
    ? Math.max(0, Math.floor(Number(chunkMetaEstimatedJsonlBytes)))
    : null;
  enqueueWrite(
    formatArtifactLabel(paths.binaryMetaPath),
    async () => {
      const fileTable = [];
      const fileRefByPath = new Map();
      let sourceRows = Array.isArray(sharedState.preparedColumnarHotRows)
        ? sharedState.preparedColumnarHotRows
        : mapRows(
          chunkMetaIterator(0, chunkMetaCount, false),
          (entry) => projectHotEntry(entry)
        );
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
        dataPath: paths.binaryDataPath,
        offsetsPath: paths.binaryOffsetsPath,
        lengthsPath: paths.binaryLengthsPath
      });
      await writeJsonObjectFile(paths.binaryMetaPath, {
        fields: {
          format: 'binary-columnar-v1',
          rowEncoding: 'json-rows',
          count: frames.count,
          data: path.basename(paths.binaryDataPath),
          offsets: path.basename(paths.binaryOffsetsPath),
          lengths: path.basename(paths.binaryLengthsPath),
          orderingHash,
          orderingCount
        },
        arrays: {
          fileTable
        },
        atomic: true
      });
    },
    {
      // Start binary-columnar generation early so it overlaps other long
      // artifact writes instead of becoming the final tail.
      priority: 225,
      estimatedBytes: binaryColumnarEstimatedBytes,
      eagerStart: true,
      laneHint: 'massive'
    }
  );
  addPieceFile({
    type: 'chunks',
    name: 'chunk_meta_binary_columnar',
    format: 'binary-columnar',
    count: chunkMetaCount
  }, paths.binaryDataPath);
  addPieceFile({
    type: 'chunks',
    name: 'chunk_meta_binary_columnar_offsets',
    format: 'binary',
    count: chunkMetaCount
  }, paths.binaryOffsetsPath);
  addPieceFile({
    type: 'chunks',
    name: 'chunk_meta_binary_columnar_lengths',
    format: 'varint',
    count: chunkMetaCount
  }, paths.binaryLengthsPath);
  addPieceFile({
    type: 'chunks',
    name: 'chunk_meta_binary_columnar_meta',
    format: 'json'
  }, paths.binaryMetaPath);
};
