import fs from 'node:fs/promises';
import path from 'node:path';

import { estimateJsonBytes } from '../../../shared/cache.js';
import { writeJsonObjectFile } from '../../../shared/json-stream.js';
import { createJsonWriteStream, writeChunk } from '../../../shared/json-stream/streams.js';
import {
  resolveBinaryColumnarWriteHints,
  writeBinaryRowFrames
} from '../../../shared/artifact-io/binary-columnar.js';
import { formatBytes } from './helpers.js';
import { resolveAdaptiveShardCount } from './write-strategy.js';

export const FIELD_POSTINGS_WRITE_BATCH_TARGET_BYTES = 128 * 1024;
export const FIELD_POSTINGS_VALUE_CACHE_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Build deterministic shard part descriptors for field_postings shards.
 *
 * @param {object} input
 * @param {string} input.outDir
 * @param {number} input.fieldCount
 * @param {number} input.shardCount
 * @returns {{relPath:string,absPath:string,start:number,end:number,count:number}[]}
 */
export const planFieldPostingsShardParts = ({ outDir, fieldCount, shardCount }) => {
  const resolvedFieldCount = Math.max(0, Math.floor(Number(fieldCount) || 0));
  const resolvedShardCount = Math.max(1, Math.floor(Number(shardCount) || 1));
  const shardSize = Math.max(1, Math.ceil(resolvedFieldCount / resolvedShardCount));
  const parts = [];
  for (let shardIndex = 0; shardIndex < resolvedShardCount; shardIndex += 1) {
    const start = shardIndex * shardSize;
    const end = Math.min(resolvedFieldCount, start + shardSize);
    if (start >= end) break;
    const relPath = `field_postings.shards/field_postings.part-${String(shardIndex).padStart(4, '0')}.json`;
    parts.push({
      relPath,
      absPath: path.join(outDir, relPath),
      start,
      end,
      count: end - start
    });
  }
  return parts;
};

/**
 * Create row serializers shared across field_postings artifact variants.
 *
 * Ordering contract:
 * - serializers are positional and rely on caller-provided `fieldNames` ordering
 * - shard files and legacy `field_postings.json` must use the same ordering
 *   to keep determinism hashes stable across split/merged writes
 *
 * Concurrency contract:
 * - serializers are synchronous and side-effect free except cache fills
 * - concurrent queued writes may share one serializer safely because cache
 *   population happens synchronously before each await point
 *
 * @param {object} input
 * @param {string[]} input.fieldNames
 * @param {object} input.fieldPostingsObject
 * @param {boolean} [input.cacheValues]
 * @returns {{serializePairAt:(index:number)=>string,serializeBinaryAt:(index:number)=>string}}
 */
export const createFieldPostingsRowSerializer = ({
  fieldNames,
  fieldPostingsObject,
  cacheValues = false
}) => {
  const keyCache = new Array(fieldNames.length);
  const valueCache = cacheValues ? new Array(fieldNames.length) : null;

  const serializeKeyAt = (index) => {
    const cached = keyCache[index];
    if (typeof cached === 'string') return cached;
    const serialized = JSON.stringify(fieldNames[index]);
    keyCache[index] = serialized;
    return serialized;
  };

  const serializeValueAt = (index) => {
    if (valueCache) {
      const cached = valueCache[index];
      if (typeof cached === 'string') return cached;
    }
    const fieldName = fieldNames[index];
    const serialized = JSON.stringify(fieldPostingsObject[fieldName]);
    if (valueCache) {
      valueCache[index] = serialized;
    }
    return serialized;
  };

  return {
    serializePairAt: (index) => `${serializeKeyAt(index)}:${serializeValueAt(index)}`,
    serializeBinaryAt: (index) => `{"field":${serializeKeyAt(index)},"postings":${serializeValueAt(index)}}`
  };
};

/**
 * Persist one field_postings JSON payload from deterministic field ranges.
 *
 * `ranges` ordering is authoritative. This lets callers enqueue shard writes and
 * compatibility legacy writes in parallel while still guaranteeing that both
 * outputs replay identical field ordering.
 *
 * @param {object} input
 * @param {string} input.targetPath
 * @param {{start:number,end:number}[]} input.ranges
 * @param {(index:number)=>string} input.serializePairAt
 * @param {number} [input.batchTargetBytes]
 * @returns {Promise<{bytes:number|null,checksum:string|null,checksumAlgo:string|null,serializationMs:number,diskMs:number,directFdStreaming:true,durationMs:number}>}
 */
