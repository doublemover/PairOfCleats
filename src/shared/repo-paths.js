import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCacheRoot as getDefaultCacheRootShared } from './cache-roots.js';
import { isAbsolutePathNative } from './file-paths.js';
import { findUpwards } from './fs/find-upwards.js';
import { joinPathSafe } from './path-normalize.js';
import { normalizeIdentityPath, toRealPathSync } from '../workspace/identity.js';
import {
  BUILD_ROOT_SELECTION_SCOPES,
  resolveCanonicalBuildRoot,
  resolveCurrentBuildRoots
} from './indexing/build-pointer.js';

export const BUILD_ROOT_RESOLUTION_FAILURES = Object.freeze({
  missingCurrentBuild: 'missing_current_build',
  missingModeArtifacts: 'missing_mode_artifacts',
  disallowedRepoRootFallback: 'disallowed_repo_root_fallback'
});
export const BUILD_ROOT_SELECTION_SCOPE = BUILD_ROOT_SELECTION_SCOPES;

const sameIdentityPath = (left, right) => normalizeIdentityPath(left) === normalizeIdentityPath(right);

const isDisallowedBuildRootCandidate = (candidate, repoCacheRoot, buildsRoot) => {
  if (!candidate) return false;
  const canonicalCandidate = toRealPathSync(candidate);
  return sameIdentityPath(canonicalCandidate, repoCacheRoot)
    || sameIdentityPath(canonicalCandidate, buildsRoot);
};

const resolveConfigValue = (repoRoot, userConfig, { loadUserConfig } = {}) => {
  if (userConfig && typeof userConfig === 'object') return userConfig;
  if (typeof loadUserConfig === 'function') {
    return loadUserConfig(repoRoot);
  }
  return {};
};

const resolveCacheRootValue = (repoRoot, userConfig, options = {}) => {
  const cfg = resolveConfigValue(repoRoot, userConfig, options);
  const cacheRoot = (cfg.cache && cfg.cache.root)
    || (typeof options.getCacheRoot === 'function' ? options.getCacheRoot() : getDefaultCacheRootShared());
  if (!cacheRoot) {
    throw new Error('Repo cache root resolution requires userConfig.cache.root or options.getCacheRoot().');
  }
  return { cfg, cacheRoot };
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
  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig, options);
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  const buildInfo = options.buildInfo || getCurrentBuildInfo(repoRoot, userConfig, { ...options, mode });
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
  const runtimeBuildRoot = options.runtimeBuildRoot ? path.resolve(options.runtimeBuildRoot) : null;
  const allowLegacyRepoRootFallback = options.allowLegacyRepoRootFallback === true;
  const attempted = resolveCanonicalBuildRoot({
    repoCacheRoot,
    buildsRoot,
    buildInfo,
    preferredMode: mode,
    runtimeBuildRoot,
    requireArtifacts,
    allowLegacyRepoRootFallback
  }).attempted.map((entry) => ({
    ...entry,
    disallowed: options.disallowRepoRootFallback === true
      ? isDisallowedBuildRootCandidate(entry.root, repoCacheRoot, buildsRoot)
      : entry.disallowed
  }));
  const disallowedCandidate = attempted.find((entry) => entry.disallowed);
  const selected = attempted.find((entry) => entry.artifactReady && !entry.disallowed);
  if (selected) {
    return {
      ok: true,
      root: selected.root,
      source: selected.source,
      scope: selected.scope,
      errorCode: null,
      context: {
        mode,
        buildId: buildInfo.buildId || null,
        attempted: attempted.map(({ source, scope, root, artifactReady, disallowed }) => ({
          source,
          scope,
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
    scope: null,
    errorCode: attempted.some((entry) => entry.artifactReady === false)
      ? BUILD_ROOT_RESOLUTION_FAILURES.missingModeArtifacts
      : (disallowedCandidate
        ? BUILD_ROOT_RESOLUTION_FAILURES.disallowedRepoRootFallback
        : BUILD_ROOT_RESOLUTION_FAILURES.missingCurrentBuild),
    context: {
      mode,
      buildId: buildInfo.buildId || null,
      attempted: attempted.map(({ source, scope, root, artifactReady, disallowed }) => ({
        source,
        scope,
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

export function getRepoCacheRoot(repoRoot, userConfig = null, options = {}) {
  const { cacheRoot } = resolveCacheRootValue(repoRoot, userConfig, options);
  const repoId = getRepoId(repoRoot);
  return path.join(cacheRoot, 'repos', repoId);
}

export function getBuildsRoot(repoRoot, userConfig = null, options = {}) {
  return path.join(getRepoCacheRoot(repoRoot, userConfig, options), 'builds');
}

export function getCurrentBuildInfo(repoRoot, userConfig = null, options = {}) {
  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig, options);
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

export function resolveIndexRoot(repoRoot, userConfig = null, options = {}) {
  if (options?.indexRoot) return path.resolve(options.indexRoot);
  const preferredMode = typeof options.mode === 'string' ? options.mode : null;
  const resolved = resolveCurrentBuildModeRoot(repoRoot, userConfig, {
    ...options,
    mode: preferredMode,
    requireArtifacts: true,
    disallowRepoRootFallback: false,
    allowLegacyRepoRootFallback: options.allowLegacyRepoRootFallback === true
  });
  if (resolved.ok && resolved.root) {
    return resolved.root;
  }
  return getRepoCacheRoot(repoRoot, userConfig, options);
}

export function resolvePath(repoRoot, filePath) {
  if (!filePath) return null;
  if (isAbsolutePathNative(filePath)) return path.resolve(filePath);
  return joinPathSafe(repoRoot, [filePath]);
}

export function getIndexDir(repoRoot, mode, userConfig = null, options = {}) {
  const base = resolveIndexRoot(repoRoot, userConfig, { ...options, mode });
  return path.join(base, `index-${mode}`);
}
