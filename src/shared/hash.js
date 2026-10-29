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
const EXACT_IDENTITY_FIELDS = Object.freeze(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']);
const captureExactFileIdentity = async descriptor => {
  const stat = await descriptor.stat({ bigint: true });
  const regular = stat.isFile();
  const identity = Object.fromEntries(EXACT_IDENTITY_FIELDS.map(key => [key, stat[key]]));
  if (!regular || EXACT_IDENTITY_FIELDS.some(key => typeof identity[key] !== 'bigint')) throw changedFile();
  return Object.freeze(identity);
};
const withFileHasher = async (filePath, createHasher, { containedRoot = null, signal = null } = {}, includeObservation = false) => {
  throwIfAborted(signal);
  const compute = async descriptor => {
    const hasher = createHasher(), update = hasher.update, digest = hasher.digest;
    if (typeof update !== 'function' || typeof digest !== 'function') throw new TypeError('File hash requires its original incremental operations.');
    const before = await descriptor.stat();
    if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size < 0) {
      throw new Error('File hash requires a bounded regular file extent.');
    }
    const exactBefore = includeObservation ? await captureExactFileIdentity(descriptor) : null;
    if (exactBefore && exactBefore.size !== BigInt(before.size)) throw changedFile();
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
    throwIfAborted(signal);
    const value = await digest.call(hasher);
    throwIfAborted(signal);
    const after = await descriptor.stat();
    if (!after.isFile() || ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(key => before[key] !== after[key])) throw changedFile();
    const exactAfter = includeObservation ? await captureExactFileIdentity(descriptor) : null;
    if (exactAfter && EXACT_IDENTITY_FIELDS.some(key => exactBefore[key] !== exactAfter[key])) throw changedFile();
    descriptor.verify?.();
    throwIfAborted(signal);
    return includeObservation ? Object.freeze({ value, bytes: after.size,
      fileIdentity: Object.freeze({ dev: exactAfter.dev.toString(), ino: exactAfter.ino.toString() }),
      identity: Object.freeze(Object.fromEntries(['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].map(key => [key, after[key]]))) }) : value;
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

const digestFile = (filePath, algorithm, options, includeObservation = false) => withFileHasher(filePath, () => {
  const hash = crypto.createHash(algorithm), update = hash.update, digest = hash.digest;
  return { update: bytes => update.call(hash, bytes), digest: () => digest.call(hash, 'hex') };
}, options, includeObservation);

/** Compute SHA256 and settle only after the owned descriptor has closed. */
export function sha256File(filePath, options = {}) {
  return digestFile(filePath, 'sha256', options);
}

/** Internal integrity admission: exact descriptor identity, extent and SHA256
 * are captured together and returned only after the original file closes. */
export async function sha256FileObservation(filePath, options = {}) {
  return Object.freeze({ algo: 'sha256', ...await digestFile(filePath, 'sha256', options, true) });
}

/** Compute the finite integrity digests over one original descriptor and byte
 * stream. Its exact extent/identity and all digests settle together after close.
 * A second pathname read cannot qualify a different snapshot's checksum. */
export async function hashFileObservation(filePath, { algorithms = ['sha256'], ...options } = {}) {
  if (!Array.isArray(algorithms) || !algorithms.length
    || algorithms.some(value => !['sha256', 'sha1', 'xxh64'].includes(value))) {
    throw new TypeError('File integrity requires supported digest algorithms.');
  }
  throwIfAborted(options.signal);
  const selected = [...new Set(algorithms)];
  const backend = selected.includes('xxh64') ? await getBackend() : null;
  throwIfAborted(options.signal);
  const result = await withFileHasher(filePath, () => {
    const hashes = selected.map(algorithm => {
      const hasher = algorithm === 'xxh64' ? backend.createHasher() : crypto.createHash(algorithm);
      const update = hasher.update, digest = hasher.digest;
      return { algorithm, update: bytes => update.call(hasher, bytes),
        digest: () => digest.call(hasher, ...(algorithm === 'xxh64' ? [] : ['hex'])) };
    });
    return {
      update: bytes => { for (const hash of hashes) hash.update(bytes); },
      digest: async () => {
        const values = {};
        for (const hash of hashes) values[hash.algorithm] = await hash.digest();
        return Object.freeze(values);
      }
    };
  }, options, true);
  return result;
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

/** Internal publication observation: checksum and byte extent come from the
 * same verified original descriptor, and return only after its actual close. */
export async function checksumFileObservation(filePath, options = {}) {
  const backend = await getBackend(), createHasher = backend.createHasher;
  const result = await withFileHasher(filePath, () => createHasher.call(backend), options, true);
  return Object.freeze({ algo: 'xxh64', ...result });
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
