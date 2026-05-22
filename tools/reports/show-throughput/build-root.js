import fs from 'node:fs';
import path from 'node:path';
import {
  findLatestBuildRootWithIndexes,
  readCurrentBuildGeneration,
  resolveCanonicalBuildRoot
} from '../../../src/shared/indexing/build-pointer.js';

export const resolveExistingDirectory = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const candidate = path.resolve(value.trim());
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isDirectory()) return null;
    return candidate;
  } catch {
    return null;
  }
};

export const resolveBuildRootFromSqliteArtifacts = (
  artifactReport,
  { requireExisting = true } = {}
) => {
  const sqlite = artifactReport?.repo?.sqlite || {};
  const sqliteCandidates = [
    sqlite?.code?.path,
    sqlite?.prose?.path,
    sqlite?.extractedProse?.path,
    sqlite?.records?.path
  ].filter((value) => typeof value === 'string' && value.trim());

  for (const sqlitePath of sqliteCandidates) {
    const sqliteDir = path.dirname(sqlitePath);
    if (path.basename(sqliteDir).toLowerCase() !== 'index-sqlite') continue;
    const buildRoot = path.dirname(sqliteDir);
    if (!requireExisting) return buildRoot;
    const resolved = resolveExistingDirectory(buildRoot);
    if (resolved) return resolved;
  }
  return null;
};

export const resolveCurrentBuildRoot = (buildsRoot, { preferredMode = null } = {}) => {
  const currentPath = path.join(buildsRoot, 'current.json');
  const repoCacheRoot = path.dirname(buildsRoot);
  const generation = readCurrentBuildGeneration({
    currentJsonPath: currentPath,
    repoCacheRoot,
    buildsRoot,
    preferredMode
  });
  if (!generation.parseOk) return null;
  const resolved = resolveCanonicalBuildRoot({
    repoCacheRoot,
    buildsRoot,
    buildInfo: generation,
    preferredMode,
    requireArtifacts: false,
    allowLegacyRepoRootFallback: false
  });
  return resolved.ok ? resolved.root : null;
};

export const resolveBuildRootFromArtifactReport = (artifactReport) => {
  const repo = artifactReport?.repo || {};

  const explicitBuildCandidates = [
    repo?.buildRoot,
    repo?.build?.root,
    repo?.build?.buildRoot,
    repo?.build?.activeRoot
  ];
  for (const candidate of explicitBuildCandidates) {
    const resolved = resolveExistingDirectory(candidate);
    if (resolved) return resolved;
  }

  const sqliteBuildRoot = resolveBuildRootFromSqliteArtifacts(artifactReport);
  if (sqliteBuildRoot) return sqliteBuildRoot;

  const cacheRoot = typeof repo?.cacheRoot === 'string' ? repo.cacheRoot : '';
  if (!cacheRoot) return null;
  const buildsRoot = path.join(cacheRoot, 'builds');
  const resolvedBuildsRoot = resolveExistingDirectory(buildsRoot);
  if (!resolvedBuildsRoot) return null;

  const currentBuildRoot = resolveCurrentBuildRoot(resolvedBuildsRoot);
  if (currentBuildRoot) return currentBuildRoot;

  const latestIndexedBuildRoot = findLatestBuildRootWithIndexes(resolvedBuildsRoot);
  if (latestIndexedBuildRoot) return latestIndexedBuildRoot;

  const buildDirs = fs.readdirSync(resolvedBuildsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const buildRoot = path.join(resolvedBuildsRoot, entry.name);
      let mtimeMs = -1;
      try {
        mtimeMs = fs.statSync(buildRoot).mtimeMs;
      } catch {}
      return { buildRoot, mtimeMs };
    })
    .sort((left, right) => (
      right.mtimeMs - left.mtimeMs
    ) || String(right.buildRoot).localeCompare(String(left.buildRoot)));

  return buildDirs[0]?.buildRoot || null;
};
