import path from 'node:path';

import { writeJsonArrayFile, writeJsonObjectFile, writeJsonLinesSharded } from '../../../shared/json-stream.js';
import { estimateJsonBytes } from '../../../shared/cache.js';
import { SHARDED_JSONL_META_SCHEMA_VERSION } from '../../../contracts/versioning.js';

export const createArtifactWriter = ({
  outDir,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel,
  compressionEnabled,
  compressionMode,
  compressionKeepRaw,
  compressionGzipOptions,
  compressionMinBytes = 0,
  compressionMaxBytes = 0,
  compressibleArtifacts,
  compressionOverrides,
  jsonArraySerializeShardThresholdMs = 0,
  jsonArraySerializeShardMaxBytes = 0
}) => {
  const resolveCompressedSuffix = (mode) => (mode === 'zstd' ? 'json.zst' : 'json.gz');
  const artifactPath = (base, mode) => path.join(
    outDir,
    mode ? `${base}.${resolveCompressedSuffix(mode)}` : `${base}.json`
  );

  const resolveOverride = (base) => (
    compressionOverrides && Object.prototype.hasOwnProperty.call(compressionOverrides, base)
      ? compressionOverrides[base]
      : null
  );
  const shouldSkipCompressionForSize = (estimatedBytes) => {
    const bytes = Number.isFinite(Number(estimatedBytes))
      ? Math.max(0, Math.floor(Number(estimatedBytes)))
      : 0;
    if (bytes <= 0) return false;
    if (Number.isFinite(Number(compressionMinBytes)) && Number(compressionMinBytes) > 0 && bytes < Number(compressionMinBytes)) {
      return true;
    }
    if (Number.isFinite(Number(compressionMaxBytes)) && Number(compressionMaxBytes) > 0 && bytes > Number(compressionMaxBytes)) {
      return true;
    }
    return false;
  };
  const resolveCompression = (base, compressible, estimatedBytes = null) => {
    const override = resolveOverride(base);
    if (override) {
      return override.enabled ? override.mode : null;
    }
    if (shouldSkipCompressionForSize(estimatedBytes)) {
      return null;
    }
    return compressionEnabled && compressible && compressibleArtifacts.has(base)
      ? compressionMode
      : null;
  };
  const resolveKeepRaw = (base) => {
    const override = resolveOverride(base);
    return override && typeof override.keepRaw === 'boolean'
      ? override.keepRaw
      : compressionKeepRaw;
  };

  const enqueueJsonObject = (
    base,
    payload,
    {
      compressible = true,
      piece = null,
      priority = null,
      estimatedBytes = null
    } = {}
  ) => {
    const compression = resolveCompression(base, compressible, estimatedBytes);
    const keepRaw = resolveKeepRaw(base);
    if (compression) {
      const gzPath = artifactPath(base, compression);
      enqueueWrite(
        formatArtifactLabel(gzPath),
        () => writeJsonObjectFile(gzPath, {
          ...payload,
          compression,
          gzipOptions: compressionGzipOptions,
          checksumAlgo: 'sha1',
          atomic: true
        }),
        { priority, estimatedBytes }
      );
      if (piece) {
        addPieceFile({ ...piece, format: 'json', compression }, gzPath);
      }
      if (keepRaw) {
        const rawPath = artifactPath(base, false);
        enqueueWrite(
          formatArtifactLabel(rawPath),
          () => writeJsonObjectFile(rawPath, { ...payload, checksumAlgo: 'sha1', atomic: true }),
          { priority, estimatedBytes }
        );
        if (piece) {
          addPieceFile({ ...piece, format: 'json' }, rawPath);
        }
      }
      return;
    }
    const rawPath = artifactPath(base, false);
    enqueueWrite(
      formatArtifactLabel(rawPath),
      () => writeJsonObjectFile(rawPath, { ...payload, checksumAlgo: 'sha1', atomic: true }),
      { priority, estimatedBytes }
    );
    if (piece) {
      addPieceFile({ ...piece, format: 'json' }, rawPath);
    }
  };

  const enqueueJsonArray = (
    base,
    items,
    {
      compressible = true,
      piece = null,
      priority = null,
      estimatedBytes = null
    } = {}
  ) => {
    const compression = resolveCompression(base, compressible, estimatedBytes);
    const keepRaw = resolveKeepRaw(base);
    if (compression) {
      const gzPath = artifactPath(base, compression);
      enqueueWrite(
        formatArtifactLabel(gzPath),
        () => writeJsonArrayFile(gzPath, items, {
          compression,
          gzipOptions: compressionGzipOptions,
          checksumAlgo: 'sha1',
          atomic: true
        }),
        { priority, estimatedBytes }
      );
      if (piece) {
        addPieceFile({ ...piece, format: 'json', compression }, gzPath);
      }
      if (keepRaw) {
        const rawPath = artifactPath(base, false);
        enqueueWrite(
          formatArtifactLabel(rawPath),
          () => writeJsonArrayFile(rawPath, items, { checksumAlgo: 'sha1', atomic: true }),
          { priority, estimatedBytes }
        );
        if (piece) {
          addPieceFile({ ...piece, format: 'json' }, rawPath);
        }
      }
      return;
    }
    const rawPath = artifactPath(base, false);
    enqueueWrite(
      formatArtifactLabel(rawPath),
      () => writeJsonArrayFile(rawPath, items, { checksumAlgo: 'sha1', atomic: true }),
      { priority, estimatedBytes }
    );
    if (piece) {
      addPieceFile({ ...piece, format: 'json' }, rawPath);
    }
  };

  const enqueueJsonArraySharded = (
    base,
    items,
    {
      maxBytes = 0,
      estimatedBytes = null,
      piece = null,
      compression = null,
      gzipOptions = null,
      metaExtensions = null,
      offsets = null
    } = {}
  ) => {
    /**
     * Predict full-array stringify cost from a bounded sample.
     * This is a fast heuristic used only to decide when to force shard sizing
     * for callers that did not provide an explicit max-bytes policy.
     * @param {Array<object>} rows
     * @returns {number}
     */
    const estimateArraySerializationMs = (rows) => {
      if (!Array.isArray(rows) || !rows.length) return 0;
      const sampleSize = Math.min(rows.length, 128);
      const startedAtNs = process.hrtime.bigint();
      for (let index = 0; index < sampleSize; index += 1) {
        JSON.stringify(rows[index]);
      }
      const elapsedMs = Number(process.hrtime.bigint() - startedAtNs) / 1_000_000;
      if (elapsedMs <= 0) return 0;
      return Math.ceil((elapsedMs / sampleSize) * rows.length);
    };
    const resolvedEstimatedBytes = Number.isFinite(Number(estimatedBytes))
      ? Math.max(0, Math.floor(Number(estimatedBytes)))
      : estimateJsonBytes(items);
    let resolvedMaxBytes = Number.isFinite(Number(maxBytes)) ? Math.max(0, Math.floor(Number(maxBytes))) : 0;
    const serializationThresholdMs = Number.isFinite(Number(jsonArraySerializeShardThresholdMs))
      ? Math.max(0, Math.floor(Number(jsonArraySerializeShardThresholdMs)))
      : 0;
    let predictedSerializeMs = 0;
    if (serializationThresholdMs > 0 && Array.isArray(items) && items.length) {
      predictedSerializeMs = estimateArraySerializationMs(items);
      if (predictedSerializeMs >= serializationThresholdMs) {
        resolvedMaxBytes = Number.isFinite(Number(jsonArraySerializeShardMaxBytes)) && Number(jsonArraySerializeShardMaxBytes) > 0
          ? Math.floor(Number(jsonArraySerializeShardMaxBytes))
          : Math.max(1024 * 1024, Math.floor(resolvedEstimatedBytes / 4));
      }
    }
    if (!resolvedMaxBytes || resolvedEstimatedBytes <= resolvedMaxBytes) {
      enqueueJsonArray(base, items, { compressible: false, piece });
      return;
    }
    const partsDirName = `${base}.parts`;
    const partPrefix = `${base}.part-`;
    const partsDirPath = path.join(outDir, partsDirName);
    const resolvedOffsets = offsets
      ? (typeof offsets === 'object' ? offsets : { suffix: 'offsets.bin' })
      : null;
    enqueueWrite(
      formatArtifactLabel(partsDirPath),
      async () => {
        const result = await writeJsonLinesSharded({
          dir: outDir,
          partsDirName,
          partPrefix,
          items,
          maxBytes: resolvedMaxBytes,
          atomic: true,
          compression: compression || null,
          gzipOptions: compression ? gzipOptions : null,
          offsets: resolvedOffsets
        });
        const parts = result.parts.map((part, index) => ({
          path: part,
          records: result.counts[index] || 0,
          bytes: result.bytes[index] || 0
        }));
        const metaPath = path.join(outDir, `${base}.meta.json`);
        await writeJsonObjectFile(metaPath, {
          fields: {
            schemaVersion: SHARDED_JSONL_META_SCHEMA_VERSION,
            artifact: base,
            format: 'jsonl-sharded',
            generatedAt: new Date().toISOString(),
            compression: compression || 'none',
            totalRecords: result.total,
            totalBytes: result.totalBytes,
            maxPartRecords: result.maxPartRecords,
            maxPartBytes: result.maxPartBytes,
            targetMaxBytes: result.targetMaxBytes,
            parts,
            ...(result.offsets ? { offsets: result.offsets } : {}),
            extensions: {
              ...(metaExtensions || {}),
              ...(predictedSerializeMs > 0 ? { predictedSerializeMs } : {})
            }
          },
          checksumAlgo: 'sha1',
          atomic: true
        });
        for (let i = 0; i < result.parts.length; i += 1) {
          const relPath = result.parts[i];
          const absPath = path.join(outDir, relPath);
          addPieceFile({
            ...(piece || {}),
            format: 'jsonl',
            count: result.counts[i] || 0,
            compression: compression || null
          }, absPath);
        }
        addPieceFile({ type: piece?.type || 'chunks', name: `${base}_meta`, format: 'json' }, metaPath);
      }
    );
  };

  return {
    enqueueJsonObject,
    enqueueJsonArray,
    enqueueJsonArraySharded
  };
};