export const writeFieldPostingsJsonFromRanges = async ({
  targetPath,
  ranges,
  serializePairAt,
  batchTargetBytes = FIELD_POSTINGS_WRITE_BATCH_TARGET_BYTES
}) => {
  const startedAt = Date.now();
  let serializationMs = 0;
  let diskMs = 0;
  const {
    stream,
    done,
    getBytesWritten,
    getChecksum,
    checksumAlgo
  } = createJsonWriteStream(targetPath, { atomic: true, checksumAlgo: 'sha1' });

  try {
    let writeStartedAt = Date.now();
    await writeChunk(stream, '{"fields":{');
    diskMs += Math.max(0, Date.now() - writeStartedAt);

    let first = true;
    let pendingChunk = '';
    const flushPendingChunk = async () => {
      if (!pendingChunk) return;
      writeStartedAt = Date.now();
      await writeChunk(stream, pendingChunk);
      diskMs += Math.max(0, Date.now() - writeStartedAt);
      pendingChunk = '';
    };

    for (const range of ranges) {
      if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end)) continue;
      const start = Math.max(0, Math.floor(range.start));
      const end = Math.max(start, Math.floor(range.end));
      for (let index = start; index < end; index += 1) {
        const serializeStartedAt = Date.now();
        const row = `${first ? '' : ','}${serializePairAt(index)}`;
        serializationMs += Math.max(0, Date.now() - serializeStartedAt);
        pendingChunk += row;
        first = false;
        if (pendingChunk.length >= batchTargetBytes) {
          await flushPendingChunk();
        }
      }
    }

    await flushPendingChunk();
    writeStartedAt = Date.now();
    await writeChunk(stream, '}}\n');
    stream.end();
    await done;
    diskMs += Math.max(0, Date.now() - writeStartedAt);

    return {
      bytes: Number.isFinite(getBytesWritten?.()) ? getBytesWritten() : null,
      checksum: typeof getChecksum === 'function' ? getChecksum() : null,
      checksumAlgo: checksumAlgo || null,
      serializationMs,
      diskMs,
      directFdStreaming: true,
      durationMs: Math.max(0, Date.now() - startedAt)
    };
  } catch (err) {
    try { stream.destroy(err); } catch {}
    try { await done; } catch {}
    throw err;
  }
};

/**
 * Enqueue field_postings artifacts (legacy JSON, shards, optional binary-columnar).
 *
 * Queueing behavior:
 * - shard files and legacy `field_postings.json` are separate write jobs
 * - jobs may execute concurrently under adaptive write scheduling
 * - both jobs share one deterministic serializer snapshot so ordering and payload
 *   stay consistent even when completion order differs
 *
 * @param {object} input
 * @param {boolean} input.sparseArtifactsEnabled
 * @param {object} input.postings
 * @param {string} input.outDir
 * @param {(label:string,job:()=>Promise<any>,meta?:object)=>void} input.enqueueWrite
 * @param {(base:string,payload:object,options?:object)=>void} input.enqueueJsonObject
 * @param {(piece:object,filePath:string)=>void} input.addPieceFile
 * @param {(filePath:string)=>string} input.formatArtifactLabel
 * @param {(filePath:string,options?:object)=>Promise<void>} input.removeArtifact
 * @param {(message:string)=>void} input.log
 * @param {number} input.artifactWriteThroughputBytesPerSec
 * @param {object} input.writeFsStrategy
 * @param {boolean} input.fieldPostingsShardsEnabled
 * @param {number} input.fieldPostingsShardThresholdBytes
 * @param {number} input.fieldPostingsShardCount
 * @param {number} input.fieldPostingsShardMinCount
 * @param {number} input.fieldPostingsShardMaxCount
 * @param {number} input.fieldPostingsShardTargetBytes
 * @param {number} input.fieldPostingsShardTargetSeconds
 * @param {boolean} input.fieldPostingsKeepLegacyJson
 * @param {boolean} input.fieldPostingsBinaryColumnar
 * @param {number} input.fieldPostingsBinaryColumnarThresholdBytes
 * @returns {Promise<void>}
 */
