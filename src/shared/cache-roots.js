import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getEnvConfig } from './env.js';

export const CACHE_ROOT_DIRNAME = 'cache';
export const CACHE_ROOT_LAYOUT_VERSION = CACHE_ROOT_DIRNAME;
const LEGACY_CACHE_ROOT_DIRNAME = 'cache-v1';

const rebuiltRoots = new Set();
const cacheRootWarnings = new Set();
const warnCacheRootIssue = (key, message) => {
  if (!key || !message) return;
  if (cacheRootWarnings.has(key)) return;
  cacheRootWarnings.add(key);
  console.warn(message);
};
const isCacheRootDir = (targetRoot) => (
  typeof targetRoot === 'string'
  && targetRoot
  && path.basename(path.resolve(targetRoot)).toLowerCase() === CACHE_ROOT_DIRNAME
);

const resolveCacheRoot = (baseRoot) => {
  const resolvedBase = path.resolve(baseRoot || '');
  return resolvedBase || '';
};

const purgeCacheRoot = (cacheRoot) => {
  if (!cacheRoot) return;
  try {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  } catch (err) {
    warnCacheRootIssue(
      `purge:${cacheRoot}:${err?.code || 'unknown'}`,
      `[cache] failed to purge cache root ${cacheRoot}: ${err?.message || err}`
    );
  }
};

const pathHasLegacyCacheRootSegment = (targetPath) => {
  if (!targetPath) return false;
  const parsed = path.parse(targetPath);
  const tail = String(targetPath).slice(parsed.root.length);
  const segments = tail.split(path.sep);
  return segments.some((segment) => String(segment || '').toLowerCase() === LEGACY_CACHE_ROOT_DIRNAME);
};

const assertNoLegacyCacheRootPath = (targetPath) => {
  if (!pathHasLegacyCacheRootSegment(targetPath)) return;
  const error = new Error(
    `[cache] legacy cache root segment "${LEGACY_CACHE_ROOT_DIRNAME}" is unsupported; use "${CACHE_ROOT_DIRNAME}".`
  );
  error.code = 'ERR_LEGACY_CACHE_ROOT_UNSUPPORTED';
  error.cacheRootPath = String(targetPath || '');
  throw error;
};

/**
 * Resolve and validate cache root paths.
 *
 * Hard cutover: legacy `cache-v1` segments are no longer supported.
 *
 * @param {string|null|undefined} targetPath
 * @returns {string}
 */
export function normalizeLegacyCacheRootPath(targetPath) {
  const resolved = resolveCacheRoot(targetPath);
  if (!resolved) return '';
  assertNoLegacyCacheRootPath(resolved);
  return resolved;
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

/**
 * Resolve a writable temporary-work root scoped under the stable cache root.
 *
 * This avoids platform-global temp folders for internal scratch data while
 * still keeping ephemeral artifacts isolated from durable index outputs.
 *
 * @param {...string} segments
 * @returns {string}
 */
export function getCacheTempRoot(...segments) {
  const base = path.join(getCacheRoot(), 'tmp');
  const suffix = segments
    .map((segment) => String(segment || '').trim())
    .filter(Boolean);
  return suffix.length ? path.join(base, ...suffix) : base;
}

export function resolveVersionedCacheRoot(baseRoot) {
  const resolvedBase = normalizeLegacyCacheRootPath(baseRoot);
  if (!resolvedBase) return '';
  if (isCacheRootDir(resolvedBase)) return resolvedBase;
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
