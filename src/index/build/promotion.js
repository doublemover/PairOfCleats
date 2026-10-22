import { assertCurrentIndexFormat } from '../../contracts/index-format.js';
import fs from 'node:fs/promises';
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
import { throwIfAborted } from '../../shared/abort.js';

const CURRENT_POINTER_MAX_BYTES = 512 * 1024;

export async function promoteBuild({
  repoRoot,
  userConfig,
  buildId,
  buildRoot,
  stage,
  modes,
  modeBuildRoots = null,
  configHash,
  repoProvenance,
  artifactSurfaceVersion = ARTIFACT_SURFACE_VERSION,
  compatibilityKey = null,
  abortSignal = null
}) {
  throwIfAborted(abortSignal);
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
  let currentExists = false;
  try { await fs.lstat(currentPath); currentExists = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (currentExists) {
    let currentReadError = null;
    const current = await readJsonFileSafe(currentPath, {
      fallback: null,
      maxBytes: CURRENT_POINTER_MAX_BYTES,
      onError: (info) => {
        currentReadError = info || null;
      }
    });
    if (currentReadError) {
      throw Object.assign(new Error('Cannot preserve existing mode generations: current.json is unreadable. Repair the pointer before promotion.',
        { cause: currentReadError.error }), { code: 'ERR_CURRENT_POINTER_UNREADABLE' });
    }
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      throw Object.assign(new Error('Cannot preserve existing mode generations: current.json must be an object.'),
        { code: 'ERR_CURRENT_POINTER_UNREADABLE' });
    }
    assertCurrentIndexFormat({ operation: 'publish', component: 'existing build pointer',
      foundVersion: current.artifactSurfaceVersion, repoRoot, indexPath: currentPath });
    {
      for (const field of ['buildRootsByMode', 'buildRoots']) {
        if (current[field] != null && (typeof current[field] !== 'object' || Array.isArray(current[field]))) {
          throw new Error(`Existing current.json ${field} must be a mode-root map.`);
        }
      }
      if (current.extensions && typeof current.extensions === 'object' && !Array.isArray(current.extensions)) {
        priorExtensions = current.extensions;
      }
      if (current.buildRootsByMode && typeof current.buildRootsByMode === 'object' && !Array.isArray(current.buildRootsByMode)) {
        for (const [mode, value] of Object.entries(current.buildRootsByMode)) {
          const normalized = normalizeRelativeRoot(value);
          if (!normalized) throw new Error(`Existing mode build root is invalid: ${mode}`);
          priorRoots[mode] = normalized;
        }
      } else if (current.buildRoots && typeof current.buildRoots === 'object' && !Array.isArray(current.buildRoots)) {
        for (const [mode, value] of Object.entries(current.buildRoots)) {
          const normalized = normalizeRelativeRoot(value);
          if (!normalized) throw new Error(`Existing mode build root is invalid: ${mode}`);
          priorRoots[mode] = normalized;
        }
      } else if (typeof current.buildRoot === 'string' && Array.isArray(current.modes)) {
        const normalized = normalizeRelativeRoot(current.buildRoot);
        if (!normalized) throw new Error('Existing build root is invalid.');
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
  const rootsByMode = new Map(promotedModes.map(mode => [mode, resolvedBuildRoot]));
  if (modeBuildRoots !== null) {
    if (typeof modeBuildRoots !== 'object' || Array.isArray(modeBuildRoots)
      || Object.keys(modeBuildRoots).length !== rootsByMode.size
      || Object.keys(modeBuildRoots).some(mode => !rootsByMode.has(mode))) {
      throw new Error('Mode build roots must exactly match the promoted modes.');
    }
    for (const mode of rootsByMode.keys()) {
      const value = modeBuildRoots[mode];
      if (typeof value !== 'string' || !value.trim() || !normalizeRelativeRoot(value)) {
        throw new Error(`Mode build root is invalid or escapes repo cache root: ${mode}`);
      }
      rootsByMode.set(mode, toRealPathSync(isAbsolutePathNative(value) ? value : path.join(repoCacheRoot, value)));
    }
    if (![...rootsByMode.values()].includes(resolvedBuildRoot)) {
      throw new Error('Primary build root must own a promoted mode.');
    }
  }
  const modesByRoot = new Map();
  for (const [mode, root] of rootsByMode) {
    if (!modesByRoot.has(root)) modesByRoot.set(root, []);
    modesByRoot.get(root).push(mode);
  }
  if (!promotedModes.length) modesByRoot.set(resolvedBuildRoot, []);
  for (const [root, rootModes] of modesByRoot) {
    throwIfAborted(abortSignal);
    await assertArtifactPublicationReady({ buildRoot: root, modes: rootModes });
  }
  const buildRootsByMode = { ...priorRoots };
  for (const mode of promotedModes) {
    buildRootsByMode[mode] = toPosix(path.relative(resolvedCacheRoot, rootsByMode.get(mode)));
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
  await atomicWriteJson(currentPath, payload, { spaces: 0, signal: abortSignal });
  try {
    await reconcilePublishedSemanticBindingWork({ repoRoot, userConfig, buildId, buildRoot: resolvedBuildRoot,
      modes: modesByRoot.get(resolvedBuildRoot) || [] });
  } catch (error) {
    log('[build] warning: semantic task acknowledgement remains pending after publication: ' + (error.code || error.message));
  }
  log('[build] updated current.json', {
    fileOnlyLine: `[build] updated current.json -> ${currentPath}`
  });
  return payload;
}
