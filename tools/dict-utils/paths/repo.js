import fs from 'node:fs';
import path from 'node:path';
import { isAbsolutePathNative } from '../../../src/shared/files.js';
import { findUpwards } from '../../../src/shared/fs/find-upwards.js';
import { joinPathSafe } from '../../../src/shared/path-normalize.js';
import { normalizeIdentityPath, toRealPathSync } from '../../../src/workspace/identity.js';
import {
  findLatestBuildRootWithIndexes,
  hasModeIndexDir,
  resolveCurrentBuildRoots
} from '../../../src/shared/indexing/build-pointer.js';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { getCacheRoot, loadUserConfig } from '../config.js';

export const BUILD_ROOT_RESOLUTION_FAILURES = Object.freeze({
  missingCurrentBuild: 'missing_current_build',
  missingModeArtifacts: 'missing_mode_artifacts',
  disallowedRepoRootFallback: 'disallowed_repo_root_fallback'
});

const sameIdentityPath = (left, right) => normalizeIdentityPath(left) === normalizeIdentityPath(right);

const coerceExistingPath = (value) => (value && fs.existsSync(value) ? value : null);

const isDisallowedBuildRootCandidate = (candidate, repoCacheRoot, buildsRoot) => {
  if (!candidate) return false;
  const canonicalCandidate = toRealPathSync(candidate);
  return sameIdentityPath(canonicalCandidate, repoCacheRoot)
    || sameIdentityPath(canonicalCandidate, buildsRoot);
};

export function resolveCurrentBuildModeRoot(repoRoot, userConfig = null, options = {}) {
  const mode = typeof options.mode === 'string' && options.mode.trim()
    ? options.mode.trim()
    : null;
  const explicitIndexRoot = options.indexRoot ? path.resolve(options.indexRoot) : null;
  if (explicitIndexRoot) {
    return {
      ok: true,
      root: explicitIndexRoot,
      source: 'explicit-index-root',
      errorCode: null,
      context: { mode }
    };
  }
  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  const buildInfo = options.buildInfo || getCurrentBuildInfo(repoRoot, userConfig, { mode });
  if (!buildInfo) {
    return {
      ok: false,
      root: null,
      source: null,
      errorCode: BUILD_ROOT_RESOLUTION_FAILURES.missingCurrentBuild,
      context: { mode }
    };
  }
  const requireArtifacts = options.requireArtifacts !== false;
  const disallowRepoRootFallback = options.disallowRepoRootFallback === true;
  const runtimeBuildRoot = options.runtimeBuildRoot ? path.resolve(options.runtimeBuildRoot) : null;
  const candidates = [
    { source: 'mode-root', root: mode ? buildInfo.buildRoots?.[mode] : null },
    { source: 'active-root', root: buildInfo.activeRoot || null },
    { source: 'runtime-build-root', root: runtimeBuildRoot },
    { source: 'build-root', root: buildInfo.buildRoot || null }
  ];
  const attempted = [];
  for (const entry of candidates) {
    const candidate = coerceExistingPath(entry.root);
    if (!candidate) continue;
    const artifactReady = !requireArtifacts || hasModeIndexDir(candidate, mode);
    attempted.push({
      source: entry.source,
      root: candidate,
      artifactReady,
      disallowed: disallowRepoRootFallback
        ? isDisallowedBuildRootCandidate(candidate, repoCacheRoot, buildsRoot)
        : false
    });
  }
  const disallowedCandidate = attempted.find((entry) => entry.disallowed);
  const selected = attempted.find((entry) => entry.artifactReady && !entry.disallowed);
  if (selected) {
    return {
      ok: true,
      root: selected.root,
      source: selected.source,
      errorCode: null,
      context: {
        mode,
        buildId: buildInfo.buildId || null,
        attempted: attempted.map(({ source, root, artifactReady, disallowed }) => ({
          source,
          root,
          artifactReady,
          disallowed
        }))
      }
    };
  }
  return {
    ok: false,
    root: null,
    source: null,
    errorCode: attempted.some((entry) => entry.artifactReady === false)
      ? BUILD_ROOT_RESOLUTION_FAILURES.missingModeArtifacts
      : (disallowedCandidate
        ? BUILD_ROOT_RESOLUTION_FAILURES.disallowedRepoRootFallback
        : BUILD_ROOT_RESOLUTION_FAILURES.missingCurrentBuild),
    context: {
      mode,
      buildId: buildInfo.buildId || null,
      attempted: attempted.map(({ source, root, artifactReady, disallowed }) => ({
        source,
        root,
        artifactReady,
        disallowed
      }))
    }
  };
}

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
  const preferredMode = typeof options.mode === 'string' ? options.mode : null;
  const resolved = resolveCurrentBuildModeRoot(repoRoot, userConfig, {
    mode: preferredMode,
    requireArtifacts: true,
    disallowRepoRootFallback: false
  });
  if (resolved.ok && resolved.root) {
    return resolved.root;
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
