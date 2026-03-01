import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { buildCacheKey } from '../../../shared/cache-key.js';
import { isAbsolutePathAny, toPosix } from '../../../shared/files.js';
import { isPathUnderDir } from '../../../shared/path-normalize.js';

const VFS_DISK_CACHE = new Map();
const VFS_DISK_CACHE_MAX_ENTRIES = 50_000;

const setVfsDiskCacheEntry = (key, value) => {
  if (!key) return;
  if (VFS_DISK_CACHE.has(key)) VFS_DISK_CACHE.delete(key);
  VFS_DISK_CACHE.set(key, value);
  while (VFS_DISK_CACHE.size > VFS_DISK_CACHE_MAX_ENTRIES) {
    const oldestKey = VFS_DISK_CACHE.keys().next().value;
    if (oldestKey == null) break;
    VFS_DISK_CACHE.delete(oldestKey);
  }
};

const buildVfsDiskCacheKey = ({ baseDir, virtualPath }) => buildCacheKey({
  repoHash: baseDir || '',
  buildConfigHash: null,
  mode: 'vfs',
  schemaVersion: 'vfs-disk-cache-v1',
  featureFlags: null,
  pathPolicy: 'posix',
  extra: { virtualPath: virtualPath || '' }
}).key;

/**
 * Resolve a safe disk path for a virtual path under a base directory.
 * @param {{baseDir:string,virtualPath:string}} input
 * @returns {string}
 */
export const resolveVfsDiskPath = ({ baseDir, virtualPath }) => {
  const baseRaw = String(baseDir || '').trim();
  if (!baseRaw) {
    throw new Error('VFS baseDir is required.');
  }
  const rootDir = path.resolve(baseRaw);
  const encodeUnsafeChar = (ch) => {
    const hex = ch.codePointAt(0).toString(16).toUpperCase().padStart(2, '0');
    return `%${hex}`;
  };
  const rawPath = toPosix(String(virtualPath || '').trim());
  if (!rawPath) {
    throw new Error('VFS virtualPath is required.');
  }
  if (isAbsolutePathAny(rawPath)) {
    throw new Error(`VFS virtualPath must be relative: ${virtualPath}`);
  }
  const parts = rawPath.split('/').filter((part) => part.length > 0);
  if (!parts.length) {
    throw new Error(`VFS virtualPath is invalid: ${virtualPath}`);
  }
  const safeParts = parts.map((part) => {
    if (part === '.' || part === '..') {
      throw new Error(`VFS virtualPath must not escape the baseDir: ${virtualPath}`);
    }
    return part.replace(/[:*?"<>|/\\]/g, (ch) => encodeUnsafeChar(ch));
  });
  const relative = safeParts.join(path.sep);
  const resolvedPath = path.resolve(rootDir, relative);
  if (!isPathUnderDir(rootDir, resolvedPath)) {
    throw new Error(`VFS virtualPath resolves outside baseDir: ${virtualPath}`);
  }
  return resolvedPath;
};

/**
 * Ensure a VFS-backed document exists on disk; avoid rewrites when the doc hash matches.
 * @param {{baseDir:string,virtualPath:string,text?:string,docHash?:string|null,coldStartCache?:{get?:Function,set?:Function}|null}} input
 * @returns {Promise<{path:string,cacheHit:boolean,source?:string}>}
 */
export const ensureVfsDiskDocument = async ({
  baseDir,
  virtualPath,
  text = '',
  docHash = null,
  coldStartCache = null
}) => {
  const resolvedDocHash = typeof docHash === 'string' && docHash.trim().length > 0
    ? docHash.trim()
    : null;
  const cacheKey = buildVfsDiskCacheKey({ baseDir, virtualPath });
  const cachedPath = resolvedDocHash && coldStartCache?.get
    ? coldStartCache.get({ virtualPath, docHash: resolvedDocHash })
    : null;
  if (cachedPath) {
    setVfsDiskCacheEntry(cacheKey, { path: cachedPath, docHash: resolvedDocHash });
    if (coldStartCache?.set) {
      const sizeBytes = Buffer.byteLength(text || '', 'utf8');
      coldStartCache.set({
        virtualPath,
        docHash: resolvedDocHash,
        diskPath: cachedPath,
        sizeBytes
      });
    }
    return { path: cachedPath, cacheHit: true, source: 'cold-start' };
  }

  const absPath = resolveVfsDiskPath({ baseDir, virtualPath });
  const cached = VFS_DISK_CACHE.get(cacheKey);
  if (resolvedDocHash && cached && cached.docHash === resolvedDocHash) {
    try {
      await fsPromises.access(absPath);
      if (coldStartCache?.set) {
        const sizeBytes = Buffer.byteLength(text || '', 'utf8');
        coldStartCache.set({
          virtualPath,
          docHash: resolvedDocHash,
          diskPath: absPath,
          sizeBytes
        });
      }
      return { path: absPath, cacheHit: true };
    } catch {}
  }

  await fsPromises.mkdir(path.dirname(absPath), { recursive: true });
  await fsPromises.writeFile(absPath, text || '', 'utf8');
  setVfsDiskCacheEntry(cacheKey, { path: absPath, docHash: resolvedDocHash });
  if (resolvedDocHash && coldStartCache?.set) {
    const sizeBytes = Buffer.byteLength(text || '', 'utf8');
    coldStartCache.set({
      virtualPath,
      docHash: resolvedDocHash,
      diskPath: absPath,
      sizeBytes
    });
  }
  return { path: absPath, cacheHit: false };
};
