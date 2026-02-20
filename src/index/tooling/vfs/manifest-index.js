import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { VFS_MANIFEST_INDEX_CACHE_MAX } from './constants.js';

const VFS_MANIFEST_INDEX_CACHE = new Map();

/**
 * Load a VFS manifest index (.vfsidx) into a map.
 * @param {{indexPath:string}} input
 * @returns {Promise<Map<string,{virtualPath:string,offset:number,bytes:number}>>}
 */
export const loadVfsManifestIndex = async ({ indexPath }) => {
  const resolvedPath = path.resolve(String(indexPath || ''));
  const stat = await fsPromises.stat(resolvedPath);
  const cached = VFS_MANIFEST_INDEX_CACHE.get(resolvedPath) || null;
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    VFS_MANIFEST_INDEX_CACHE.delete(resolvedPath);
    VFS_MANIFEST_INDEX_CACHE.set(resolvedPath, cached);
    return cached.map;
  }
  const map = new Map();
  const stream = fs.createReadStream(resolvedPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of rl) {
      lineNumber += 1;
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry;
      try {
        entry = JSON.parse(trimmed);
      } catch (err) {
        const message = err?.message || 'JSON parse error';
        throw new Error(`Invalid vfs_manifest index JSON at ${resolvedPath}:${lineNumber}: ${message}`);
      }
      if (!entry?.virtualPath) continue;
      map.set(entry.virtualPath, entry);
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  VFS_MANIFEST_INDEX_CACHE.set(resolvedPath, {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    map
  });
  while (VFS_MANIFEST_INDEX_CACHE.size > VFS_MANIFEST_INDEX_CACHE_MAX) {
    const oldestKey = VFS_MANIFEST_INDEX_CACHE.keys().next().value;
    if (oldestKey === undefined) break;
    VFS_MANIFEST_INDEX_CACHE.delete(oldestKey);
  }
  return map;
};
