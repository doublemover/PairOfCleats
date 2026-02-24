import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteText } from '../../../shared/io/atomic-write.js';
import { sha1 } from '../../../shared/hash.js';
import { compareStrings } from '../../../shared/sort.js';
import {
  STAGE_CHECKPOINTS_SIDECAR_VERSION,
  STAGE_CHECKPOINTS_INDEX_BASENAME,
  buildStageCheckpointModeBasename
} from '../stage-checkpoints/sidecar.js';

const LEGACY_STATE_CHECKPOINTS_FILE = 'build_state.stage-checkpoints.json';

const isObjectLike = (value) => (
  Boolean(value) && typeof value === 'object'
);

const resolveLegacyCheckpointsPath = (buildRoot) => path.join(buildRoot, LEGACY_STATE_CHECKPOINTS_FILE);
export const resolveCheckpointIndexPath = (buildRoot) => path.join(buildRoot, STAGE_CHECKPOINTS_INDEX_BASENAME);
const resolveCheckpointModePath = (buildRoot, mode) => (
  path.join(buildRoot, buildStageCheckpointModeBasename(mode))
);

const readJsonFile = async (filePath) => {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (!isObjectLike(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const readFingerprint = async (filePath) => {
  try {
    const stat = await fs.stat(filePath);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return null;
  }
};

const hashJson = (value) => {
  if (value == null) return null;
  return sha1(JSON.stringify(value));
};

export const mergeStageCheckpoints = (base, patch) => {
  if (!patch) return base || {};
  const next = { ...(base || {}) };
  for (const [mode, value] of Object.entries(patch)) {
    if (value == null) {
      delete next[mode];
      continue;
    }
    if (value && typeof value === 'object') {
      next[mode] = { ...(next[mode] || {}), ...value };
    } else {
      next[mode] = value;
    }
  }
  return next;
};

export const collectCheckpointEvents = (stageCheckpoints, fallbackAt = null) => {
  if (!stageCheckpoints || typeof stageCheckpoints !== 'object') return [];
  const events = [];
  const fallback = fallbackAt || new Date().toISOString();
  for (const [mode, stages] of Object.entries(stageCheckpoints)) {
    if (!stages || typeof stages !== 'object') continue;
    for (const [stage, summary] of Object.entries(stages)) {
      const generatedAt = summary?.generatedAt || fallback;
      events.push({
        at: generatedAt,
        type: 'checkpoint',
        mode,
        stage,
        checkpointCount: Array.isArray(summary?.checkpoints) ? summary.checkpoints.length : null
      });
    }
  }
  return events;
};

const normalizeCheckpointIndex = (value) => {
  if (!value || typeof value !== 'object') return null;
  const version = Number.isFinite(Number(value.version))
    ? Math.floor(Number(value.version))
    : null;
  if (version !== STAGE_CHECKPOINTS_SIDECAR_VERSION) return null;
  const modes = value.modes && typeof value.modes === 'object' ? value.modes : {};
  const normalizedModes = {};
  for (const [mode, descriptor] of Object.entries(modes)) {
    if (!descriptor || typeof descriptor !== 'object') continue;
    const relPath = typeof descriptor.path === 'string' ? descriptor.path : null;
    if (!relPath) continue;
    normalizedModes[mode] = {
      path: relPath,
      updatedAt: typeof descriptor.updatedAt === 'string' ? descriptor.updatedAt : null
    };
  }
  return {
    version: STAGE_CHECKPOINTS_SIDECAR_VERSION,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    modes: normalizedModes
  };
};

const readCheckpointIndex = async (buildRoot) => {
  const parsed = await readJsonFile(resolveCheckpointIndexPath(buildRoot));
  return normalizeCheckpointIndex(parsed);
};

const serializeCheckpointIndex = (indexValue) => {
  const modes = {};
  const modeKeys = Object.keys(indexValue?.modes || {}).sort(compareStrings);
  for (const mode of modeKeys) {
    const descriptor = indexValue.modes[mode];
    if (!descriptor?.path) continue;
    modes[mode] = {
      path: descriptor.path,
      updatedAt: descriptor.updatedAt || null
    };
  }
  return {
    version: STAGE_CHECKPOINTS_SIDECAR_VERSION,
    updatedAt: indexValue?.updatedAt || new Date().toISOString(),
    modes
  };
};

export const loadCheckpointSlices = async (buildRoot) => {
  const index = await readCheckpointIndex(buildRoot);
  if (index?.modes && Object.keys(index.modes).length) {
    const merged = {};
    const modeKeys = Object.keys(index.modes).sort(compareStrings);
    for (const mode of modeKeys) {
      const descriptor = index.modes[mode];
      const relPath = descriptor?.path || null;
      if (!relPath) continue;
      const modePath = path.join(buildRoot, relPath);
      const payload = await readJsonFile(modePath);
      if (payload && typeof payload === 'object') {
        merged[mode] = payload;
      }
    }
    return merged;
  }
  // Back-compat fallback for pre-v1 sidecar naming.
  return await readJsonFile(resolveLegacyCheckpointsPath(buildRoot));
};

/**
 * Persist stage checkpoint payloads by mode so updates only rewrite changed
 * slices instead of a full combined snapshot on every checkpoint flush.
 */
export const writeCheckpointSlices = async (buildRoot, {
  checkpointPatch,
  mergedCheckpoints,
  cache
} = {}) => {
  if (!buildRoot || !checkpointPatch || !mergedCheckpoints || !cache) return null;
  const indexPath = resolveCheckpointIndexPath(buildRoot);
  const existingIndex = await readCheckpointIndex(buildRoot);
  const nextIndex = existingIndex || {
    version: STAGE_CHECKPOINTS_SIDECAR_VERSION,
    updatedAt: null,
    modes: {}
  };
  const now = new Date().toISOString();
  const hasExistingSidecarModes = Boolean(
    existingIndex?.modes
    && Object.keys(existingIndex.modes).length
  );
  const modeSource = hasExistingSidecarModes
    ? checkpointPatch
    : mergedCheckpoints;
  const modeKeys = Object.keys(modeSource || {}).sort(compareStrings);
  for (const mode of modeKeys) {
    const modePayload = mergedCheckpoints?.[mode];
    const descriptor = nextIndex.modes?.[mode] || null;
    const indexedModePath = descriptor?.path
      ? path.join(buildRoot, descriptor.path)
      : null;
    if (!modePayload || typeof modePayload !== 'object') {
      if (indexedModePath) {
        await fs.rm(indexedModePath, { force: true }).catch(() => {});
      }
      const canonicalModePath = resolveCheckpointModePath(buildRoot, mode);
      if (!indexedModePath || canonicalModePath !== indexedModePath) {
        await fs.rm(canonicalModePath, { force: true }).catch(() => {});
      }
      if (nextIndex.modes && mode in nextIndex.modes) {
        delete nextIndex.modes[mode];
      }
      continue;
    }
    const modePath = resolveCheckpointModePath(buildRoot, mode);
    const relPath = path.basename(modePath);
    const jsonString = `${JSON.stringify(modePayload)}\n`;
    const existingString = await fs.readFile(modePath, 'utf8').catch(() => null);
    if (existingString !== jsonString) {
      await atomicWriteText(modePath, jsonString);
    }
    nextIndex.modes[mode] = {
      path: relPath,
      updatedAt: now
    };
  }
  nextIndex.updatedAt = now;
  await atomicWriteText(indexPath, `${JSON.stringify(serializeCheckpointIndex(nextIndex))}\n`);
  cache.stageCheckpoints = mergedCheckpoints;
  cache.checkpointsFingerprint = await readFingerprint(indexPath);
  cache.checkpointsHash = hashJson(mergedCheckpoints);
  cache.checkpointsSerialized = null;
  return mergedCheckpoints;
};
