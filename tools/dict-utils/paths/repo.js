import fs from 'node:fs';
import path from 'node:path';
import { isAbsolutePath } from '../../../src/shared/files.js';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { getCacheRoot, loadUserConfig } from '../config.js';

export function getRepoId(repoRoot) {
  const resolved = path.resolve(repoRoot);
  const base = path.basename(resolved);
  const normalized = String(base || 'repo')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const prefix = (normalized || 'repo').slice(0, 24);
  const hash = crypto.createHash('sha1').update(resolved).digest('hex').slice(0, 12);
  return `${prefix}-${hash}`;
}

export const getLegacyRepoId = (repoRoot) => {
  const resolved = path.resolve(repoRoot);
  return crypto.createHash('sha1').update(resolved).digest('hex');
};

/**
 * Resolve the repo root from a starting directory.
 * @param {string} startPath
 * @returns {string}
 */
export function resolveRepoRoot(startPath = process.cwd()) {
  const base = path.resolve(startPath);
  const gitRoot = resolveGitRoot(base);
  if (gitRoot) return gitRoot;
  const configRoot = findConfigRoot(base);
  return configRoot || base;
}

export function getRepoRoot(repoRoot = null, startPath = process.cwd()) {
  if (repoRoot) return path.resolve(repoRoot);
  return resolveRepoRoot(startPath);
}

function resolveGitRoot(startPath) {
  try {
    const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: startPath,
      encoding: 'utf8'
    });
    if (result.status !== 0) return null;
    const root = String(result.stdout || '').trim();
    return root && fs.existsSync(root) ? root : null;
  } catch {
    return null;
  }
}

