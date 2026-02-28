import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { atomicWriteJson, atomicWriteText } from '../../../shared/io/atomic-write.js';
import { sha1 } from '../../../shared/hash.js';
import { logLine } from '../../../shared/progress.js';
import { loadCheckpointSlices, mergeStageCheckpoints, resolveCheckpointIndexPath, writeCheckpointSlices } from './checkpoints.js';
import {
  BUILD_STATE_DURABILITY_CLASS,
  isRequiredBuildStateDurability,
  resolveBuildStateDurabilityClass
} from './durability.js';
import { mergeOrderingLedger, normalizeOrderingLedger } from './order-ledger.js';

const STATE_FILE = 'build_state.json';
const STATE_PROGRESS_FILE = 'build_state.progress.json';
const STATE_EVENTS_FILE = 'build_state.events.jsonl';
const STATE_DELTAS_FILE = 'build_state.deltas.jsonl';
const STATE_SCHEMA_VERSION = 1;
const EVENT_LOG_MAX_BYTES = 2 * 1024 * 1024;
const DELTA_LOG_MAX_BYTES = 4 * 1024 * 1024;
const STATE_MAP_MAX_ENTRIES = 64;

const isObjectLike = (value) => (
  Boolean(value) && typeof value === 'object'
);

const stateErrors = new Map();
const stateCaches = new Map();

let activeStateKeyResolver = null;

export const setActiveStateKeyResolver = (resolver) => {
  activeStateKeyResolver = typeof resolver === 'function' ? resolver : null;
};

const createBuildStateWriteFailureError = ({
  buildRoot,
  target,
  phase,
  cause
}) => {
  const resolvedBuildRoot = buildRoot ? path.resolve(buildRoot) : null;
  const code = String(cause?.code || cause?.name || 'UNKNOWN');
  const err = new Error(
    `[build_state] ${target} write failed (${code})${resolvedBuildRoot ? ` for ${resolvedBuildRoot}` : ''}.`,
    { cause }
  );
  err.code = 'ERR_BUILD_STATE_WRITE_FAILED';
  err.target = target;
  err.phase = phase;
  err.buildRoot = resolvedBuildRoot;
  err.causeCode = String(cause?.code || '');
  return err;
};

const isActiveStateKey = (key) => {
  if (!activeStateKeyResolver) return false;
  try {
    return Boolean(activeStateKeyResolver(key));
  } catch {
    return false;
  }
};

const trimStateMap = (map, { maxEntries = STATE_MAP_MAX_ENTRIES, skipActive = false } = {}) => {
  if (!(map instanceof Map)) return;
  if (!Number.isFinite(maxEntries) || maxEntries <= 0) return;
  if (map.size <= maxEntries) return;
  for (const [key] of map.entries()) {
    if (map.size <= maxEntries) break;
    if (skipActive && isActiveStateKey(key)) continue;
    map.delete(key);
  }
};

export const resolveStatePath = (buildRoot) => path.join(buildRoot, STATE_FILE);
const resolveProgressPath = (buildRoot) => path.join(buildRoot, STATE_PROGRESS_FILE);
const resolveEventsPath = (buildRoot) => path.join(buildRoot, STATE_EVENTS_FILE);
const resolveDeltasPath = (buildRoot) => path.join(buildRoot, STATE_DELTAS_FILE);

const fingerprintsMatch = (a, b) => (
  a && b && a.mtimeMs === b.mtimeMs && a.size === b.size
);

const readFingerprint = async (filePath) => {
  try {
    const stat = await fs.stat(filePath);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return null;
  }
};

