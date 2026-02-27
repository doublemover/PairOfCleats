import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getEnvConfig } from './env.js';

export const CACHE_ROOT_DIRNAME = 'cache';
export const CACHE_ROOT_LAYOUT_VERSION = CACHE_ROOT_DIRNAME;
const LEGACY_CACHE_ROOT_DIRNAME = 'cache-v1';

const rebuiltRoots = new Set();
const isCacheRootDir = (targetRoot) => (
  typeof targetRoot === 'string'
  && targetRoot
  && path.basename(path.resolve(targetRoot)).toLowerCase() === CACHE_ROOT_DIRNAME
);
const isLegacyCacheRootDir = (targetRoot) => (
  typeof targetRoot === 'string'
  && targetRoot
  && path.basename(path.resolve(targetRoot)).toLowerCase() === LEGACY_CACHE_ROOT_DIRNAME
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

const isDirectory = (targetPath) => {
  if (!targetPath) return false;
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
};

const pathExists = (targetPath) => {
  if (!targetPath) return false;
  try {
    fs.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
};

const drainLegacyCacheRoot = (baseRoot) => {
  const resolvedBase = resolveCacheRoot(baseRoot);
  if (!resolvedBase) return;
  const targetRoot = resolveVersionedCacheRoot(resolvedBase);
  if (!targetRoot) return;
  const legacyRoot = path.join(path.dirname(targetRoot), LEGACY_CACHE_ROOT_DIRNAME);
  if (!isDirectory(legacyRoot)) return;
  try {
    fs.mkdirSync(targetRoot, { recursive: true });
  } catch {}
  let entries = [];
  try {
    entries = fs.readdirSync(legacyRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry?.name) continue;
    const source = path.join(legacyRoot, entry.name);
    const destination = path.join(targetRoot, entry.name);
    if (pathExists(destination)) continue;
    try {
      fs.renameSync(source, destination);
    } catch {}
  }
  try {
    if (fs.readdirSync(legacyRoot).length === 0) fs.rmdirSync(legacyRoot);
  } catch {}
};

/**
 * Normalize any legacy `cache-v1` path segments to the stable `cache` segment.
 *
 * This does not add/remove path depth; it only rewrites segment names.
 *
 * @param {string|null|undefined} targetPath
 * @returns {string}
 */
export function normalizeLegacyCacheRootPath(targetPath) {
  const resolved = resolveCacheRoot(targetPath);
  if (!resolved) return '';
  const parsed = path.parse(resolved);
  const tail = resolved.slice(parsed.root.length);
  const segments = tail.split(path.sep);
  const normalizedSegments = segments.map((segment) => (
    String(segment || '').toLowerCase() === LEGACY_CACHE_ROOT_DIRNAME
      ? CACHE_ROOT_DIRNAME
      : segment
  ));
  const normalizedTail = normalizedSegments.join(path.sep);
  return parsed.root
    ? path.join(parsed.root, normalizedTail)
    : path.join(...normalizedSegments);
}

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
  drainLegacyCacheRoot(getCacheRootBase());
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
  if (isCacheRootDir(resolvedBase)) return resolvedBase;
  if (isLegacyCacheRootDir(resolvedBase)) {
    return path.join(path.dirname(resolvedBase), CACHE_ROOT_DIRNAME);
  }
  return path.join(resolvedBase, CACHE_ROOT_DIRNAME);
}

export function clearCacheRoot({ baseRoot, includeLegacy = false } = {}) {
  const resolvedBase = resolveCacheRoot(baseRoot || getCacheRoot());
  if (!resolvedBase) return;
  const targetRoot = isCacheRootDir(resolvedBase)
    ? resolvedBase
    : resolveVersionedCacheRoot(resolvedBase);
  purgeCacheRoot(targetRoot);
  if (includeLegacy) {
    const legacyRoot = path.join(path.dirname(targetRoot), LEGACY_CACHE_ROOT_DIRNAME);
    purgeCacheRoot(legacyRoot);
  }
}
