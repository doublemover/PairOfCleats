import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getCacheRoot } from '../../../shared/cache-roots.js';
import { isTestingEnv } from '../../../shared/env.js';
import { readJsonFile } from '../../../shared/artifact-io.js';
import { writeJsonLinesFile, writeJsonObjectFile } from '../../../shared/json-stream.js';
import { readJsonlRows } from '../../../shared/merge.js';
import {
  VFS_COLD_START_DATA,
  VFS_COLD_START_DIR,
  VFS_COLD_START_MAX_AGE_DAYS,
  VFS_COLD_START_MAX_BYTES,
  VFS_COLD_START_META,
  VFS_COLD_START_SCHEMA_VERSION
} from './constants.js';

const resolveColdStartConfig = (value) => {
  if (value === false || value?.enabled === false) {
    return { enabled: false };
  }
  const enabled = typeof value?.enabled === 'boolean' ? value.enabled : true;
  if (!enabled) return { enabled: false };
  if (isTestingEnv() && value?.enabled !== true) {
    return { enabled: false };
  }
  if (value?.maxBytes != null && (typeof value.maxBytes !== 'number' || !Number.isFinite(value.maxBytes))) {
    throw new Error('vfs cold-start maxBytes must be a finite number.');
  }
  if (value?.maxAgeDays != null && (typeof value.maxAgeDays !== 'number' || !Number.isFinite(value.maxAgeDays))) {
    throw new Error('vfs cold-start maxAgeDays must be a finite number.');
  }
  const maxBytes = Number.isFinite(value?.maxBytes)
    ? Math.max(0, Math.floor(value.maxBytes))
    : VFS_COLD_START_MAX_BYTES;
  const maxAgeDays = Number.isFinite(value?.maxAgeDays)
    ? Math.max(0, value.maxAgeDays)
    : VFS_COLD_START_MAX_AGE_DAYS;
  const cacheRoot = typeof value?.cacheRoot === 'string' && value.cacheRoot.trim()
    ? path.resolve(value.cacheRoot)
    : getCacheRoot();
  return {
    enabled: true,
    maxBytes,
    maxAgeDays,
    cacheRoot
  };
};

const resolveVfsColdStartPaths = (cacheRoot) => {
  const baseDir = path.join(cacheRoot, VFS_COLD_START_DIR);
  return {
    baseDir,
    metaPath: path.join(baseDir, VFS_COLD_START_META),
    dataPath: path.join(baseDir, VFS_COLD_START_DATA)
  };
};

const normalizeColdStartEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const virtualPath = typeof entry.virtualPath === 'string' ? entry.virtualPath.trim() : '';
  const docHash = typeof entry.docHash === 'string' ? entry.docHash.trim() : '';
  const diskPath = typeof entry.diskPath === 'string' ? entry.diskPath.trim() : '';
  if (!virtualPath || !docHash || !diskPath) return null;
  const sizeBytes = Number.isFinite(Number(entry.sizeBytes))
    ? Math.max(0, Math.floor(Number(entry.sizeBytes)))
    : 0;
  const updatedAt = typeof entry.updatedAt === 'string' && entry.updatedAt.trim()
    ? entry.updatedAt
    : new Date().toISOString();
  return {
    schemaVersion: VFS_COLD_START_SCHEMA_VERSION,
    virtualPath,
    docHash,
    diskPath,
    sizeBytes,
    updatedAt
  };
};

const compactColdStartEntries = (entries, { maxBytes, maxAgeMs }) => {
  const cutoff = Number.isFinite(maxAgeMs) && maxAgeMs > 0 ? Date.now() - maxAgeMs : null;
  const filtered = entries.filter((entry) => {
    if (!entry) return false;
    if (cutoff == null) return true;
    const ts = Date.parse(entry.updatedAt || '');
    if (!Number.isFinite(ts)) return true;
    return ts >= cutoff;
  });
  filtered.sort((a, b) => {
    const aTime = Date.parse(a.updatedAt || '') || 0;
    const bTime = Date.parse(b.updatedAt || '') || 0;
    return bTime - aTime;
  });
  const kept = [];
  let totalBytes = 0;
  for (const entry of filtered) {
    const nextBytes = entry.sizeBytes || 0;
    if (Number.isFinite(maxBytes) && maxBytes > 0 && (totalBytes + nextBytes) > maxBytes) {
      continue;
    }
    totalBytes += nextBytes;
    kept.push(entry);
  }
  return { entries: kept, totalBytes };
};

