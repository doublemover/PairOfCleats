import fs from 'node:fs';
import path from 'node:path';
import { assertNoSymlinkPath, openContainedFileSync } from '../../shared/contained-file.js';
import { atomicWriteJson, atomicWriteJsonSync } from '../../shared/io/atomic-write.js';

const resolveSystemCacheAlias = (resolved, {
  platform = process.platform,
  lstat = fs.lstatSync,
  realpath = fs.realpathSync
} = {}) => {
  if (platform !== 'darwin') return resolved;
  // These root-owned macOS aliases are launch-platform infrastructure, not
  // permission to canonicalize a repository-controlled cache root/descendant.
  for (const [alias, canonical] of [['/var', '/private/var'], ['/tmp', '/private/tmp']]) {
    if (resolved !== alias && !resolved.startsWith(`${alias}/`)) continue;
    try {
      const stat = lstat(alias);
      if (stat.uid === 0 && stat.isSymbolicLink() && realpath(alias) === canonical) {
        return `${canonical}${resolved.slice(alias.length)}`;
      }
    } catch {}
  }
  return resolved;
};

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
  const resolved = assertToolingCachePath(target);
  const fd = openContainedFileSync(path.parse(resolved).root, resolved);
  try {
    const stat = fs.fstatSync(fd);
    if (stat.nlink !== 1 || stat.size > maxBytes) {
      throw Object.assign(new Error('Unowned or oversized tooling cache artifact.'), { code: 'ERR_TOOLING_CACHE_ENTRY' });
    }
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!read) break;
      offset += read;
    }
    const after = fs.fstatSync(fd);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) {
      throw new Error('Tooling cache artifact changed during read.');
    }
    return { payload: JSON.parse(bytes.subarray(0, offset).toString('utf8')), stat };
  } finally {
    fs.closeSync(fd);
  }
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
