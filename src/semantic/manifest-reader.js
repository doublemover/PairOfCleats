import path from 'node:path';
import { readVerifiedContainedFile } from '../shared/contained-file.js';
import { checksumString } from '../shared/hash.js';
import { throwIfAborted } from '../shared/abort.js';
import { observeStorageResource } from '../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../shared/storage/operation-error.js';

export const SEMANTIC_MANIFEST_MAX_BYTES = 32 * 1024 * 1024;
const integrity = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_INTEGRITY' });

/**
 * Capture one registered JSON metadata file, at most 32 MiB, through the
 * contained-file owner. SHA-256, SHA-1 and xxh64 registrations certify exactly
 * the returned snapshot, never a later path read. Its descriptor has settled
 * before decode; the byte buffer is request-local and is not retained by stores.
 * Abort and unsettled close failures retain their original resource evidence.
 * @param {string} indexDir pinned generation root
 * @param {{path: string, checksum: string, bytes?: number}} piece registration
 * @param {AbortSignal|null} signal request lifetime
 * @returns {Promise<object>} parsed JSON from the verified snapshot
 */
export const readSemanticManifest = async (indexDir, piece, signal = null) => {
  throwIfAborted(signal);
  const { path: relativePath, checksum: expectedChecksum, bytes: expectedBytes } = piece;
  const validChecksum = typeof expectedChecksum === 'string'
    && /^(sha256:[a-f0-9]{64}|sha1:[a-f0-9]{40}|xxh64:[a-f0-9]{16})$/.test(expectedChecksum);
  if (!validChecksum || typeof relativePath !== 'string' || relativePath.includes('\\') || relativePath.includes(':')
    || relativePath.split('/').some(part => !part || part === '.' || part === '..')
    || (expectedBytes !== undefined && (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0))) {
    throw integrity('Invalid registered semantic manifest identity.');
  }
  const [algorithm, expectedHash] = expectedChecksum.split(':');
  let snapshot;
  try {
    snapshot = await readVerifiedContainedFile(indexDir, path.join(indexDir, relativePath), {
      maxBytes: SEMANTIC_MANIFEST_MAX_BYTES, expectedBytes: expectedBytes ?? null, signal,
      ...(algorithm === 'xxh64' ? {} : { hashAlgorithm: algorithm, expectedHash })
    });
  } catch (caught) {
    const observation = observeStorageResource(caught, { phase: 'semantic-manifest-read' });
    observation.requireSettled();
    let code;
    try { code = caught?.code; }
    catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
    observation.requireSettled();
    if (['ERR_FILE_CHANGED', 'ERR_FILE_TOO_LARGE', 'ERR_FILE_INTEGRITY', 'ERR_UNSAFE_FILE_PATH'].includes(code)) {
      throw addStorageFailureContext(integrity('Semantic manifest hash, size or containment mismatch: ' + relativePath), {},
        observation.retain(), { secondaryPresent: true });
    }
    throw caught;
  }
  throwIfAborted(signal);
  if (algorithm === 'xxh64') {
    const actual = await checksumString(snapshot.buffer);
    throwIfAborted(signal);
    if (expectedChecksum !== actual.algo + ':' + actual.value) throw integrity('Semantic manifest checksum mismatch: ' + relativePath);
  }
  throwIfAborted(signal);
  return JSON.parse(snapshot.buffer.toString('utf8'));
};
