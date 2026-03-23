import fs from 'node:fs';
import path from 'node:path';
import { isAbsolutePathNative } from '../files.js';
import { isWithinRoot, normalizeIdentityPath, toRealPathSync } from '../../workspace/identity.js';

export const DEFAULT_BUILD_MODES = Object.freeze(['code', 'prose', 'extracted-prose', 'records']);
export const BUILD_ROOT_SELECTION_SCOPES = Object.freeze({
  ACTIVE_GENERATION: 'active-generation',
  PROMOTED_CURRENT: 'promoted-current',
  LEGACY_REPO_CACHE: 'legacy-repo-cache-root'
});
export const MODE_ARTIFACT_MARKERS = Object.freeze([
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
]);

const sameIdentityPath = (left, right) => normalizeIdentityPath(left) === normalizeIdentityPath(right);

const normalizePointerValue = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

export const resolveCacheScopedBuildPointerRoot = (value, repoCacheRoot, buildsRoot) => {
  const normalizedValue = normalizePointerValue(value);
  if (!normalizedValue) return null;
  const repoCacheResolved = toRealPathSync(repoCacheRoot);
  const candidates = isAbsolutePathNative(normalizedValue)
    ? [normalizedValue]
    : [
      path.join(repoCacheRoot, normalizedValue),
      path.join(buildsRoot, normalizedValue)
    ];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    const canonical = toRealPathSync(resolved);
    if (isWithinRoot(canonical, repoCacheResolved)) {
      return canonical;
    }
  }
  return null;
};

export const resolveCacheScopedBuildIdRoot = (buildId, repoCacheRoot, buildsRoot) => {
  const normalizedBuildId = normalizePointerValue(buildId);
  if (!normalizedBuildId || isAbsolutePathNative(normalizedBuildId)) return null;
  const candidate = path.resolve(buildsRoot, normalizedBuildId);
  const canonical = toRealPathSync(candidate);
  if (!isWithinRoot(canonical, toRealPathSync(repoCacheRoot))) return null;
  if (!isWithinRoot(canonical, toRealPathSync(buildsRoot))) return null;
  return canonical;
};

export const hasModeArtifacts = (rootPath, mode) => {
  const indexDir = path.join(rootPath, `index-${mode}`);
  if (!fs.existsSync(indexDir)) return false;
  for (const marker of MODE_ARTIFACT_MARKERS) {
    if (fs.existsSync(path.join(indexDir, marker))) {
      return true;
    }
  }
  return false;
};

