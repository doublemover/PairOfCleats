import fs from 'node:fs';
import path from 'node:path';
import { constants as bufferConstants } from 'node:buffer';
import { assertNoSymlinkPath, openContainedFileSync } from '../../shared/contained-file.js';
import { createContainedFileResource } from '../../shared/contained-file-resource.js';
import { atomicWriteJson, atomicWriteJsonSync } from '../../shared/io/atomic-write.js';
import { resolveSystemCacheAlias } from '../../shared/system-cache-alias.js';

export const __resolveSystemCacheAliasForTests = resolveSystemCacheAlias;

// Configuration selects storage authority before this layer. Do not reinterpret
// that selected path through repository-controlled links (including junctions).
export const assertToolingCachePath = (target) => {
  const resolved = resolveSystemCacheAlias(path.resolve(target));
  return assertNoSymlinkPath(path.parse(resolved).root, resolved, { allowMissing: true });
};

export const ensureToolingCacheDir = (dir) => {
  const resolved = assertToolingCachePath(dir);
  fs.mkdirSync(resolved, { recursive: true });
  assertToolingCachePath(resolved);
  return resolved;
};

/** Read a bounded regular, singly linked cache artifact through its checked handle. */
export const readToolingCacheEntry = (target, maxBytes = 8 * 1024 * 1024) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > bufferConstants.MAX_LENGTH) {
    throw new TypeError('Tooling cache reads require a bounded nonnegative byte allowance.');
  }
  const resolved = assertToolingCachePath(target);
  const methods = { receiver: fs, close: fs.closeSync, stat: fs.fstatSync, read: fs.readSync };
  const fd = openContainedFileSync(path.parse(resolved).root, resolved);
  const owner = createContainedFileResource({ fd, sync: true, methods });
  return owner.runSync(descriptor => {
    const stat = descriptor.stat();
    if (!stat.isFile() || stat.nlink !== 1 || !Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > maxBytes) {
      throw Object.assign(new Error('Unowned or oversized tooling cache artifact.'), { code: 'ERR_TOOLING_CACHE_ENTRY' });
    }
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = descriptor.read(bytes, offset, bytes.length - offset, offset);
      if (!Number.isInteger(read) || read < 0 || read > bytes.length - offset) throw new Error('Tooling cache read made invalid progress.');
      if (!read) break;
      offset += read;
    }
    const after = descriptor.stat();
    if (offset !== stat.size || ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs', 'nlink'].some(key => after[key] !== stat[key])) {
      throw new Error('Tooling cache artifact changed during read.');
    }
    return { payload: JSON.parse(bytes.toString('utf8')), stat };
  });
};

export const writeToolingCacheJson = async (target, payload, options = {}) => {
  const resolved = assertToolingCachePath(target);
  ensureToolingCacheDir(path.dirname(resolved));
  assertToolingCachePath(resolved);
  return atomicWriteJson(resolved, payload, { ...options, mkdir: false });
};

export const writeToolingCacheJsonSync = (target, payload, options = {}) => {
  const resolved = assertToolingCachePath(target);
  ensureToolingCacheDir(path.dirname(resolved));
  assertToolingCachePath(resolved);
  return atomicWriteJsonSync(resolved, payload, { ...options, mkdir: false });
};

/** Recheck ownership's descriptor identity and containment immediately before unlink. */
export const removeToolingCacheEntry = (target, expectedStat) => {
  const resolved = assertToolingCachePath(target);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.nlink !== 1
    || ['dev', 'ino', 'size', 'mtimeMs'].some((key) => stat[key] !== expectedStat[key])) return false;
  fs.unlinkSync(resolved);
  return true;
};
