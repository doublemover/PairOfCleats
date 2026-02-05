import path from 'node:path';

import { writeJsonArrayFile, writeJsonObjectFile, writeJsonLinesSharded } from '../../../shared/json-stream.js';
import { estimateJsonBytes } from '../../../shared/cache.js';

export const createArtifactWriter = ({
  outDir,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel,
  compressionEnabled,
  compressionMode,
  compressionKeepRaw,
  compressionGzipOptions,
  compressibleArtifacts,
  compressionOverrides
}) => {
  const compressedSuffix = compressionMode === 'zstd' ? 'json.zst' : 'json.gz';
  const artifactPath = (base, compressed) => path.join(
    outDir,
    compressed ? `${base}.${compressedSuffix}` : `${base}.json`
  );

  const resolveOverride = (base) => (
    compressionOverrides && Object.prototype.hasOwnProperty.call(compressionOverrides, base)
      ? compressionOverrides[base]
      : null
  );
  const resolveCompression = (base, compressible) => {
    const override = resolveOverride(base);
    if (override) {
      return override.enabled ? override.mode : null;
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

  const enqueueJsonObject = (base, payload, { compressible = true, piece = null } = {}) => {
    const compression = resolveCompression(base, compressible);
    const keepRaw = resolveKeepRaw(base);
    if (compression) {
      const gzPath = artifactPath(base, true);
      enqueueWrite(
        formatArtifactLabel(gzPath),
        () => writeJsonObjectFile(gzPath, {
          ...payload,
          compression,
          gzipOptions: compressionGzipOptions,
          atomic: true
        })
      );
      if (piece) {
        addPieceFile({ ...piece, format: 'json', compression }, gzPath);
      }
      if (keepRaw) {
        const rawPath = artifactPath(base, false);
        enqueueWrite(
          formatArtifactLabel(rawPath),
          () => writeJsonObjectFile(rawPath, { ...payload, atomic: true })
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
      () => writeJsonObjectFile(rawPath, { ...payload, atomic: true })
    );
    if (piece) {
      addPieceFile({ ...piece, format: 'json' }, rawPath);
    }
  };

  const enqueueJsonArray = (base, items, { compressible = true, piece = null } = {}) => {
    const compression = resolveCompression(base, compressible);
    const keepRaw = resolveKeepRaw(base);
    if (compression) {
      const gzPath = artifactPath(base, true);
      enqueueWrite(
        formatArtifactLabel(gzPath),
        () => writeJsonArrayFile(gzPath, items, {
          compression,
          gzipOptions: compressionGzipOptions,
          atomic: true
        })
      );
      if (piece) {
        addPieceFile({ ...piece, format: 'json', compression }, gzPath);
      }
      if (keepRaw) {
        const rawPath = artifactPath(base, false);
        enqueueWrite(
          formatArtifactLabel(rawPath),
          () => writeJsonArrayFile(rawPath, items, { atomic: true })
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
      () => writeJsonArrayFile(rawPath, items, { atomic: true })
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
      piece = null,
      compression = null,
      gzipOptions = null,
      metaExtensions = null
    } = {}
  ) => {
    const estimatedBytes = estimateJsonBytes(items);
    const resolvedMaxBytes = Number.isFinite(Number(maxBytes)) ? Math.max(0, Math.floor(Number(maxBytes))) : 0;
    if (!resolvedMaxBytes || estimatedBytes <= resolvedMaxBytes) {
      enqueueJsonArray(base, items, { compressible: false, piece });
      return;
    }
    const partsDirName = `${base}.parts`;
    const partPrefix = `${base}.part-`;
    const partsDirPath = path.join(outDir, partsDirName);
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
          gzipOptions: compression ? gzipOptions : null
        });
        const parts = result.parts.map((part, index) => ({
          path: part,
          records: result.counts[index] || 0,
          bytes: result.bytes[index] || 0
        }));
        const metaPath = path.join(outDir, `${base}.meta.json`);
        await writeJsonObjectFile(metaPath, {
          fields: {
            schemaVersion: '1.0.0',
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
            extensions: metaExtensions || undefined
          },
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