export const hasModeIndexDir = (rootPath, mode = null) => {
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

export const findLatestBuildRootWithIndexes = (buildsRoot, mode = null) => {
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
    candidates.push({ root: toRealPathSync(candidateRoot), mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.root || null;
};

export const resolveCurrentBuildRoots = (
  data,
  {
    repoCacheRoot,
    buildsRoot,
    preferredMode = null
  }
) => {
  const buildId = normalizePointerValue(data?.buildId);
  const buildRootRaw = normalizePointerValue(data?.buildRoot);
  let buildRoot = buildRootRaw
    ? resolveCacheScopedBuildPointerRoot(buildRootRaw, repoCacheRoot, buildsRoot)
    : (buildId ? resolveCacheScopedBuildIdRoot(buildId, repoCacheRoot, buildsRoot) : null);
  if (!buildRoot && buildId) {
    buildRoot = resolveCacheScopedBuildPointerRoot(buildId, repoCacheRoot, buildsRoot);
  }
  const repoCacheResolved = toRealPathSync(repoCacheRoot);
  if (
    buildId
    && buildRoot
    && sameIdentityPath(path.resolve(buildRoot), repoCacheResolved)
  ) {
    const buildIdRoot = resolveCacheScopedBuildIdRoot(buildId, repoCacheRoot, buildsRoot);
    if (buildIdRoot && fs.existsSync(buildIdRoot)) {
      buildRoot = buildIdRoot;
    }
  }
  const buildRoots = {};
  const buildRootsSource = data?.buildRootsByMode && typeof data.buildRootsByMode === 'object' && !Array.isArray(data.buildRootsByMode)
    ? data.buildRootsByMode
    : (data?.buildRoots && typeof data.buildRoots === 'object' && !Array.isArray(data.buildRoots)
      ? data.buildRoots
      : null);
  if (buildRootsSource) {
    for (const [mode, value] of Object.entries(buildRootsSource)) {
      if (typeof value !== 'string') continue;
      const resolved = resolveCacheScopedBuildPointerRoot(value, repoCacheRoot, buildsRoot);
      if (resolved) buildRoots[mode] = resolved;
    }
  } else if (buildRoot && Array.isArray(data?.modes)) {
    for (const mode of data.modes) {
      if (typeof mode !== 'string') continue;
      buildRoots[mode] = buildRoot;
    }
  }
  const firstExistingModeRoot = Object.values(buildRoots).find((candidate) => (
    typeof candidate === 'string' && fs.existsSync(candidate)
  )) || null;
  const preferredRoot = preferredMode ? buildRoots[preferredMode] : null;
  let activeRoot = preferredRoot || buildRoot || firstExistingModeRoot || Object.values(buildRoots)[0] || null;
  if ((!activeRoot || !fs.existsSync(activeRoot)) && buildId) {
    const buildIdRoot = resolveCacheScopedBuildIdRoot(buildId, repoCacheRoot, buildsRoot);
    if (buildIdRoot && fs.existsSync(buildIdRoot)) {
      activeRoot = buildIdRoot;
    }
  }
  if (activeRoot && !hasModeIndexDir(activeRoot, preferredMode)) {
    const buildIdRoot = buildId ? resolveCacheScopedBuildIdRoot(buildId, repoCacheRoot, buildsRoot) : null;
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
  return {
    buildId: buildId || (activeRoot ? path.basename(activeRoot) : null),
    buildRoot,
    activeRoot,
    buildRoots
  };
};

const coerceExistingPath = (value) => (value && fs.existsSync(value) ? value : null);

const classifyCandidateScope = (source, rootPath, activeRoot) => {
  if (source === 'runtime-build-root' || source === 'active-root') {
    return BUILD_ROOT_SELECTION_SCOPES.ACTIVE_GENERATION;
  }
  if (source === 'legacy-repo-cache-root') {
    return BUILD_ROOT_SELECTION_SCOPES.LEGACY_REPO_CACHE;
  }
  if (rootPath && activeRoot && sameIdentityPath(rootPath, activeRoot)) {
    return BUILD_ROOT_SELECTION_SCOPES.ACTIVE_GENERATION;
  }
  return BUILD_ROOT_SELECTION_SCOPES.PROMOTED_CURRENT;
};

export const resolveCanonicalBuildRoot = ({
  repoCacheRoot,
  buildsRoot,
  buildInfo = null,
  preferredMode = null,
  runtimeBuildRoot = null,
  requireArtifacts = true,
  allowLegacyRepoRootFallback = false
} = {}) => {
  if (!buildInfo || typeof buildInfo !== 'object') {
    return {
      ok: false,
      root: null,
      source: null,
      scope: null,
      attempted: []
    };
  }
  const candidates = [
    { source: 'runtime-build-root', root: runtimeBuildRoot || null },
    { source: 'active-root', root: buildInfo.activeRoot || null },
    { source: 'mode-root', root: preferredMode ? buildInfo.buildRoots?.[preferredMode] : null },
    { source: 'build-root', root: buildInfo.buildRoot || null }
  ];
  if (allowLegacyRepoRootFallback) {
    candidates.push({ source: 'legacy-repo-cache-root', root: repoCacheRoot || null });
  }
  const attempted = [];
  const repoCacheResolved = repoCacheRoot ? toRealPathSync(repoCacheRoot) : null;
  const buildsRootResolved = buildsRoot ? toRealPathSync(buildsRoot) : null;
  for (const entry of candidates) {
    const candidate = coerceExistingPath(entry.root);
    if (!candidate) continue;
    const canonicalCandidate = toRealPathSync(candidate);
    const scope = classifyCandidateScope(entry.source, canonicalCandidate, buildInfo.activeRoot || null);
    const disallowed = scope === BUILD_ROOT_SELECTION_SCOPES.LEGACY_REPO_CACHE
      && repoCacheResolved
      && buildsRootResolved
      && (sameIdentityPath(canonicalCandidate, repoCacheResolved)
        || sameIdentityPath(canonicalCandidate, buildsRootResolved));
    const artifactReady = !requireArtifacts || hasModeIndexDir(canonicalCandidate, preferredMode);
    attempted.push({
      source: entry.source,
      scope,
      root: canonicalCandidate,
      artifactReady,
      disallowed
    });
  }
  const selected = attempted.find((entry) => entry.artifactReady && !entry.disallowed);
  if (selected) {
    return {
      ok: true,
      root: selected.root,
      source: selected.source,
      scope: selected.scope,
      attempted
    };
  }
  return {
    ok: false,
    root: null,
    source: null,
    scope: null,
    attempted
  };
};