/**
 * Create (or load) a VFS cold-start cache for disk-backed virtual documents.
 * @param {{cacheRoot?:string|null,indexSignature?:string|null,manifestHash?:string|null,config?:object|null}} input
 * @returns {Promise<{get:(input:{virtualPath:string,docHash:string})=>string|null,set:(input:{virtualPath:string,docHash:string,diskPath:string,sizeBytes:number})=>void,flush:()=>Promise<void>,size:()=>number}|null>}
 */
export const createVfsColdStartCache = async ({
  cacheRoot = null,
  indexSignature = null,
  manifestHash = null,
  config = null
} = {}) => {
  const resolved = resolveColdStartConfig(config);
  if (!resolved.enabled) return null;
  const resolvedCacheRoot = cacheRoot ? path.resolve(cacheRoot) : resolved.cacheRoot;
  if (!resolvedCacheRoot || !indexSignature || !manifestHash) return null;

  const { baseDir, metaPath, dataPath } = resolveVfsColdStartPaths(resolvedCacheRoot);
  let entries = [];
  if (fs.existsSync(metaPath) && fs.existsSync(dataPath)) {
    try {
      const meta = readJsonFile(metaPath);
      if (meta?.indexSignature === indexSignature && meta?.manifestHash === manifestHash) {
        for await (const row of readJsonlRows(dataPath)) {
          const normalized = normalizeColdStartEntry(row);
          if (normalized) entries.push(normalized);
        }
      }
    } catch {
      entries = [];
    }
  }

  const maxAgeMs = resolved.maxAgeDays > 0 ? resolved.maxAgeDays * 86400000 : null;
  const compacted = compactColdStartEntries(entries, {
    maxBytes: resolved.maxBytes,
    maxAgeMs
  });
  const map = new Map(compacted.entries.map((entry) => [entry.virtualPath, entry]));
  let dirty = false;

  const get = ({ virtualPath, docHash }) => {
    if (!virtualPath || !docHash) return null;
    const entry = map.get(virtualPath);
    if (!entry || entry.docHash !== docHash) return null;
    if (!path.isAbsolute(entry.diskPath)) return null;
    if (!fs.existsSync(entry.diskPath)) return null;
    return entry.diskPath;
  };

  const set = ({ virtualPath, docHash, diskPath, sizeBytes }) => {
    if (!virtualPath || !docHash || !diskPath) return;
    if (!path.isAbsolute(diskPath)) return;
    const normalized = normalizeColdStartEntry({
      virtualPath,
      docHash,
      diskPath,
      sizeBytes,
      updatedAt: new Date().toISOString()
    });
    if (!normalized) return;
    map.set(virtualPath, normalized);
    dirty = true;
  };

  const flush = async () => {
    if (!dirty) return;
    const payload = compactColdStartEntries(Array.from(map.values()), {
      maxBytes: resolved.maxBytes,
      maxAgeMs
    });
    await fsPromises.mkdir(baseDir, { recursive: true });
    await writeJsonLinesFile(dataPath, payload.entries, { atomic: true, compression: null });
    await writeJsonObjectFile(metaPath, {
      fields: {
        schemaVersion: VFS_COLD_START_SCHEMA_VERSION,
        indexSignature,
        manifestHash,
        createdAt: new Date().toISOString(),
        entries: payload.entries.length,
        bytes: payload.totalBytes
      },
      atomic: true
    });
    dirty = false;
  };

  return {
    get,
    set,
    flush,
    size: () => map.size
  };
};
