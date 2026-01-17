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
  compressibleArtifacts
}) => {
  const artifactPath = (base, compressed) => path.join(
    outDir,
    compressed ? `${base}.json.gz` : `${base}.json`
  );

  const shouldCompress = (base, compressible) => (
    compressionEnabled && compressible && compressibleArtifacts.has(base)
  );

  const enqueueJsonObject = (base, payload, { compressible = true, piece = null } = {}) => {
    if (shouldCompress(base, compressible)) {
      const gzPath = artifactPath(base, true);
      enqueueWrite(
        formatArtifactLabel(gzPath),
        () => writeJsonObjectFile(gzPath, {
          ...payload,
          compression: compressionMode,
          atomic: true
        })
      );
      if (piece) {
        addPieceFile({ ...piece, format: 'json', compression: compressionMode }, gzPath);
      }
      if (compressionKeepRaw) {
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
    if (shouldCompress(base, compressible)) {
      const gzPath = artifactPath(base, true);
      enqueueWrite(
        formatArtifactLabel(gzPath),
        () => writeJsonArrayFile(gzPath, items, {
          compression: compressionMode,
          atomic: true
        })
      );
      if (piece) {
        addPieceFile({ ...piece, format: 'json', compression: compressionMode }, gzPath);
      }
      if (compressionKeepRaw) {
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
