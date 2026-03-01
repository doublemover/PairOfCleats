import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { isAbsolutePathNative, isRelativePathEscape } from '../../../shared/files.js';
import { FS_META_PREFETCH_CONCURRENCY, FS_META_TRANSIENT_ERROR_CODES } from './constants.js';

const normalizeMetaPath = (targetPath) => path.resolve(String(targetPath || ''));

const isTransientFsMetaError = (error) => FS_META_TRANSIENT_ERROR_CODES.has(String(error?.code || ''));

const isMissingFsMetaError = (error) => {
  const code = String(error?.code || '');
  return code === 'ENOENT' || code === 'ENOTDIR';
};

const buildStatShape = (stat) => ({
  mtimeMs: Number.isFinite(stat?.mtimeMs) ? stat.mtimeMs : null,
  size: Number.isFinite(stat?.size) ? stat.size : null,
  isFile: typeof stat?.isFile === 'function'
    ? stat.isFile()
    : (typeof stat?.isFile === 'boolean' ? stat.isFile : true)
});

const classifyProbeError = (error) => {
  if (isMissingFsMetaError(error)) {
    return {
      state: 'missing',
      stat: null,
      exists: false,
      errorCode: String(error?.code || '') || null
    };
  }
  if (isTransientFsMetaError(error)) {
    return {
      state: 'transient_error',
      stat: null,
      exists: null,
      errorCode: String(error?.code || '') || null
    };
  }
  return {
    state: 'error',
    stat: null,
    exists: null,
    errorCode: String(error?.code || '') || null
  };
};

export const createFsMemo = (preloaded = null) => {
  const probeCache = new Map();
  const existsByPath = preloaded && typeof preloaded === 'object' && preloaded.existsByPath
    ? preloaded.existsByPath
    : null;
  const statByPath = preloaded && typeof preloaded === 'object' && preloaded.statByPath
    ? preloaded.statByPath
    : null;
  const transientByPath = preloaded && typeof preloaded === 'object' && preloaded.transientByPath
    ? preloaded.transientByPath
    : null;
  const errorByPath = preloaded && typeof preloaded === 'object' && preloaded.errorByPath
    ? preloaded.errorByPath
    : null;
  const hasOwn = Object.prototype.hasOwnProperty;
  const hasTransient = (key) => transientByPath && hasOwn.call(transientByPath, key) && transientByPath[key] === true;
  const hasError = (key) => errorByPath && hasOwn.call(errorByPath, key) && errorByPath[key];
  const toErrorCode = (value) => {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object' && typeof value.code === 'string' && value.code.trim()) {
      return value.code.trim();
    }
    return null;
  };
  const liveProbe = (key) => {
    try {
      const stat = fs.statSync(key);
      return {
        state: 'present',
        stat: buildStatShape(stat),
        exists: true,
        errorCode: null
      };
    } catch (error) {
      return classifyProbeError(error);
    }
  };
  const preloadedProbe = (key) => {
    if (hasTransient(key)) return liveProbe(key);
    if (hasError(key)) {
      return {
        state: 'error',
        stat: null,
        exists: null,
        errorCode: toErrorCode(errorByPath[key])
      };
    }
    if (statByPath && hasOwn.call(statByPath, key)) {
      const preloadedStat = statByPath[key];
      if (preloadedStat) {
        return {
          state: 'present',
          stat: buildStatShape(preloadedStat),
          exists: true,
          errorCode: null
        };
      }
      if (existsByPath && hasOwn.call(existsByPath, key) && existsByPath[key] === false) {
        return {
          state: 'missing',
          stat: null,
          exists: false,
          errorCode: null
        };
      }
    }
    if (existsByPath && hasOwn.call(existsByPath, key)) {
      const exists = existsByPath[key] === true;
      return {
        state: exists ? 'present' : 'missing',
        stat: null,
        exists,
        errorCode: null
      };
    }
    return liveProbe(key);
  };
  const probeSync = (targetPath) => {
    const key = normalizeMetaPath(targetPath);
    if (probeCache.has(key)) return probeCache.get(key);
    const probe = preloaded ? preloadedProbe(key) : liveProbe(key);
    probeCache.set(key, probe);
    return probe;
  };
  return {
    existsSync: (targetPath) => {
      const probe = probeSync(targetPath);
      return probe.state === 'present' || probe.exists === true;
    },
    statSync: (targetPath) => {
      const probe = probeSync(targetPath);
      return probe.stat || null;
    },
    statProbeSync: probeSync
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
      if (rel && (isRelativePathEscape(rel) || isAbsolutePathNative(rel))) break;
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
  const errorByPath = Object.create(null);
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
        statByPath[key] = buildStatShape(stat);
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
        errorByPath[key] = String(error?.code || '') || 'UNKNOWN';
      }
    }
  });
  await Promise.all(workers);

  return {
    existsByPath,
    statByPath,
    transientByPath,
    errorByPath,
    candidateCount: candidatePaths.size
  };
};
