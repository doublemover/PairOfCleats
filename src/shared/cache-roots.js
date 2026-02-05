import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getEnvConfig } from './env.js';
import { CACHE_KEY_VERSION } from './cache-key.js';

const CACHE_VERSION_FILE = 'cache-version.json';
const purgedRoots = new Set();
const rebuiltRoots = new Set();

const resolveVersionedRoot = (baseRoot, version = CACHE_KEY_VERSION) => {
  const resolvedBase = path.resolve(baseRoot || '');
  if (!resolvedBase) return resolvedBase;
  if (path.basename(resolvedBase) === version) return resolvedBase;
  return path.join(resolvedBase, version);
};

const readCacheVersion = (root) => {
  const versionPath = path.join(root, CACHE_VERSION_FILE);
  if (!fs.existsSync(versionPath)) return null;
  try {
    const raw = fs.readFileSync(versionPath, 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed?.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
};

const writeCacheVersion = (root, version) => {
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, CACHE_VERSION_FILE),
      JSON.stringify({ version, updatedAt: new Date().toISOString() }, null, 2)
    );
  } catch {}
};

const purgeLegacyCacheRoot = (baseRoot, versionedRoot) => {
  if (!baseRoot || baseRoot === versionedRoot) return;
  const resolvedBase = path.resolve(baseRoot);
  const resolvedVersioned = path.resolve(versionedRoot);
  const key = `${resolvedBase}::${resolvedVersioned}`;
  if (purgedRoots.has(key)) return;
  purgedRoots.add(key);
  if (!fs.existsSync(resolvedBase)) return;
  const currentVersion = readCacheVersion(resolvedBase);
  if (currentVersion === CACHE_KEY_VERSION) return;
  try {
    const entries = fs.readdirSync(resolvedBase, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(resolvedBase, entry.name);
      if (fullPath === resolvedVersioned) continue;
      if (entry.name === CACHE_VERSION_FILE) {
        try { fs.rmSync(fullPath, { force: true }); } catch {}
        continue;
      }
      try {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } catch {}
    }
  } catch {}
  writeCacheVersion(resolvedBase, CACHE_KEY_VERSION);
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
  purgeLegacyCacheRoot(baseRoot, versionedRoot);
  if (envConfig.cacheRebuild) {
    const resolvedRoot = path.resolve(versionedRoot || '');
    if (!rebuiltRoots.has(resolvedRoot)) {
      rebuiltRoots.add(resolvedRoot);
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
