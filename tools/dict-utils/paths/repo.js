import fs from 'node:fs';
import path from 'node:path';
import { isAbsolutePathNative } from '../../../src/shared/files.js';
import { findUpwards } from '../../../src/shared/fs/find-upwards.js';
import { joinPathSafe } from '../../../src/shared/path-normalize.js';
import { isWithinRoot, normalizeIdentityPath, toRealPathSync } from '../../../src/workspace/identity.js';
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

const sameIdentityPath = (left, right) => normalizeIdentityPath(left) === normalizeIdentityPath(right);

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

const DEFAULT_BUILD_MODES = ['code', 'prose', 'extracted-prose', 'records'];
const MODE_ARTIFACT_MARKERS = [
  path.join('pieces', 'manifest.json'),
  'chunk_meta.json',
  'chunk_meta.json.gz',
  'chunk_meta.json.zst',
  'chunk_meta.jsonl',
  'chunk_meta.jsonl.gz',
  'chunk_meta.jsonl.zst',
  'chunk_meta.meta.json',
  'chunk_meta.parts',
  'chunk_meta.columnar.json',
  'chunk_meta.binary-columnar.meta.json'
];

const hasModeArtifacts = (rootPath, mode) => {
  const indexDir = path.join(rootPath, `index-${mode}`);
  if (!fs.existsSync(indexDir)) return false;
  for (const marker of MODE_ARTIFACT_MARKERS) {
    if (fs.existsSync(path.join(indexDir, marker))) {
      return true;
    }
  }
  return false;
};

const hasModeIndexDir = (rootPath, mode = null) => {
  if (!rootPath || !fs.existsSync(rootPath)) return false;
  if (typeof mode === 'string' && mode.trim()) {
    return hasModeArtifacts(rootPath, mode.trim());
  }
  for (const candidateMode of DEFAULT_BUILD_MODES) {
    if (hasModeArtifacts(rootPath, candidateMode)) {
      return true;
    }
  }
  return false;
};

const findLatestBuildRootWithIndexes = (buildsRoot, mode = null) => {
  if (!buildsRoot || !fs.existsSync(buildsRoot)) return null;
  let entries = [];
  try {
    entries = fs.readdirSync(buildsRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry?.isDirectory?.()) continue;
    const candidateRoot = path.join(buildsRoot, entry.name);
    if (!hasModeIndexDir(candidateRoot, mode)) continue;
    let mtimeMs = 0;
    try {
      mtimeMs = Number(fs.statSync(candidateRoot).mtimeMs) || 0;
    } catch {}
    candidates.push({ root: candidateRoot, mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.root || null;
};

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
    const repoCacheResolved = toRealPathSync(repoCacheRoot);
    const resolveRoot = (value) => {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      if (!trimmed) return null;
      const candidates = isAbsolutePathNative(trimmed)
        ? [trimmed]
        : [
          path.join(repoCacheRoot, trimmed),
          path.join(buildsRoot, trimmed)
        ];
      for (const candidate of candidates) {
        const normalized = toRealPathSync(candidate);
        if (isWithinRoot(normalized, repoCacheResolved)) {
          return normalized;
        }
      }
      return null;
    };
    let buildRoot = buildRootRaw
      ? resolveRoot(buildRootRaw)
      : (buildId ? path.join(buildsRoot, buildId) : null);
    if (!buildRoot && buildId) {
      const fromBuildId = resolveRoot(buildId);
      if (fromBuildId) buildRoot = fromBuildId;
    }
    if (
      buildId
      && buildRoot
      && sameIdentityPath(path.resolve(buildRoot), repoCacheResolved)
    ) {
      const buildIdRoot = path.join(buildsRoot, buildId);
      if (fs.existsSync(buildIdRoot)) {
        buildRoot = buildIdRoot;
      }
    }
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
    const firstExistingModeRoot = Object.values(buildRoots).find((candidate) => (
      typeof candidate === 'string' && fs.existsSync(candidate)
    )) || null;
    let activeRoot = preferredRoot || buildRoot || firstExistingModeRoot || Object.values(buildRoots)[0] || null;
    if ((!activeRoot || !fs.existsSync(activeRoot)) && buildId) {
      const buildIdRoot = path.join(buildsRoot, buildId);
      if (fs.existsSync(buildIdRoot)) {
        activeRoot = buildIdRoot;
      }
    }
    if (activeRoot && !hasModeIndexDir(activeRoot, preferredMode)) {
      const buildIdRoot = buildId ? path.join(buildsRoot, buildId) : null;
      if (buildIdRoot && hasModeIndexDir(buildIdRoot, preferredMode)) {
        activeRoot = buildIdRoot;
      } else {
        const fallbackRoot = findLatestBuildRootWithIndexes(buildsRoot, preferredMode);
        if (fallbackRoot) activeRoot = fallbackRoot;
      }
    }
    if (buildRoot && !hasModeIndexDir(buildRoot, preferredMode) && hasModeIndexDir(activeRoot, preferredMode)) {
      buildRoot = activeRoot;
    }
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
      const repoCacheResolved = toRealPathSync(repoCacheRoot);
      const resolveRoot = (value) => {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        if (!trimmed) return null;
        const candidates = isAbsolutePathNative(trimmed)
          ? [trimmed]
          : [
            path.join(repoCacheRoot, trimmed),
            path.join(buildsRoot, trimmed)
          ];
        for (const candidate of candidates) {
          const normalized = toRealPathSync(candidate);
          if (isWithinRoot(normalized, repoCacheResolved)) {
            return normalized;
          }
        }
        return null;
      };
      const buildRootRaw = typeof data.buildRoot === 'string' ? data.buildRoot : null;
      const buildId = typeof data.buildId === 'string' ? data.buildId : null;
      let buildRoot = buildRootRaw
        ? resolveRoot(buildRootRaw)
        : (buildId ? path.join(buildsRoot, buildId) : null);
      if (!buildRoot && buildId) {
        const fromBuildId = resolveRoot(buildId);
        if (fromBuildId) buildRoot = fromBuildId;
      }
      if (
        buildId
        && buildRoot
        && sameIdentityPath(path.resolve(buildRoot), repoCacheResolved)
      ) {
        const buildIdRoot = path.join(buildsRoot, buildId);
        if (fs.existsSync(buildIdRoot)) {
          buildRoot = buildIdRoot;
        }
      }
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
      if (resolved && !hasModeIndexDir(resolved, preferredMode)) {
        const buildIdRoot = buildId ? path.join(buildsRoot, buildId) : null;
        if (buildIdRoot && hasModeIndexDir(buildIdRoot, preferredMode)) {
          resolved = buildIdRoot;
        } else {
          const fallbackRoot = findLatestBuildRootWithIndexes(buildsRoot, preferredMode);
          if (fallbackRoot) resolved = fallbackRoot;
        }
      }
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
