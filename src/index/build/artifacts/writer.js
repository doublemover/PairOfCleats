import path from 'node:path';
import { writeJsonArrayFile, writeJsonObjectFile } from '../../../shared/json-stream.js';

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

  return {
    enqueueJsonObject,
    enqueueJsonArray
  };
};
