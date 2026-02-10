import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getEnvConfig } from './env.js';

const rebuiltRoots = new Set();
const resolveCacheRoot = (baseRoot) => {
  const resolvedBase = path.resolve(baseRoot || '');
  return resolvedBase || '';
};

const purgeCacheRoot = (cacheRoot) => {
  if (!cacheRoot) return;
  try {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  } catch {}
};

/**
 * Resolve the default cache root directory (ignores test overrides).
 * @returns {string}
 */
export function getDefaultCacheRoot() {
  if (process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, 'PairOfCleats');
  if (process.env.XDG_CACHE_HOME) return path.join(process.env.XDG_CACHE_HOME, 'pairofcleats');
  return path.join(os.homedir(), '.cache', 'pairofcleats');
}

/**
 * Resolve the base (unversioned) cache root directory.
 * @returns {string}
 */
export function getCacheRootBase() {
  const envConfig = getEnvConfig();
  const envRoot = envConfig.cacheRoot || envConfig.homeRoot || '';
  if (envRoot) return envRoot;
  return getDefaultCacheRoot();
}

/**
 * Resolve the cache root directory.
 * @returns {string}
 */
export function getCacheRoot() {
  const envConfig = getEnvConfig();
  const cacheRoot = resolveCacheRoot(getCacheRootBase());
  if (envConfig.cacheRebuild && cacheRoot) {
    const resolvedRoot = path.resolve(cacheRoot);
    if (!rebuiltRoots.has(resolvedRoot)) {
      rebuiltRoots.add(resolvedRoot);
      console.warn(`[cache] purge cache root: ${resolvedRoot}`);
      purgeCacheRoot(cacheRoot);
    }
  }
  return cacheRoot;
}

export function resolveVersionedCacheRoot(baseRoot) {
  return resolveCacheRoot(baseRoot);
}

export function clearCacheRoot({ baseRoot, includeLegacy = false } = {}) {
  const resolvedBase = baseRoot ? path.resolve(baseRoot) : getCacheRootBase();
  const targetRoot = resolveCacheRoot(resolvedBase);
  if (includeLegacy && resolvedBase && fs.existsSync(resolvedBase)) {
    purgeCacheRoot(resolvedBase);
    return;
  }
  purgeCacheRoot(targetRoot);
}
