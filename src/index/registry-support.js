import fs from 'node:fs';
import path from 'node:path';
import { toRealPathSync } from '../workspace/identity.js';
import { createError, ERROR_CODES } from '../shared/error-codes.js';
import { isAbsolutePathAny, toPosix } from '../shared/file-paths.js';
import { releaseFileLockOrThrow } from '../shared/locks/file-lock.js';
import { atomicWriteText } from '../shared/io/atomic-write.js';
import { stableStringify } from '../shared/stable-json.js';
import { isManifestPathSafe } from './validate/paths.js';
import {
  acquireRegistryLock,
  assertBorrowedRegistryLock,
  attachRegistryLockSignalCleanup
} from './registry-lock.js';

export const registryQueueError = (message, details = null) => (
  createError(ERROR_CODES.QUEUE_OVERLOADED, message, details)
);

export const registryInvalidRequest = (message, details = null) => (
  createError(ERROR_CODES.INVALID_REQUEST, message, details)
);

export const isRegistryObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

export const deepCloneRegistryJson = (value) => JSON.parse(JSON.stringify(value));

export const assertNoAbsolutePathLeak = (value, cursor = '$') => {
  if (typeof value === 'string') {
    if (isAbsolutePathAny(value)) {
      throw registryInvalidRequest(`Absolute path leak at ${cursor}.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      assertNoAbsolutePathLeak(value[i], `${cursor}[${i}]`);
    }
    return;
  }
  if (!isRegistryObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    assertNoAbsolutePathLeak(entry, `${cursor}.${key}`);
  }
};

export const normalizeRegistryRelativePath = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw registryInvalidRequest(`${label} must be a non-empty path string.`);
  }
  const normalized = toPosix(value.trim());
  if (!isManifestPathSafe(normalized)) {
    throw registryInvalidRequest(`${label} must be repo-cache-relative and traversal-safe.`);
  }
  return normalized;
};

export const ensureRegistryId = (value, pattern, message) => {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw registryInvalidRequest(message);
  }
};

export const assertRegistryDirectory = (directory) => {
  const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) {
    throw registryInvalidRequest(`Registry directory must not be a link or file: ${directory}`);
  }
};

export const resolveRegistryChildDirectory = (root, id, pattern) => {
  ensureRegistryId(id, pattern, `Invalid registry id: ${id}`);
  assertRegistryDirectory(root);
  const target = path.resolve(root, id);
  if (path.dirname(target) !== path.resolve(root)) {
    throw registryInvalidRequest(`Registry entry escapes its root: ${id}`);
  }
  assertRegistryDirectory(target);
  if (path.dirname(toRealPathSync(target)) !== toRealPathSync(root)) {
    throw registryInvalidRequest(`Registry entry escapes its canonical root: ${id}`);
  }
  return target;
};

export const assertRegistryEntryIds = (entries, idField, pattern, resolveDirectory) => {
  if (!isRegistryObject(entries)) throw registryInvalidRequest('Registry entries must be an object.');
  for (const [id, entry] of Object.entries(entries)) {
    ensureRegistryId(id, pattern, `Invalid registry id: ${id}`);
    if (!isRegistryObject(entry) || entry[idField] !== id) {
      throw registryInvalidRequest(`Registry key and ${idField} must match: ${id}`);
    }
    resolveDirectory(id);
  }
};

export const readRegistryJsonObject = (filePath, fallback = null) => {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!isRegistryObject(payload)) {
      throw new Error('payload must be an object');
    }
    return payload;
  } catch (err) {
    throw registryInvalidRequest(`Invalid JSON at ${filePath}: ${err?.message || err}`, { cause: err });
  }
};

export const writeRegistryStableJson = async (filePath, payload) => {
  await atomicWriteText(filePath, stableStringify(payload), { newline: true });
};

export const withRegistryLock = async ({
  repoCacheRoot,
  domain,
  options = {},
  createLockError = null,
  lockHeldMessage,
  worker
}) => {
  const lockInput = isRegistryObject(options?.lock) ? options.lock : null;
  if (lockInput) {
    await assertBorrowedRegistryLock(lockInput, repoCacheRoot, domain);
    return worker(lockInput);
  }
  const lock = await acquireRegistryLock({
    repoCacheRoot,
    domain,
    waitMs: Number.isFinite(options?.waitMs) ? Number(options.waitMs) : 0,
    pollMs: Number.isFinite(options?.pollMs) ? Number(options.pollMs) : 1000,
    staleMs: Number.isFinite(options?.staleMs) ? Number(options.staleMs) : undefined,
    metadata: options?.metadata && typeof options.metadata === 'object'
      ? options.metadata
      : null,
    log: typeof options?.log === 'function' ? options.log : () => {}
  });
  if (!lock) {
    if (typeof createLockError === 'function') {
      throw await createLockError({ repoCacheRoot, domain, options });
    }
    throw registryQueueError(lockHeldMessage);
  }
  const detachSignalCleanup = attachRegistryLockSignalCleanup(lock);
  try {
    return await worker(lock);
  } finally {
    detachSignalCleanup();
    await releaseFileLockOrThrow(lock);
  }
};
