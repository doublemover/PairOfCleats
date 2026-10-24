import os from 'node:os';
import path from 'node:path';
import { getEnvConfig } from './env.js';
import { readStorageLocator } from './storage/locator-read.js';

export const CACHE_ROOT_DIRNAME = 'cache';
export const CACHE_ROOT_LAYOUT_VERSION = CACHE_ROOT_DIRNAME;
const LEGACY_CACHE_ROOT_DIRNAME = 'cache-v1';

const isCacheRootDir = (targetRoot) => (
  typeof targetRoot === 'string'
  && targetRoot
  && path.basename(path.resolve(targetRoot)).toLowerCase() === CACHE_ROOT_DIRNAME
);

const resolveCacheRoot = (baseRoot) => {
  const resolvedBase = path.resolve(baseRoot || '');
  return resolvedBase || '';
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
export function getDefaultCacheRoot({ env = process.env } = {}) {
  if (env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'PairOfCleats');
  if (env.XDG_CACHE_HOME) return path.join(env.XDG_CACHE_HOME, 'pairofcleats');
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
export function getCacheRootBase({ env = process.env } = {}) {
  const envConfig = getEnvConfig(env);
  const envRoot = envConfig.cacheRoot || envConfig.homeRoot || '';
  if (envRoot) return envRoot;
  return getDefaultCacheRoot({ env });
}

/** App home is distinct from the cache-only compatibility alias. */
export function getApplicationHome({ env = process.env } = {}) {
  return path.resolve(getEnvConfig(env).homeRoot || getDefaultCacheRoot({ env }));
}

/** Read-only verified cutover selection. Explicit category overrides retain
 * precedence in their existing owners. Malformed selection is actionable and
 * cannot silently redirect consumers back to a different generation.
 */
export function getStorageCategorySelection(category, { env = process.env } = {}) {
  const locator = readStorageLocator(getApplicationHome({ env }));
  if (locator.status === 'invalid') throw Object.assign(new Error(`Storage locator is unreadable or incompatible: ${locator.target}`), {
    code: 'ERR_STORAGE_LOCATOR', cause: locator.error
  });
  return locator.value.categories[category]?.path || null;
}

/**
 * Resolve the cache root directory.
 * @returns {string}
 */
export function getCacheRoot({ env = process.env } = {}) {
  if (!getEnvConfig(env).cacheRoot) {
    const selected = getStorageCategorySelection('cache', { env });
    if (selected) return normalizeLegacyCacheRootPath(selected);
  }
  return resolveVersionedCacheRoot(getCacheRootBase({ env }));
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
  const base = getStorageCategorySelection('tmp') || path.join(getCacheRoot(), 'tmp');
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
  const targetRoot = isCacheRootDir(resolvedBase)
    ? resolvedBase
    : resolveVersionedCacheRoot(resolvedBase);
  // A cache parent also holds saved triage/snapshots/diffs and active builds.
  // Synchronous recursive removal cannot establish their owners or leases.
  throw Object.assign(new Error('Whole-root cache deletion requires category-owner cleanup planning. Use clear-cache --json to review proven disposable files, then --apply --plan <file> --plan-id <id>.'), {
    code: 'ERR_STORAGE_CLEANUP_PLAN_REQUIRED', cacheRoot: targetRoot,
    legacyRequested: includeLegacy, destructiveOperationPerformed: false
  });
}
