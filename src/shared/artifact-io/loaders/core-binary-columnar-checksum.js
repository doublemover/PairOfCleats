import fs from 'node:fs';
import { createPackedChecksumValidator } from '../checksum.js';
import { resolveManifestPieceByPath } from '../manifest-sources.js';
import { createLoaderError } from './shared.js';

const STREAM_CHECKSUM_CHUNK_BYTES = 64 * 1024;

export const createManifestChecksumValidator = ({
  manifest,
  dir,
  targetPath,
  expectedName,
  label
}) => {
  const piece = resolveManifestPieceByPath({
    manifest,
    dir,
    targetPath,
    expectedName
  });
  if (!piece || typeof piece.checksum !== 'string' || !piece.checksum.includes(':')) {
    return null;
  }
  try {
    return createPackedChecksumValidator(
      { checksum: piece.checksum },
      { label }
    );
  } catch {
    return null;
  }
};

export const verifyManifestChecksum = ({
  validator,
  buffer,
  baseName,
  artifactPath
}) => {
  if (!validator) return;
  try {
    validator.update(buffer);
    validator.verify();
  } catch (err) {
    throw createLoaderError(
      'ERR_ARTIFACT_CORRUPT',
      `Checksum mismatch for ${baseName}: ${artifactPath}`,
      err instanceof Error ? err : null
    );
  }
};

export const verifyManifestChecksumFromFile = ({
  validator,
  artifactPath,
  baseName
}) => {
  if (!validator) return;
  const chunk = Buffer.allocUnsafe(STREAM_CHECKSUM_CHUNK_BYTES);
  let handle = null;
  let readError = null;
  try {
    handle = fs.openSync(artifactPath, 'r');
    while (true) {
      const bytesRead = fs.readSync(handle, chunk, 0, chunk.length, null);
      if (!Number.isFinite(bytesRead) || bytesRead <= 0) break;
      validator.update(bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead));
    }
  } catch (err) {
    readError = err instanceof Error ? err : new Error(String(err));
  } finally {
    if (handle != null) {
      try {
        fs.closeSync(handle);
      } catch {}
    }
  }
  if (readError) {
    throw createLoaderError(
      'ERR_ARTIFACT_READ',
      `Failed to stream payload for checksum verification (${baseName}): ${artifactPath}`,
      readError
    );
  }
  try {
    validator.verify();
  } catch (err) {
    throw createLoaderError(
      'ERR_ARTIFACT_CORRUPT',
      `Checksum mismatch for ${baseName}: ${artifactPath}`,
      err instanceof Error ? err : null
    );
  }
};
