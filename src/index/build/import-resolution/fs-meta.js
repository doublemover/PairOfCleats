import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { isAbsolutePathNative } from '../../../shared/files.js';
import { FS_META_PREFETCH_CONCURRENCY, FS_META_TRANSIENT_ERROR_CODES } from './constants.js';

const normalizeMetaPath = (targetPath) => path.resolve(String(targetPath || ''));

const isTransientFsMetaError = (error) => FS_META_TRANSIENT_ERROR_CODES.has(String(error?.code || ''));

const isMissingFsMetaError = (error) => {
  const code = String(error?.code || '');
  return code === 'ENOENT' || code === 'ENOTDIR';
};

export const createFsMemo = (preloaded = null) => {
  const existsCache = new Map();
  const statCache = new Map();
  const existsByPath = preloaded && typeof preloaded === 'object' && preloaded.existsByPath
    ? preloaded.existsByPath
    : null;
  const statByPath = preloaded && typeof preloaded === 'object' && preloaded.statByPath
    ? preloaded.statByPath
    : null;
  const transientByPath = preloaded && typeof preloaded === 'object' && preloaded.transientByPath
    ? preloaded.transientByPath
    : null;
  const hasOwn = Object.prototype.hasOwnProperty;
  const hasTransient = (key) => transientByPath && hasOwn.call(transientByPath, key) && transientByPath[key] === true;
  return {
    existsSync: (targetPath) => {
      const key = normalizeMetaPath(targetPath);
      if (existsCache.has(key)) return existsCache.get(key);
      if (hasTransient(key)) {
        let exists = false;
        try {
          exists = fs.existsSync(key);
        } catch {}
        existsCache.set(key, exists);
        return exists;
      }
      if (existsByPath && hasOwn.call(existsByPath, key)) {
        const exists = existsByPath[key] === true;
        existsCache.set(key, exists);
        return exists;
      }
      let exists = false;
      try {
        exists = fs.existsSync(key);
      } catch {}
      existsCache.set(key, exists);
      return exists;
    },
    statSync: (targetPath) => {
      const key = normalizeMetaPath(targetPath);
      if (statCache.has(key)) return statCache.get(key);
      if (hasTransient(key)) {
        let stat = null;
        try {
          stat = fs.statSync(key);
        } catch {}
        statCache.set(key, stat);
        return stat;
      }
      if (statByPath && hasOwn.call(statByPath, key)) {
        const stat = statByPath[key] || null;
        statCache.set(key, stat);
        return stat;
      }
      let stat = null;
      try {
        stat = fs.statSync(key);
      } catch {}
      statCache.set(key, stat);
      return stat;
    }
  };
};

export const prepareImportResolutionFsMeta = async ({
  root,
  entries,
  importsByFile
} = {}) => {
  if (!root) return null;
  const rootAbs = path.resolve(root);
  const candidatePaths = new Set([path.join(rootAbs, 'package.json'), path.join(rootAbs, 'tsconfig.json')]);

  const addDirAncestors = (startDir) => {
    let dir = path.resolve(startDir);
    for (;;) {
      const rel = path.relative(rootAbs, dir);
      if (rel && (rel.startsWith('..') || isAbsolutePathNative(rel))) break;
      candidatePaths.add(path.join(dir, 'tsconfig.json'));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  };

  if (importsByFile && typeof importsByFile === 'object') {
    const importerFiles = importsByFile instanceof Map
      ? Array.from(importsByFile.keys())
      : Object.keys(importsByFile);
    for (const importer of importerFiles) {
      if (typeof importer !== 'string' || !importer) continue;
      addDirAncestors(path.dirname(path.resolve(rootAbs, importer)));
    }
  } else if (Array.isArray(entries)) {
    for (const entry of entries) {
      const abs = typeof entry === 'string' ? entry : entry?.abs;
      if (!abs) continue;
      addDirAncestors(path.dirname(path.resolve(abs)));
    }
  }

  const existsByPath = Object.create(null);
  const statByPath = Object.create(null);
  const transientByPath = Object.create(null);
  const candidates = Array.from(candidatePaths, (candidate) => normalizeMetaPath(candidate));
  const workerCount = Math.max(1, Math.min(FS_META_PREFETCH_CONCURRENCY, candidates.length));
  let cursor = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= candidates.length) break;
      const key = candidates[index];
      try {
        const stat = await fsPromises.stat(key);
        existsByPath[key] = true;
        statByPath[key] = {
          mtimeMs: Number.isFinite(stat?.mtimeMs) ? stat.mtimeMs : null,
          size: Number.isFinite(stat?.size) ? stat.size : null,
          isFile: typeof stat?.isFile === 'function' ? stat.isFile() : true
        };
      } catch (error) {
        if (isTransientFsMetaError(error)) {
          transientByPath[key] = true;
          continue;
        }
        if (isMissingFsMetaError(error)) {
          existsByPath[key] = false;
          statByPath[key] = null;
          continue;
        }
        existsByPath[key] = false;
        statByPath[key] = null;
      }
    }
  });
  await Promise.all(workers);

  return {
    existsByPath,
    statByPath,
    transientByPath,
    candidateCount: candidatePaths.size
  };
};
