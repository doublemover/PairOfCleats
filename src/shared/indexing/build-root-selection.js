import { sameIdentityPath } from './build-pointer-roots.js';

export const BUILD_ROOT_SELECTION_SCOPES = Object.freeze({
  ACTIVE_GENERATION: 'active-generation',
  PROMOTED_CURRENT: 'promoted-current',
  LEGACY_REPO_CACHE: 'legacy-repo-cache-root'
});

const coerceExistingPath = (value, existsSync) => (value && existsSync(value) ? value : null);

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
  allowLegacyRepoRootFallback = false,
  existsSync,
  toRealPathSync,
  hasModeIndexDir
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
    const candidate = coerceExistingPath(entry.root, existsSync);
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
