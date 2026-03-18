import fs from 'node:fs';
import path from 'node:path';
import { isAbsolutePathNative } from '../../../src/shared/files.js';
import { findUpwards } from '../../../src/shared/fs/find-upwards.js';
import { joinPathSafe } from '../../../src/shared/path-normalize.js';
import { toRealPathSync } from '../../../src/workspace/identity.js';
import {
  findLatestBuildRootWithIndexes,
  hasModeIndexDir,
  resolveCurrentBuildRoots
} from '../../../src/shared/indexing/build-pointer.js';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { getCacheRoot, loadUserConfig } from '../config.js';

export function getRepoId(repoRoot) {
  const resolved = toRealPathSync(path.resolve(repoRoot));
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
  if (repoRoot) {
    return toRealPathSync(path.resolve(repoRoot));
  }
  return toRealPathSync(resolveRepoRoot(startPath));
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
  return findUpwards(
    startPath,
    (candidateDir) => fs.existsSync(path.join(candidateDir, '.pairofcleats.json'))
  );
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
  return path.join(cacheRoot, 'repos', repoId);
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
    const preferredMode = typeof options.mode === 'string' ? options.mode : null;
    const {
      buildId,
      buildRoot,
      activeRoot,
      buildRoots
    } = resolveCurrentBuildRoots(data, {
      repoCacheRoot,
      buildsRoot,
      preferredMode
    });
    const resolvedBuildId = buildId || (activeRoot ? path.basename(activeRoot) : null);
    if (!resolvedBuildId || !activeRoot || !fs.existsSync(activeRoot)) return null;
    return {
      buildId: resolvedBuildId,
      buildRoot: buildRoot || activeRoot,
      activeRoot,
      path: currentPath,
      data,
      buildRoots
    };
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
      const preferredMode = typeof options.mode === 'string' ? options.mode : null;
      const { buildRoot, activeRoot, buildRoots } = resolveCurrentBuildRoots(data, {
        repoCacheRoot,
        buildsRoot,
        preferredMode
      });
      const ensureExists = (value) => (value && fs.existsSync(value) ? value : null);
      let resolved = preferredMode ? ensureExists(buildRoots[preferredMode]) : null;
      if (!resolved) resolved = ensureExists(buildRoot);
      if (!resolved) resolved = ensureExists(activeRoot);
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
  if (isAbsolutePathNative(filePath)) return path.resolve(filePath);
  return joinPathSafe(repoRoot, [filePath]);
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
