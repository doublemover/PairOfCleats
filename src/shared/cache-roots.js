import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getEnvConfig } from './env.js';
import { CACHE_KEY_VERSION } from './cache-key.js';

const rebuiltRoots = new Set();

const resolveVersionedRoot = (baseRoot, version = CACHE_KEY_VERSION) => {
  const resolvedBase = path.resolve(baseRoot || '');
  if (!resolvedBase) return resolvedBase;
  if (path.basename(resolvedBase) === version) return resolvedBase;
  return path.join(resolvedBase, version);
};

const purgeVersionedCacheRoot = (versionedRoot) => {
  if (!versionedRoot) return;
  try {
    fs.rmSync(versionedRoot, { recursive: true, force: true });
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
 * Resolve the versioned cache root directory.
 * @returns {string}
 */
export function getCacheRoot() {
  const envConfig = getEnvConfig();
  const baseRoot = getCacheRootBase();
  const versionedRoot = resolveVersionedRoot(baseRoot, CACHE_KEY_VERSION);
  if (envConfig.cacheRebuild && versionedRoot) {
    const resolvedRoot = path.resolve(versionedRoot);
    if (!rebuiltRoots.has(resolvedRoot)) {
      rebuiltRoots.add(resolvedRoot);
      console.warn(`[cache] purge versioned cache root: ${resolvedRoot}`);
      purgeVersionedCacheRoot(versionedRoot);
    }
  }
  return versionedRoot;
}

export function resolveVersionedCacheRoot(baseRoot, version = CACHE_KEY_VERSION) {
  return resolveVersionedRoot(baseRoot, version);
}

export function clearCacheRoot({ baseRoot, version = CACHE_KEY_VERSION, includeLegacy = false } = {}) {
  const resolvedBase = baseRoot ? path.resolve(baseRoot) : getCacheRootBase();
  const versionedRoot = resolveVersionedRoot(resolvedBase, version);
  if (includeLegacy && resolvedBase && fs.existsSync(resolvedBase)) {
    try {
      const entries = fs.readdirSync(resolvedBase, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(resolvedBase, entry.name);
        if (fullPath === versionedRoot) continue;
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } catch {}
      }
    } catch {}
  }
  purgeVersionedCacheRoot(versionedRoot);
}
