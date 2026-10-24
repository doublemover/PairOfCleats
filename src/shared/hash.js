import crypto from 'node:crypto';
import { throwIfAborted } from './abort.js';
import fs from 'node:fs/promises';
import { withContainedFile } from './contained-file.js';
import { createContainedFileResource } from './contained-file-resource.js';

let backendOverride = null;
let backendName = null;
let backendPromise = null;
const resolveBackendName = () => {
  if (backendOverride) return backendOverride;
  return 'auto';
};

const getBackend = async () => {
  const next = resolveBackendName();
  if (backendPromise && backendName === next) return backendPromise;
  backendName = next;
  backendPromise = import('./hash/xxhash-backend.js').then(({ resolveXxhashBackend }) =>
    resolveXxhashBackend({ backend: next, verbose: false }));
  return backendPromise;
};

/**
 * Compute a SHA1 hash hex string.
 * @param {string} str
 * @returns {string}
 */
export function sha1(str) {
  return crypto.createHash('sha1').update(str).digest('hex');
}

const changedFile = () => Object.assign(new Error('File changed during its admitted hash read.'), { code: 'ERR_FILE_CHANGED' });
const withFileHasher = async (filePath, createHasher, { containedRoot = null, signal = null } = {}) => {
  throwIfAborted(signal);
  const compute = async descriptor => {
    const hasher = createHasher(), update = hasher.update, digest = hasher.digest;
    if (typeof update !== 'function' || typeof digest !== 'function') throw new TypeError('File hash requires its original incremental operations.');
    const before = await descriptor.stat();
    if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size < 0) {
      throw new Error('File hash requires a bounded regular file extent.');
    }
    const buffer = Buffer.allocUnsafe(Math.min(65536, before.size));
    let position = 0;
    while (position < before.size) {
      throwIfAborted(signal);
      const allowance = Math.min(buffer.length, before.size - position);
      const { bytesRead } = await descriptor.read(buffer, 0, allowance, position);
      if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > allowance) throw changedFile();
      update.call(hasher, buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await descriptor.stat();
    if (!after.isFile() || ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(key => before[key] !== after[key])) throw changedFile();
    descriptor.verify?.();
    throwIfAborted(signal);
    return digest.call(hasher);
  };
  if (containedRoot) return withContainedFile(containedRoot, filePath, compute);
  const open = fs.open, handle = await open.call(fs, filePath, 'r');
  return createContainedFileResource({ handle, sync: false }).run(compute);
};

/**
 * Compute a SHA1 hash for a file on disk.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export function sha1File(filePath, options = {}) {
  return digestFile(filePath, 'sha1', options);
}

const digestFile = (filePath, algorithm, options) => withFileHasher(filePath, () => {
  const hash = crypto.createHash(algorithm), update = hash.update, digest = hash.digest;
  return { update: bytes => update.call(hash, bytes), digest: () => digest.call(hash, 'hex') };
}, options);

/** Compute SHA256 and settle only after the owned descriptor has closed. */
export function sha256File(filePath, options = {}) {
  return digestFile(filePath, 'sha256', options);
}

export async function checksumString(input) {
  const backend = await getBackend();
  const value = await backend.hash64(input);
  return { algo: 'xxh64', value };
}

export async function checksumFile(filePath, options = {}) {
  const backend = await getBackend();
  const createHasher = backend.createHasher;
  const value = await withFileHasher(filePath, () => createHasher.call(backend), options);
  return { algo: 'xxh64', value };
}

export async function getXxhashBackend() {
  try {
    const backend = await getBackend();
    return backend?.name || null;
  } catch {
    return null;
  }
}

export function setXxhashBackend(backend) {
  backendOverride = typeof backend === 'string' && backend.trim() ? backend.trim() : null;
  backendName = null;
  backendPromise = null;
}