export const enqueueFieldPostingsArtifacts = async ({
  sparseArtifactsEnabled,
  postings,
  outDir,
  enqueueWrite,
  enqueueJsonObject,
  addPieceFile,
  formatArtifactLabel,
  removeArtifact,
  log,
  artifactWriteThroughputBytesPerSec,
  writeFsStrategy,
  fieldPostingsShardsEnabled,
  fieldPostingsShardThresholdBytes,
  fieldPostingsShardCount,
  fieldPostingsShardMinCount,
  fieldPostingsShardMaxCount,
  fieldPostingsShardTargetBytes,
  fieldPostingsShardTargetSeconds,
  fieldPostingsKeepLegacyJson,
  fieldPostingsBinaryColumnar,
  fieldPostingsBinaryColumnarThresholdBytes
}) => {
  if (!sparseArtifactsEnabled || !postings?.fieldPostings?.fields) {
    return;
  }

  const fieldPostingsObject = postings.fieldPostings.fields;
  const fieldPostingsEstimatedBytes = estimateJsonBytes(fieldPostingsObject);
  const fieldNames = Object.keys(fieldPostingsObject);

  const shouldShardFieldPostings = fieldPostingsShardsEnabled
    && fieldPostingsShardThresholdBytes > 0
    && fieldPostingsEstimatedBytes >= fieldPostingsShardThresholdBytes
    && fieldNames.length > 1;

  const shouldWriteFieldPostingsBinary = fieldPostingsBinaryColumnar
    && fieldPostingsEstimatedBytes >= fieldPostingsBinaryColumnarThresholdBytes
    && fieldNames.length > 0;

  const cacheFieldPostingsValues = shouldShardFieldPostings
    && fieldPostingsEstimatedBytes <= FIELD_POSTINGS_VALUE_CACHE_MAX_BYTES;

  const rowSerializer = createFieldPostingsRowSerializer({
    fieldNames,
    fieldPostingsObject,
    cacheValues: cacheFieldPostingsValues
  });

  if (shouldShardFieldPostings) {
    const shardsDirPath = path.join(outDir, 'field_postings.shards');
    const shardsMetaPath = path.join(outDir, 'field_postings.shards.meta.json');
    await removeArtifact(shardsDirPath, { recursive: true, policy: 'format_cleanup' });
    await fs.mkdir(shardsDirPath, { recursive: true });

    const resolvedFieldPostingsShardCount = resolveAdaptiveShardCount({
      estimatedBytes: fieldPostingsEstimatedBytes,
      rowCount: fieldNames.length,
      throughputBytesPerSec: artifactWriteThroughputBytesPerSec,
      minShards: fieldPostingsShardMinCount,
      maxShards: fieldPostingsShardMaxCount,
      defaultShards: fieldPostingsShardCount,
      targetShardBytes: fieldPostingsShardTargetBytes,
      targetShardSeconds: fieldPostingsShardTargetSeconds
    });

    const partFiles = planFieldPostingsShardParts({
      outDir,
      fieldCount: fieldNames.length,
      shardCount: resolvedFieldPostingsShardCount
    });

    const partEstimatedBytes = Math.max(
      1,
      Math.floor(fieldPostingsEstimatedBytes / Math.max(1, partFiles.length))
    );

    for (const part of partFiles) {
      enqueueWrite(
        part.relPath,
        () => writeFieldPostingsJsonFromRanges({
          targetPath: part.absPath,
          ranges: [part],
          serializePairAt: rowSerializer.serializePairAt
        }),
        { priority: 206, estimatedBytes: partEstimatedBytes }
      );
      addPieceFile({
        type: 'postings',
        name: 'field_postings_shard',
        format: 'json',
        count: part.count
      }, part.absPath);
    }

    enqueueWrite(
      formatArtifactLabel(shardsMetaPath),
      async () => {
        await writeJsonObjectFile(shardsMetaPath, {
          fields: {
            schemaVersion: '1.0.0',
            generatedAt: new Date().toISOString(),
            shardCount: partFiles.length,
            estimatedBytes: fieldPostingsEstimatedBytes,
            fields: fieldNames.length,
            shardTargetBytes: fieldPostingsShardTargetBytes,
            throughputBytesPerSec: artifactWriteThroughputBytesPerSec,
            parts: partFiles.map((part) => ({
              path: part.relPath,
              fields: part.count
            })),
            merge: {
              strategy: 'streaming-partition-merge',
              outputPath: 'field_postings.json'
            }
          },
          atomic: true
        });
      },
      { priority: 207, estimatedBytes: Math.max(1024, partFiles.length * 128) }
    );

    addPieceFile({ type: 'postings', name: 'field_postings_shards_meta', format: 'json' }, shardsMetaPath);

    if (typeof log === 'function') {
      log(
        `field_postings estimate ~${formatBytes(fieldPostingsEstimatedBytes)}; ` +
        `emitting streamed shards (${partFiles.length} planned, target=${formatBytes(fieldPostingsShardTargetBytes)}).`
      );
    }

    if (!fieldPostingsKeepLegacyJson && typeof log === 'function') {
      log(
        '[warn] fieldPostingsKeepLegacyJson=false ignored while shard readers are unavailable; ' +
        'emitting field_postings.json for compatibility.'
      );
    }

    enqueueWrite(
      'field_postings.json',
      () => writeFieldPostingsJsonFromRanges({
        targetPath: path.join(outDir, 'field_postings.json'),
        ranges: partFiles,
        serializePairAt: rowSerializer.serializePairAt
      }),
      {
        priority: 204,
        estimatedBytes: fieldPostingsEstimatedBytes
      }
    );

    addPieceFile({ type: 'postings', name: 'field_postings' }, path.join(outDir, 'field_postings.json'));
  } else {
    enqueueJsonObject('field_postings', { fields: { fields: fieldPostingsObject } }, {
      piece: { type: 'postings', name: 'field_postings' },
      priority: 220,
      estimatedBytes: fieldPostingsEstimatedBytes
    });
  }

  const fieldPostingsBinaryDataPath = path.join(outDir, 'field_postings.binary-columnar.bin');
  const fieldPostingsBinaryOffsetsPath = path.join(outDir, 'field_postings.binary-columnar.offsets.bin');
  const fieldPostingsBinaryLengthsPath = path.join(outDir, 'field_postings.binary-columnar.lengths.varint');
  const fieldPostingsBinaryMetaPath = path.join(outDir, 'field_postings.binary-columnar.meta.json');

  if (shouldWriteFieldPostingsBinary) {
    enqueueWrite(
      formatArtifactLabel(fieldPostingsBinaryMetaPath),
      async () => {
        const serializationStartedAt = Date.now();
        const rowPayloads = (async function* binaryRows() {
          for (let index = 0; index < fieldNames.length; index += 1) {
            yield rowSerializer.serializeBinaryAt(index);
          }
        })();
        const binaryWriteHints = resolveBinaryColumnarWriteHints({
          estimatedBytes: fieldPostingsEstimatedBytes,
          rowCount: fieldNames.length,
          presize: writeFsStrategy.presizeJsonl
        });
        const frames = await writeBinaryRowFrames({
          rowBuffers: rowPayloads,
          dataPath: fieldPostingsBinaryDataPath,
          offsetsPath: fieldPostingsBinaryOffsetsPath,
          lengthsPath: fieldPostingsBinaryLengthsPath,
          writeHints: binaryWriteHints
        });
        const serializationMs = Math.max(0, Date.now() - serializationStartedAt);
        const diskStartedAt = Date.now();
        const binaryMetaResult = await writeJsonObjectFile(fieldPostingsBinaryMetaPath, {
          fields: {
            format: 'binary-columnar-v1',
            rowEncoding: 'json-rows',
            count: frames.count,
            data: path.basename(fieldPostingsBinaryDataPath),
            offsets: path.basename(fieldPostingsBinaryOffsetsPath),
            lengths: path.basename(fieldPostingsBinaryLengthsPath),
            estimatedSourceBytes: fieldPostingsEstimatedBytes,
            preallocatedBytes: Number.isFinite(frames?.preallocatedBytes) ? frames.preallocatedBytes : 0
          },
          checksumAlgo: 'sha1',
          atomic: true
        });
        return {
          bytes: Number.isFinite(Number(binaryMetaResult?.bytes)) ? Number(binaryMetaResult.bytes) : null,
          checksum: typeof binaryMetaResult?.checksum === 'string' ? binaryMetaResult.checksum : null,
          checksumAlgo: typeof binaryMetaResult?.checksumAlgo === 'string' ? binaryMetaResult.checksumAlgo : null,
          serializationMs,
          diskMs: Math.max(0, Date.now() - diskStartedAt),
          directFdStreaming: true
        };
      },
      {
        priority: 223,
        estimatedBytes: Math.max(fieldPostingsEstimatedBytes, fieldNames.length * 96)
      }
    );

    addPieceFile({
      type: 'postings',
      name: 'field_postings_binary_columnar',
      format: 'binary-columnar',
      count: fieldNames.length
    }, fieldPostingsBinaryDataPath);

    addPieceFile({
      type: 'postings',
      name: 'field_postings_binary_columnar_offsets',
      format: 'binary',
      count: fieldNames.length
    }, fieldPostingsBinaryOffsetsPath);

    addPieceFile({
      type: 'postings',
      name: 'field_postings_binary_columnar_lengths',
      format: 'varint',
      count: fieldNames.length
    }, fieldPostingsBinaryLengthsPath);

    addPieceFile({
      type: 'postings',
      name: 'field_postings_binary_columnar_meta',
      format: 'json'
    }, fieldPostingsBinaryMetaPath);
  } else {
    await Promise.all([
      removeArtifact(fieldPostingsBinaryDataPath, { policy: 'format_cleanup' }),
      removeArtifact(fieldPostingsBinaryOffsetsPath, { policy: 'format_cleanup' }),
      removeArtifact(fieldPostingsBinaryLengthsPath, { policy: 'format_cleanup' }),
      removeArtifact(fieldPostingsBinaryMetaPath, { policy: 'format_cleanup' })
    ]);
  }
};
