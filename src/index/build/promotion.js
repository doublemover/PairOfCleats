import { assertCurrentIndexFormat } from '../../contracts/index-format.js';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {
  getBuildsRoot,
  getRepoCacheRoot,
  getToolVersion
} from '../../shared/dict-utils.js';
import { log } from '../../shared/progress-runtime.js';
import { isAbsolutePathNative, toPosix } from '../../shared/file-paths.js';
import { readJsonFileSafe } from '../../shared/file-read.js';
import { atomicWriteJson } from '../../shared/io/atomic-write.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { isWithinRoot, toRealPathSync } from '../../workspace/identity.js';
import { assertArtifactPublicationReady } from './artifact-publication.js';
import { withGeneratedArtifactMetadata } from '../../shared/generated-artifact-core.js';
import { reconcilePublishedSemanticBindingWork } from '../semantic/build-frontier.js';

const CURRENT_POINTER_MAX_BYTES = 512 * 1024;

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
  assertCurrentIndexFormat({ operation: 'publish', component: 'build pointer',
    foundVersion: artifactSurfaceVersion, repoRoot, indexPath: buildRoot });
  const buildsRoot = getBuildsRoot(repoRoot, userConfig);
  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  const resolvedCacheRoot = toRealPathSync(repoCacheRoot);
  const resolvedBuildRoot = toRealPathSync(buildRoot);
  if (!isWithinRoot(resolvedBuildRoot, resolvedCacheRoot)) {
    throw new Error(`buildRoot escapes repo cache root: ${buildRoot}`);
  }
  const relativeRoot = toPosix(path.relative(resolvedCacheRoot, resolvedBuildRoot));
  const normalizeRelativeRoot = (value) => {
    if (typeof value !== 'string' || !value.trim()) return null;
    const resolved = isAbsolutePathNative(value) ? value : path.join(repoCacheRoot, value);
    const normalized = toRealPathSync(resolved);
    if (!isWithinRoot(normalized, resolvedCacheRoot)) return null;
    return toPosix(path.relative(resolvedCacheRoot, normalized));
  };
  const currentPath = path.join(buildsRoot, 'current.json');
  let priorRoots = {};
  let priorExtensions = null;
  if (fsSync.existsSync(currentPath)) {
    let currentReadError = null;
    const current = await readJsonFileSafe(currentPath, {
      fallback: null,
      maxBytes: CURRENT_POINTER_MAX_BYTES,
      onError: (info) => {
        currentReadError = info || null;
      }
    });
    if (currentReadError) {
      const errorCode = typeof currentReadError.error?.code === 'string'
        ? currentReadError.error.code
        : 'UNKNOWN';
      log('[build] warning: failed to read existing current.json; proceeding with empty prior roots.', {
        fileOnlyLine: (
          `[build] warning: current.json read failed (${currentReadError.phase}, ${errorCode}); `
          + 'proceeding with empty prior roots.'
        )
      });
    }
    if (current && typeof current === 'object' && current.artifactSurfaceVersion === ARTIFACT_SURFACE_VERSION) {
      if (current.extensions && typeof current.extensions === 'object' && !Array.isArray(current.extensions)) {
        priorExtensions = current.extensions;
      }
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
    }
  }
  const promotedModes = Array.isArray(modes) ? modes.filter((mode) => typeof mode === 'string') : [];
  await assertArtifactPublicationReady({
    buildRoot: resolvedBuildRoot,
    modes: promotedModes
  });
  const buildRootsByMode = { ...priorRoots };
  for (const mode of promotedModes) {
    buildRootsByMode[mode] = relativeRoot;
  }
  const payload = withGeneratedArtifactMetadata({
    extensions: priorExtensions,
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
  }, 'builds-current');
  await fs.mkdir(buildsRoot, { recursive: true });
  await atomicWriteJson(currentPath, payload, { spaces: 0 });
  try {
    await reconcilePublishedSemanticBindingWork({ repoRoot, userConfig, buildId, buildRoot: resolvedBuildRoot, modes: promotedModes });
  } catch (error) {
    log('[build] warning: semantic task acknowledgement remains pending after publication: ' + (error.code || error.message));
  }
  log('[build] updated current.json', {
    fileOnlyLine: `[build] updated current.json -> ${currentPath}`
  });
  return payload;
}