const readJsonFile = async (filePath) => {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (!isObjectLike(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const stripUpdatedAt = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const next = { ...value };
  if ('updatedAt' in next) next.updatedAt = null;
  return next;
};

const hashJson = (value) => {
  if (value == null) return null;
  return sha1(JSON.stringify(value));
};

const hashJsonString = (value) => {
  if (value == null) return null;
  return sha1(value);
};

export const buildRootExists = async (buildRoot) => {
  if (!buildRoot) return false;
  try {
    await fs.access(buildRoot);
    return true;
  } catch {
    return false;
  }
};

const getCacheEntry = (buildRoot) => {
  const key = path.resolve(buildRoot);
  if (!stateCaches.has(key)) {
    stateCaches.set(key, {
      state: null,
      fingerprint: null,
      progress: null,
      progressFingerprint: null,
      progressHash: null,
      progressSerialized: null,
      stageCheckpoints: null,
      checkpointsFingerprint: null,
      checkpointsHash: null,
      checkpointsSerialized: null,
      lastHash: null,
      lastComparableHash: null
    });
    trimStateMap(stateCaches, { skipActive: true });
  }
  return stateCaches.get(key);
};

export const hydrateStateDefaults = async (state, buildRoot) => {
  if (!buildRoot) return state;
  const resolvedBuildRoot = path.resolve(buildRoot);
  const buildId = state.buildId || path.basename(resolvedBuildRoot);
  const buildRootValue = state.buildRoot || resolvedBuildRoot;
  let repo = state.repo ?? null;
  let repoRoot = state.repoRoot ?? null;
  if (!repo || !repoRoot) {
    try {
      const currentPath = path.join(path.dirname(resolvedBuildRoot), 'current.json');
      const current = JSON.parse(await fs.readFile(currentPath, 'utf8')) || {};
      if (!repo && current.repo) {
        repo = current.repo;
      }
      if (!repoRoot && current.repo?.root) {
        repoRoot = path.resolve(current.repo.root);
      }
    } catch {}
  }
  return {
    ...state,
    buildId,
    buildRoot: buildRootValue,
    repoRoot,
    repo
  };
};

/**
 * Merge a partial build-state patch into the current snapshot.
 * Nested objects updated incrementally are merged shallowly per key.
 */
export const mergeState = (base, patch) => {
  const merged = { ...base, ...patch };
  if (patch.phases) {
    merged.phases = { ...(base?.phases || {}), ...patch.phases };
  }
  if (patch.progress) {
    merged.progress = { ...(base?.progress || {}), ...patch.progress };
  }
  if (patch.heartbeat) {
    merged.heartbeat = { ...(base?.heartbeat || {}), ...patch.heartbeat };
  }
  if (patch.counts) {
    merged.counts = { ...(base?.counts || {}), ...patch.counts };
  }
  if (patch.signatures) {
    merged.signatures = { ...(base?.signatures || {}), ...patch.signatures };
  }
  if (patch.stageCheckpoints) {
    const next = { ...(base?.stageCheckpoints || {}) };
    for (const [mode, value] of Object.entries(patch.stageCheckpoints)) {
      if (value && typeof value === 'object' && next[mode] && typeof next[mode] === 'object') {
        next[mode] = { ...next[mode], ...value };
      } else {
        next[mode] = value;
      }
    }
    merged.stageCheckpoints = next;
  }
  if (patch.orderingLedger) {
    merged.orderingLedger = mergeOrderingLedger(base?.orderingLedger || null, patch.orderingLedger);
  }
  if (patch.byteBudgets) {
    merged.byteBudgets = patch.byteBudgets;
  }
  if (patch.ignore) {
    merged.ignore = { ...(base?.ignore || {}), ...patch.ignore };
  }
  return merged;
};

const mergeProgress = (base, patch) => {
  if (!patch) return base || {};
  const next = { ...(base || {}) };
  for (const [mode, value] of Object.entries(patch)) {
    if (value && typeof value === 'object') {
      next[mode] = { ...(next[mode] || {}), ...value };
    } else {
      next[mode] = value;
    }
  }
  return next;
};

const splitPatch = (patch) => {
  if (!patch || typeof patch !== 'object') return { main: patch, progress: null, checkpoints: null };
  const { progress, stageCheckpoints, ...rest } = patch;
  return { main: rest, progress: progress || null, checkpoints: stageCheckpoints || null };
};

const sanitizeMainState = (state) => {
  if (!state || typeof state !== 'object') return state;
  const next = { ...state };
  if ('stageCheckpoints' in next) delete next.stageCheckpoints;
  return next;
};

export const recordStateError = (buildRoot, err) => {
  if (!buildRoot || !err) return;
  const key = path.resolve(buildRoot);
  const existing = stateErrors.get(key) || { count: 0, lastAt: null, message: null };
  const message = err?.message || String(err);
  const next = {
    count: existing.count + 1,
    lastAt: new Date().toISOString(),
    message
  };
  stateErrors.set(key, next);
  trimStateMap(stateErrors, { skipActive: true });
  // Surface the failure without crashing the build.
  logLine(`[build_state] ${message}`, { kind: 'warning' });
};

const compressRotatedLog = async (filePath) => {
  try {
    const payload = await fs.readFile(filePath);
    const gzPath = `${filePath}.gz`;
    const gzPayload = zlib.gzipSync(payload);
    await fs.writeFile(gzPath, gzPayload);
    await fs.unlink(filePath);
  } catch {}
};

const appendEventLog = async (
  buildRoot,
  events,
  { durabilityClass = BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT } = {}
) => {
  if (!buildRoot || !events || !events.length) return;
  const filePath = resolveEventsPath(buildRoot);
  const resolvedDurabilityClass = resolveBuildStateDurabilityClass(durabilityClass);
  try {
    const stat = fsSync.existsSync(filePath) ? fsSync.statSync(filePath) : null;
    if (stat && stat.size >= EVENT_LOG_MAX_BYTES) {
      const rotated = `${filePath.replace(/\.jsonl$/, '')}.${Date.now()}.jsonl`;
      try { fsSync.renameSync(filePath, rotated); } catch {}
      await compressRotatedLog(rotated);
    }
    const lines = events.map((event) => JSON.stringify(event)).join('\n') + '\n';
    await fs.appendFile(filePath, lines, 'utf8');
  } catch (err) {
    if (isRequiredBuildStateDurability(resolvedDurabilityClass)) {
      throw createBuildStateWriteFailureError({
        buildRoot,
        target: 'events',
        phase: 'append',
        cause: err
      });
    }
    recordStateError(buildRoot, err);
  }
};

const buildDeltaEntries = ({ main, progress, checkpoints, ts }) => {
  const entries = [];
  const now = ts || new Date().toISOString();
  const push = (pathValue, value) => {
    entries.push({ op: 'set', path: pathValue, value, ts: now });
  };
  if (main && typeof main === 'object') {
    for (const [key, value] of Object.entries(main)) {
      push(`/${key}`, value);
    }
  }
  if (progress && typeof progress === 'object') {
    for (const [mode, value] of Object.entries(progress)) {
      push(`/progress/${mode}`, value);
    }
  }
  if (checkpoints && typeof checkpoints === 'object') {
    for (const [mode, value] of Object.entries(checkpoints)) {
      push(`/stageCheckpoints/${mode}`, value);
    }
  }
  return entries;
};

const appendDeltaLog = async (
  buildRoot,
  deltas,
  snapshot = null,
  { durabilityClass = BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT } = {}
) => {
  if (!buildRoot || !deltas || !deltas.length) return;
  const filePath = resolveDeltasPath(buildRoot);
  const resolvedDurabilityClass = resolveBuildStateDurabilityClass(durabilityClass);
  try {
    const stat = fsSync.existsSync(filePath) ? fsSync.statSync(filePath) : null;
    if (stat && stat.size >= DELTA_LOG_MAX_BYTES) {
      const rotated = `${filePath.replace(/\.jsonl$/, '')}.${Date.now()}.jsonl`;
      try { fsSync.renameSync(filePath, rotated); } catch {}
      await compressRotatedLog(rotated);
      if (snapshot) {
        const snapshotLine = JSON.stringify({ op: 'snapshot', value: snapshot, ts: new Date().toISOString() }) + '\n';
        await fs.writeFile(filePath, snapshotLine, 'utf8');
      }
    } else if (!stat && snapshot) {
      const snapshotLine = JSON.stringify({ op: 'snapshot', value: snapshot, ts: new Date().toISOString() }) + '\n';
      await fs.writeFile(filePath, snapshotLine, 'utf8');
    }
    const lines = deltas.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
    await fs.appendFile(filePath, lines, 'utf8');
  } catch (err) {
    if (isRequiredBuildStateDurability(resolvedDurabilityClass)) {
      throw createBuildStateWriteFailureError({
        buildRoot,
        target: 'deltas',
        phase: 'append',
        cause: err
      });
    }
    recordStateError(buildRoot, err);
  }
};

export const loadBuildState = async (buildRoot) => {
  const cache = getCacheEntry(buildRoot);
  const statePath = resolveStatePath(buildRoot);
  const fingerprint = await readFingerprint(statePath);
  if (fingerprintsMatch(fingerprint, cache.fingerprint) && cache.state) {
    return { state: cache.state, loaded: true, cache };
  }
  const parsed = fingerprint ? await readJsonFile(statePath) : null;
  cache.state = parsed;
  cache.fingerprint = fingerprint;
  cache.lastHash = parsed ? hashJson(parsed) : null;
  cache.lastComparableHash = parsed ? hashJson(stripUpdatedAt(parsed)) : null;
  return { state: parsed, loaded: Boolean(parsed), cache };
};

const loadSidecar = async (buildRoot, type) => {
  const cache = getCacheEntry(buildRoot);
  if (type === 'progress') {
    const filePath = resolveProgressPath(buildRoot);
    const fingerprint = await readFingerprint(filePath);
    if (fingerprintsMatch(fingerprint, cache.progressFingerprint) && cache.progress) {
      return cache.progress;
    }
    const parsed = fingerprint ? await readJsonFile(filePath) : null;
    cache.progress = parsed;
    cache.progressFingerprint = fingerprint;
    cache.progressHash = parsed ? hashJson(parsed) : null;
    return parsed;
  }
  const checkpointsFingerprint = await readFingerprint(resolveCheckpointIndexPath(buildRoot));
  if (fingerprintsMatch(checkpointsFingerprint, cache.checkpointsFingerprint) && cache.stageCheckpoints) {
    return cache.stageCheckpoints;
  }
  const parsed = await loadCheckpointSlices(buildRoot);
  cache.stageCheckpoints = parsed;
  cache.checkpointsFingerprint = checkpointsFingerprint;
  cache.checkpointsHash = parsed ? hashJson(parsed) : null;
  return parsed;
};

export const ensureStateVersions = (state, buildRoot, loaded) => {
  const schemaVersion = Number.isFinite(Number(state?.schemaVersion))
    ? Number(state.schemaVersion)
    : null;
  const signatureVersion = Number.isFinite(Number(state?.signatureVersion))
    ? Number(state.signatureVersion)
    : null;
  if (loaded && (schemaVersion == null || signatureVersion == null)) {
    recordStateError(buildRoot, new Error('build_state missing schemaVersion/signatureVersion'));
  }
  const orderingLedger = normalizeOrderingLedger(state?.orderingLedger);
  return {
    ...state,
    schemaVersion: schemaVersion ?? STATE_SCHEMA_VERSION,
    signatureVersion,
    ...(orderingLedger ? { orderingLedger } : {})
  };
};

const writeStateFile = async (
  buildRoot,
  state,
  cache,
  {
    comparableHash = null,
    durabilityClass = BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT
  } = {}
) => {
  if (!buildRoot || !state) return null;
  const statePath = resolveStatePath(buildRoot);
  const resolvedDurabilityClass = resolveBuildStateDurabilityClass(durabilityClass);
  const fullHash = hashJson(state);
  if (fullHash && cache.lastHash === fullHash) {
    cache.state = state;
    if (comparableHash) cache.lastComparableHash = comparableHash;
    return state;
  }
  try {
    await atomicWriteJson(statePath, state, { spaces: 0 });
    const fingerprint = await readFingerprint(statePath);
    cache.state = state;
    cache.fingerprint = fingerprint;
    cache.lastHash = fullHash;
    if (comparableHash) cache.lastComparableHash = comparableHash;
    return state;
  } catch (err) {
    if (err?.code === 'ENOENT' && !(await buildRootExists(buildRoot))) return null;
    if (isRequiredBuildStateDurability(resolvedDurabilityClass)) {
      throw createBuildStateWriteFailureError({
        buildRoot,
        target: 'state',
        phase: 'write',
        cause: err
      });
    }
    recordStateError(buildRoot, err);
    return null;
  }
};

const writeSidecarFile = async (
  buildRoot,
  type,
  payload,
  cache,
  { durabilityClass = BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT } = {}
) => {
  if (!buildRoot || !payload) return null;
  const resolvedDurabilityClass = resolveBuildStateDurabilityClass(durabilityClass);
  if (type === 'checkpoints') {
    return writeCheckpointSlices(buildRoot, {
      checkpointPatch: payload.patch,
      mergedCheckpoints: payload.merged,
      cache,
      durabilityClass: resolvedDurabilityClass
    });
  }
  const filePath = resolveProgressPath(buildRoot);
  const jsonString = `${JSON.stringify(payload)}\n`;
  const nextHash = hashJsonString(jsonString);
  const cachedHash = cache.progressHash;
  if (nextHash && cachedHash === nextHash) {
    cache.progress = payload;
    cache.progressSerialized = jsonString;
    return payload;
  }
  try {
    await atomicWriteText(filePath, jsonString);
    const fingerprint = await readFingerprint(filePath);
    cache.progress = payload;
    cache.progressFingerprint = fingerprint;
    cache.progressHash = nextHash;
    cache.progressSerialized = jsonString;
    return payload;
  } catch (err) {
    if (err?.code === 'ENOENT' && !(await buildRootExists(buildRoot))) return null;
    if (isRequiredBuildStateDurability(resolvedDurabilityClass)) {
      throw createBuildStateWriteFailureError({
        buildRoot,
        target: type,
        phase: 'write',
        cause: err
      });
    }
    recordStateError(buildRoot, err);
    return null;
  }
};

export const applyStatePatch = async (
  buildRoot,
  patch,
  events = [],
  { durabilityClass = BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT } = {}
) => {
  if (!buildRoot || !patch) return null;
  if (!(await buildRootExists(buildRoot))) return null;
  const resolvedDurabilityClass = resolveBuildStateDurabilityClass(durabilityClass);
  const { main, progress, checkpoints } = splitPatch(patch);
  const cache = getCacheEntry(buildRoot);
  const loadedState = await loadBuildState(buildRoot);
  let state = ensureStateVersions(loadedState?.state || {}, buildRoot, loadedState?.loaded);
  state = await hydrateStateDefaults(state, buildRoot);
  const deltaEntries = buildDeltaEntries({ main, progress, checkpoints });

  let nextProgress = null;
  if (progress) {
    const baseProgress = await loadSidecar(buildRoot, 'progress') || state.progress || {};
    nextProgress = mergeProgress(baseProgress, progress);
  }

  let nextCheckpoints = null;
  if (checkpoints) {
    const baseCheckpoints = await loadSidecar(buildRoot, 'checkpoints') || state.stageCheckpoints || {};
    nextCheckpoints = mergeStageCheckpoints(baseCheckpoints, checkpoints);
  }

  const writes = [];
  if (progress) {
    writes.push(writeSidecarFile(buildRoot, 'progress', nextProgress, cache, {
      durabilityClass: resolvedDurabilityClass
    }));
  }
  if (checkpoints) {
    writes.push(writeSidecarFile(
      buildRoot,
      'checkpoints',
      {
        patch: checkpoints,
        merged: nextCheckpoints
      },
      cache,
      { durabilityClass: resolvedDurabilityClass }
    ));
  }

  let merged = state;
  if (main && Object.keys(main).length > 0) {
    merged = mergeState(state, main);
    merged = sanitizeMainState(ensureStateVersions(merged, buildRoot, false));
    const comparableHash = hashJson(stripUpdatedAt(merged));
    const shouldWrite = comparableHash && comparableHash !== cache.lastComparableHash;
    if (shouldWrite) {
      merged.updatedAt = new Date().toISOString();
      writes.push(writeStateFile(buildRoot, merged, cache, {
        comparableHash,
        durabilityClass: resolvedDurabilityClass
      }));
    } else {
      if (comparableHash) cache.lastComparableHash = comparableHash;
      cache.state = merged;
    }
  }

  if (writes.length) {
    await Promise.all(writes);
  }
  if (events?.length) {
    await appendEventLog(buildRoot, events, {
      durabilityClass: resolvedDurabilityClass
    });
  }
  if (deltaEntries.length) {
    if (isRequiredBuildStateDurability(resolvedDurabilityClass)) {
      await appendDeltaLog(buildRoot, deltaEntries, merged, {
        durabilityClass: resolvedDurabilityClass
      });
    } else {
      void appendDeltaLog(buildRoot, deltaEntries, merged, {
        durabilityClass: resolvedDurabilityClass
      });
    }
  }
  return merged;
};
