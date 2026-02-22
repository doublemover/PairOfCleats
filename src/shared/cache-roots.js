import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getEnvConfig } from './env.js';

export const CACHE_ROOT_LAYOUT_VERSION = 'cache-v1';

const rebuiltRoots = new Set();
const isVersionedCacheRoot = (targetRoot) => (
  typeof targetRoot === 'string'
  && targetRoot
  && path.basename(path.resolve(targetRoot)).toLowerCase() === CACHE_ROOT_LAYOUT_VERSION
);

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
 * Resolve a coarse filesystem profile for cache and artifact tuning.
 *
 * The profile is intentionally conservative; unknown platforms fall back to
 * `generic` handling in higher layers.
 *
 * @param {string|null|undefined} [baseRoot]
 * @param {string} [platform]
 * @returns {'ntfs'|'posix'|'unknown'}
 */
export function resolveCacheFilesystemProfile(baseRoot = null, platform = process.platform) {
  const normalizedPlatform = typeof platform === 'string' ? platform.toLowerCase() : '';
  if (normalizedPlatform === 'win32') return 'ntfs';
  if (normalizedPlatform === 'linux' || normalizedPlatform === 'darwin' || normalizedPlatform === 'freebsd') {
    return 'posix';
  }
  const rootText = String(baseRoot || '');
  if (/^[a-zA-Z]:[\\/]/.test(rootText)) return 'ntfs';
  if (rootText.startsWith('/')) return 'posix';
  return 'unknown';
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
  const cacheRoot = resolveVersionedCacheRoot(getCacheRootBase());
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
  const resolvedBase = resolveCacheRoot(baseRoot);
  if (!resolvedBase) return '';
  if (isVersionedCacheRoot(resolvedBase)) return resolvedBase;
  return path.join(resolvedBase, CACHE_ROOT_LAYOUT_VERSION);
}

export function clearCacheRoot({ baseRoot, includeLegacy = false } = {}) {
  const resolvedBase = baseRoot ? path.resolve(baseRoot) : getCacheRootBase();
  const targetRoot = resolveVersionedCacheRoot(resolvedBase);
  if (includeLegacy && resolvedBase && fs.existsSync(resolvedBase)) {
    purgeCacheRoot(resolvedBase);
    return;
  }
  if (isVersionedCacheRoot(resolvedBase)) {
    purgeCacheRoot(resolvedBase);
    return;
  }
  purgeCacheRoot(targetRoot);
}