function findConfigRoot(startPath) {
  let current = path.resolve(startPath);
  while (true) {
    const configPath = path.join(current, '.pairofcleats.json');
    if (fs.existsSync(configPath)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Resolve the per-repo cache root.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {string}
 */
export function getRepoCacheRoot(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const cacheRoot = (cfg.cache && cfg.cache.root) || getCacheRoot();
  const repoId = getRepoId(repoRoot);
  const repoCacheRoot = path.join(cacheRoot, 'repos', repoId);
  const legacyRoot = path.join(cacheRoot, 'repos', getLegacyRepoId(repoRoot));
  if (fs.existsSync(legacyRoot) && !fs.existsSync(repoCacheRoot)) return legacyRoot;
  return repoCacheRoot;
}

/**
 * Resolve the builds root directory for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {string}
 */
export function getBuildsRoot(repoRoot, userConfig = null) {
  return path.join(getRepoCacheRoot(repoRoot, userConfig), 'builds');
}

/**
 * Resolve current build metadata for a repo, if present.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {{buildId:string,buildRoot:string,path:string,data:object}|null}
 */
export function getCurrentBuildInfo(repoRoot, userConfig = null, options = {}) {
  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  const currentPath = path.join(buildsRoot, 'current.json');
  if (!fs.existsSync(currentPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(currentPath, 'utf8')) || {};
    const buildId = typeof data.buildId === 'string' ? data.buildId : null;
    const buildRootRaw = typeof data.buildRoot === 'string' ? data.buildRoot : null;
    const repoCacheResolved = path.resolve(repoCacheRoot);
    const resolveRoot = (value) => {
      if (!value) return null;
      const resolved = isAbsolutePath(value) ? value : path.join(repoCacheRoot, value);
      const normalized = path.resolve(resolved);
      if (!normalized.startsWith(repoCacheResolved + path.sep) && normalized !== repoCacheResolved) return null;
      return normalized;
    };
    const buildRoot = buildRootRaw
      ? resolveRoot(buildRootRaw)
      : (buildId ? path.join(buildsRoot, buildId) : null);
    const buildRoots = {};
    if (data.buildRootsByMode && typeof data.buildRootsByMode === 'object' && !Array.isArray(data.buildRootsByMode)) {
      for (const [mode, value] of Object.entries(data.buildRootsByMode)) {
        if (typeof value !== 'string') continue;
        const resolved = resolveRoot(value);
        if (resolved) buildRoots[mode] = resolved;
      }
    } else if (data.buildRoots && typeof data.buildRoots === 'object' && !Array.isArray(data.buildRoots)) {
      for (const [mode, value] of Object.entries(data.buildRoots)) {
        if (typeof value !== 'string') continue;
        const resolved = resolveRoot(value);
        if (resolved) buildRoots[mode] = resolved;
      }
    } else if (buildRoot && Array.isArray(data.modes)) {
      for (const mode of data.modes) {
        if (typeof mode !== 'string') continue;
        buildRoots[mode] = buildRoot;
      }
    }
    const preferredMode = typeof options.mode === 'string' ? options.mode : null;
    const preferredRoot = preferredMode ? buildRoots[preferredMode] : null;
    const activeRoot = preferredRoot || buildRoot || Object.values(buildRoots)[0] || null;
    if (!buildId || !activeRoot || !fs.existsSync(activeRoot)) return null;
    return { buildId, buildRoot: buildRoot || activeRoot, activeRoot, path: currentPath, data, buildRoots };
  } catch {
    return null;
  }
}

/**
 * Resolve the active index root for a repo (current build or legacy path).
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @param {{indexRoot?:string|null}} [options]
 * @returns {string}
 */
export function resolveIndexRoot(repoRoot, userConfig = null, options = {}) {
  if (options?.indexRoot) return path.resolve(options.indexRoot);
  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  const currentPath = path.join(buildsRoot, 'current.json');
  if (fs.existsSync(currentPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(currentPath, 'utf8')) || {};
      const repoCacheResolved = path.resolve(repoCacheRoot);
      const resolveRoot = (value) => {
        if (!value) return null;
        const resolved = isAbsolutePath(value) ? value : path.join(repoCacheRoot, value);
        const normalized = path.resolve(resolved);
        if (!normalized.startsWith(repoCacheResolved + path.sep) && normalized !== repoCacheResolved) return null;
        return normalized;
      };
      const buildRootRaw = typeof data.buildRoot === 'string' ? data.buildRoot : null;
      const buildId = typeof data.buildId === 'string' ? data.buildId : null;
      const buildRoot = buildRootRaw
        ? resolveRoot(buildRootRaw)
        : (buildId ? path.join(buildsRoot, buildId) : null);
      const buildRoots = {};
      if (data.buildRootsByMode && typeof data.buildRootsByMode === 'object' && !Array.isArray(data.buildRootsByMode)) {
        for (const [mode, value] of Object.entries(data.buildRootsByMode)) {
          if (typeof value !== 'string') continue;
          buildRoots[mode] = resolveRoot(value);
        }
      } else if (data.buildRoots && typeof data.buildRoots === 'object' && !Array.isArray(data.buildRoots)) {
        for (const [mode, value] of Object.entries(data.buildRoots)) {
          if (typeof value !== 'string') continue;
          buildRoots[mode] = resolveRoot(value);
        }
      } else if (buildRoot && Array.isArray(data.modes)) {
        for (const mode of data.modes) {
          if (typeof mode !== 'string') continue;
          buildRoots[mode] = buildRoot;
        }
      }
      const preferredMode = typeof options.mode === 'string' ? options.mode : null;
      const ensureExists = (value) => (value && fs.existsSync(value) ? value : null);
      let resolved = preferredMode ? ensureExists(buildRoots[preferredMode]) : null;
      if (!resolved && !preferredMode) {
        for (const mode of ['code', 'prose', 'extracted-prose', 'records']) {
          resolved = ensureExists(buildRoots[mode]);
          if (resolved) break;
        }
      }
      if (!resolved) resolved = ensureExists(buildRoot);
      if (resolved) return resolved;
    } catch {}
  }
  return getRepoCacheRoot(repoRoot, userConfig);
}

/**
 * Resolve a path relative to the repo root.
 * @param {string} repoRoot
 * @param {string|null} filePath
 * @returns {string|null}
 */
export function resolvePath(repoRoot, filePath) {
  if (!filePath) return null;
  if (isAbsolutePath(filePath)) return filePath;
  return path.join(repoRoot, filePath);
}

/**
 * Resolve the index directory for a repo/mode.
 * @param {string} repoRoot
 * @param {'code'|'prose'|'records'} mode
 * @param {object|null} userConfig
 * @returns {string}
 */
export function getIndexDir(repoRoot, mode, userConfig = null, options = {}) {
  const base = resolveIndexRoot(repoRoot, userConfig, { ...options, mode });
  return path.join(base, `index-${mode}`);
}
