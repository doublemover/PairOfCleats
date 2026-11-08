import fs from 'node:fs';
import { withContainedFileSync } from '../../contained-file.js';
import { createContainedFileResource, getContainedFileSession } from '../../contained-file-resource.js';
import { addStorageFailureContext } from '../../storage/operation-error.js';
import { createPackedChecksumValidator } from '../checksum.js';
import { resolveManifestPieceByPath } from '../manifest-sources.js';
import { createLoaderError } from './shared.js';

const STREAM_CHECKSUM_CHUNK_BYTES = 64 * 1024;
const asError = value => value !== null && ['object', 'function'].includes(typeof value) ? value : new Error(String(value), { cause: value });
const checksumFailure = (code, message, value) => {
  const original = asError(value), session = getContainedFileSession(original);
  return addStorageFailureContext(createLoaderError(code, message, original),
    session ? { containedFileSession: session } : {}, original,
    { nonEnumerable: ['containedFileSession'], secondaryPresent: true });
};

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
    throw checksumFailure(
      'ERR_ARTIFACT_CORRUPT',
      `Checksum mismatch for ${baseName}: ${artifactPath}`,
      err
    );
  }
};

export const verifyManifestChecksumFromFile = ({
  validator,
  artifactPath,
  containedRoot = null,
  baseName
}) => {
  if (!validator) return;
  const chunk = Buffer.allocUnsafe(STREAM_CHECKSUM_CHUNK_BYTES);
  let verifyFailed = false;
  const consume = descriptor => {
    const before = descriptor.stat();
    if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size < 0) throw new Error('Checksum source has no exact regular-file extent.');
    let position = 0;
    while (position < before.size) {
      const length = Math.min(chunk.length, before.size - position);
      const bytesRead = descriptor.read(chunk, 0, length, position);
      if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > length) throw new Error('Checksum source has truncated or invalid read progress.');
      validator.update(bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = descriptor.stat();
    if (['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(key => after[key] !== before[key])) throw new Error('Checksum source changed during its bounded stream.');
    if (containedRoot) descriptor.verify();
    try { validator.verify(); } catch (value) { verifyFailed = true; throw value; }
  };
  try {
    if (containedRoot) withContainedFileSync(containedRoot, artifactPath, consume);
    else {
      const methods = { receiver: fs, close: fs.closeSync, stat: fs.fstatSync, read: fs.readSync };
      const fd = fs.openSync(artifactPath, 'r');
      createContainedFileResource({ fd, sync: true, methods }).runSync(consume);
    }
  } catch (err) {
    throw checksumFailure(verifyFailed ? 'ERR_ARTIFACT_CORRUPT' : 'ERR_ARTIFACT_READ',
      verifyFailed ? `Checksum mismatch for ${baseName}: ${artifactPath}`
        : `Failed to stream payload for checksum verification (${baseName}): ${artifactPath}`, err);
  }
};
