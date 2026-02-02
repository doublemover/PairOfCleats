import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {
  getBuildsRoot,
  getRepoCacheRoot,
  getToolVersion
} from '../../shared/dict-utils.js';
import { writeJsonObjectFile } from '../../shared/json-stream.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';

export async function promoteBuild({
  repoRoot,
  userConfig,
  buildId,
  buildRoot,
  stage,
  modes,
  configHash,
  repoProvenance,
  artifactSurfaceVersion = ARTIFACT_SURFACE_VERSION,
  compatibilityKey = null
}) {
  if (!repoRoot || !buildId || !buildRoot) return null;
  const buildsRoot = getBuildsRoot(repoRoot, userConfig);
  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  const resolvedCacheRoot = path.resolve(repoCacheRoot);
  const resolvedBuildRoot = path.resolve(buildRoot);
  if (!resolvedBuildRoot.startsWith(resolvedCacheRoot + path.sep) && resolvedBuildRoot !== resolvedCacheRoot) {
    throw new Error(`buildRoot escapes repo cache root: ${buildRoot}`);
  }
  const relativeRoot = path.relative(repoCacheRoot, buildRoot).split(path.sep).join('/');
  const normalizeRelativeRoot = (value) => {
    if (typeof value !== 'string' || !value.trim()) return null;
    const resolved = path.isAbsolute(value) ? value : path.join(repoCacheRoot, value);
    const normalized = path.resolve(resolved);
    if (!normalized.startsWith(resolvedCacheRoot + path.sep) && normalized !== resolvedCacheRoot) return null;
    return path.relative(repoCacheRoot, normalized).split(path.sep).join('/');
  };
  const currentPath = path.join(buildsRoot, 'current.json');
  let priorRoots = {};
  if (fsSync.existsSync(currentPath)) {
    try {
      const current = JSON.parse(await fs.readFile(currentPath, 'utf8')) || {};
      if (current.buildRootsByMode && typeof current.buildRootsByMode === 'object' && !Array.isArray(current.buildRootsByMode)) {
        for (const [mode, value] of Object.entries(current.buildRootsByMode)) {
          const normalized = normalizeRelativeRoot(value);
          if (normalized) priorRoots[mode] = normalized;
        }
      } else if (current.buildRoots && typeof current.buildRoots === 'object' && !Array.isArray(current.buildRoots)) {
        for (const [mode, value] of Object.entries(current.buildRoots)) {
          const normalized = normalizeRelativeRoot(value);
          if (normalized) priorRoots[mode] = normalized;
        }
      } else if (typeof current.buildRoot === 'string' && Array.isArray(current.modes)) {
        const normalized = normalizeRelativeRoot(current.buildRoot);
        if (normalized) {
          for (const mode of current.modes) {
            if (typeof mode !== 'string') continue;
            priorRoots[mode] = normalized;
          }
        }
      }
    } catch {}
  }
  const promotedModes = Array.isArray(modes) ? modes.filter((mode) => typeof mode === 'string') : [];
  const buildRootsByMode = { ...priorRoots };
  for (const mode of promotedModes) {
    buildRootsByMode[mode] = relativeRoot;
  }
  const payload = {
    buildId,
    buildRoot: relativeRoot,
    buildRootsByMode: Object.keys(buildRootsByMode).length ? buildRootsByMode : null,
    promotedAt: new Date().toISOString(),
    stage: stage || null,
    modes: promotedModes.length ? promotedModes : null,
    configHash: configHash || null,
    artifactSurfaceVersion,
    compatibilityKey,
    tool: { version: getToolVersion() },
    repo: repoProvenance || null
  };
  await fs.mkdir(buildsRoot, { recursive: true });
  await writeJsonObjectFile(currentPath, { fields: payload, atomic: true });
  return payload;
}
