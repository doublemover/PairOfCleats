import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { atomicWriteJson, atomicWriteText } from '../../../shared/io/atomic-write.js';
import { sha1 } from '../../../shared/hash.js';
import { acquireFileLock } from '../../../shared/locks/file-lock.js';
import { logLine } from '../../../shared/progress.js';
import { readJsonFileSafe } from '../../../shared/files.js';
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
const STATE_WRITE_LOCK_FILE = 'build_state.write.lock';
const STATE_SCHEMA_VERSION = 1;
const EVENT_LOG_MAX_BYTES = 2 * 1024 * 1024;
const DELTA_LOG_MAX_BYTES = 4 * 1024 * 1024;
const EVENT_LOG_MAX_ARCHIVES = 24;
const DELTA_LOG_MAX_ARCHIVES = 24;
const EVENT_LOG_MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const DELTA_LOG_MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const STATE_MAP_MAX_ENTRIES = 64;
const STATE_JSON_MAX_BYTES = 8 * 1024 * 1024;
const PROGRESS_JSON_MAX_BYTES = 4 * 1024 * 1024;
const CURRENT_POINTER_MAX_BYTES = 512 * 1024;
const gzipAsync = promisify(zlib.gzip);

const isObjectLike = (value) => (
  Boolean(value) && typeof value === 'object'
);

const stateErrors = new Map();
const stateCaches = new Map();
const recentPatchStagesByBuildRoot = new Map();
const PATCH_STAGE_TRACK_MAX_BUILD_ROOTS = 64;
const PATCH_STAGE_TRACK_MAX_PATCHES = 256;

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

const createBuildStateLockUnavailableError = ({
  buildRoot,
  durabilityClass
}) => {
  const resolvedBuildRoot = buildRoot ? path.resolve(buildRoot) : null;
  const err = new Error(
    `[build_state] state write lock unavailable${resolvedBuildRoot ? ` for ${resolvedBuildRoot}` : ''}.`
  );
  err.code = 'ERR_BUILD_STATE_LOCK_UNAVAILABLE';
  err.buildRoot = resolvedBuildRoot;
  err.retryable = true;
  err.buildState = {
    retryable: true,
    reason: 'lock-unavailable',
    durabilityClass: resolveBuildStateDurabilityClass(durabilityClass),
    buildRoot: resolvedBuildRoot
  };
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
const resolveStateWriteLockPath = (buildRoot) => path.join(buildRoot, STATE_WRITE_LOCK_FILE);

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

const readJsonFile = async (filePath, {
  maxBytes = 0,
  label = 'json',
  strict = false,
  buildRoot = null,
  target = 'state'
} = {}) => {
  try {
    if (Number.isFinite(maxBytes) && maxBytes > 0) {
      const stat = await fs.stat(filePath);
      if (Number.isFinite(stat?.size) && stat.size > maxBytes) {
        logLine(
          `[build_state] Skipping oversized ${label} file (${stat.size} bytes > ${maxBytes} bytes): ${filePath}`,
          { kind: 'warning' }
        );
        return null;
      }
    }
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (!isObjectLike(parsed)) {
      if (strict) {
        const err = new Error(`[build_state] invalid ${label} payload (expected object): ${filePath}`);
        err.code = 'ERR_BUILD_STATE_CORRUPT';
        err.target = target;
        err.buildRoot = buildRoot ? path.resolve(buildRoot) : null;
        throw err;
      }
      return null;
    }
    return parsed;
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    if (strict) {
      const wrapped = new Error(
        `[build_state] failed to parse ${label} file: ${filePath}`,
        { cause: err }
      );
      wrapped.code = 'ERR_BUILD_STATE_CORRUPT';
      wrapped.target = target;
      wrapped.buildRoot = buildRoot ? path.resolve(buildRoot) : null;
      throw wrapped;
    }
    return null;
  }
};

const trimRecentPatchStageBuildRoots = () => {
  while (recentPatchStagesByBuildRoot.size > PATCH_STAGE_TRACK_MAX_BUILD_ROOTS) {
    const oldestKey = recentPatchStagesByBuildRoot.keys().next().value;
    if (oldestKey == null) break;
    if (isActiveStateKey(oldestKey)) {
      const value = recentPatchStagesByBuildRoot.get(oldestKey);
      recentPatchStagesByBuildRoot.delete(oldestKey);
      recentPatchStagesByBuildRoot.set(oldestKey, value);
      continue;
    }
    recentPatchStagesByBuildRoot.delete(oldestKey);
  }
};

const getRecentPatchStageMap = (buildRoot) => {
  const key = path.resolve(buildRoot);
  if (!recentPatchStagesByBuildRoot.has(key)) {
    recentPatchStagesByBuildRoot.set(key, new Map());
    trimRecentPatchStageBuildRoots();
  }
  return recentPatchStagesByBuildRoot.get(key);
};

const markPatchStageApplied = (buildRoot, patchId, stage) => {
  if (!buildRoot || !patchId || !stage) return;
  const stageMap = getRecentPatchStageMap(buildRoot);
  const existingStages = stageMap.get(patchId);
  if (existingStages) {
    existingStages.add(stage);
    stageMap.delete(patchId);
    stageMap.set(patchId, existingStages);
  } else {
    stageMap.set(patchId, new Set([stage]));
  }
  while (stageMap.size > PATCH_STAGE_TRACK_MAX_PATCHES) {
    const oldestPatchId = stageMap.keys().next().value;
    if (oldestPatchId == null) break;
    stageMap.delete(oldestPatchId);
  }
};

const hasPatchStageApplied = (buildRoot, patchId, stage) => {
  if (!buildRoot || !patchId || !stage) return false;
  const stageMap = recentPatchStagesByBuildRoot.get(path.resolve(buildRoot));
  if (!(stageMap instanceof Map)) return false;
  const stages = stageMap.get(patchId);
  return stages instanceof Set && stages.has(stage);
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
    const currentPath = path.join(path.dirname(resolvedBuildRoot), 'current.json');
    let currentReadError = null;
    const current = await readJsonFileSafe(currentPath, {
      fallback: null,
      maxBytes: CURRENT_POINTER_MAX_BYTES,
      onError: (info) => {
        currentReadError = info || null;
      }
    });
    if (currentReadError?.error?.code && currentReadError.error.code !== 'ENOENT') {
      const errorCode = currentReadError.error.code || 'ERR_CURRENT_POINTER_READ';
      logLine(
        `[build_state] current.json read failed (${errorCode}) at ${currentPath}; `
          + 'using in-state repo defaults',
        { kind: 'warning' }
      );
    }
    if (current && typeof current === 'object') {
      if (!repo && current.repo) {
        repo = current.repo;
      }
      if (!repoRoot && current.repo?.root) {
        repoRoot = path.resolve(current.repo.root);
      }
    }
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
    const gzPayload = await gzipAsync(payload);
    await atomicWriteText(gzPath, gzPayload, { newline: false });
    await fs.unlink(filePath);
  } catch (err) {
    throw err;
  }
};

const statIfExists = async (filePath) => {
  try {
    return await fs.stat(filePath);
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
};

const resolveRotatedLogRetentionPolicy = (target) => {
  if (target === 'events') {
    return {
      maxArchives: EVENT_LOG_MAX_ARCHIVES,
      maxArchiveBytes: EVENT_LOG_MAX_ARCHIVE_BYTES
    };
  }
  if (target === 'deltas') {
    return {
      maxArchives: DELTA_LOG_MAX_ARCHIVES,
      maxArchiveBytes: DELTA_LOG_MAX_ARCHIVE_BYTES
    };
  }
  return {
    maxArchives: 16,
    maxArchiveBytes: 64 * 1024 * 1024
  };
};

const listRotatedLogEntries = async (filePath) => {
  const dirPath = path.dirname(filePath);
  const parsed = path.parse(filePath);
  const prefix = `${parsed.name}.`;
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const rotatedEntries = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (!name.startsWith(prefix)) continue;
    if (!name.endsWith('.jsonl') && !name.endsWith('.jsonl.gz')) continue;
    const fullPath = path.join(dirPath, name);
    let stat = null;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      continue;
    }
    rotatedEntries.push({
      path: fullPath,
      mtimeMs: Number(stat?.mtimeMs || 0),
      size: Number(stat?.size || 0)
    });
  }
  rotatedEntries.sort((left, right) => (
    right.mtimeMs - left.mtimeMs
  ));
  return rotatedEntries;
};

const pruneRotatedLogs = async (filePath, target) => {
  const {
    maxArchives,
    maxArchiveBytes
  } = resolveRotatedLogRetentionPolicy(target);
  const entries = await listRotatedLogEntries(filePath);
  if (!entries.length) return;
  let retainedCount = 0;
  let retainedBytes = 0;
  const toDelete = [];
  for (const entry of entries) {
    const shouldKeepByCount = retainedCount < maxArchives;
    const shouldKeepByBytes = (retainedBytes + entry.size) <= maxArchiveBytes;
    if (shouldKeepByCount && shouldKeepByBytes) {
      retainedCount += 1;
      retainedBytes += entry.size;
      continue;
    }
    toDelete.push(entry.path);
  }
  if (!toDelete.length) return;
  await Promise.all(toDelete.map(async (targetPath) => {
    try {
      await fs.rm(targetPath, { force: true });
    } catch {}
  }));
};

const rotateLogIfNeeded = async (
  filePath,
  maxBytes,
  buildRoot,
  target,
  resolvedDurabilityClass
) => {
  const stat = await statIfExists(filePath);
  if (!stat || stat.size < maxBytes) {
    return { rotated: false, existed: Boolean(stat) };
  }
  const rotated = `${filePath.replace(/\.jsonl$/, '')}.${Date.now()}.jsonl`;
  try {
    await fs.rename(filePath, rotated);
  } catch (err) {
    if (isRequiredBuildStateDurability(resolvedDurabilityClass)) {
      throw createBuildStateWriteFailureError({
        buildRoot,
        target,
        phase: 'rotate',
        cause: err
      });
    }
    recordStateError(buildRoot, err);
    return { rotated: false, existed: true };
  }
  try {
    await compressRotatedLog(rotated);
  } catch (err) {
    if (isRequiredBuildStateDurability(resolvedDurabilityClass)) {
      throw createBuildStateWriteFailureError({
        buildRoot,
        target,
        phase: 'compress',
        cause: err
      });
    }
    recordStateError(buildRoot, err);
  }
  try {
    await pruneRotatedLogs(filePath, target);
  } catch (err) {
    if (isRequiredBuildStateDurability(resolvedDurabilityClass)) {
      throw createBuildStateWriteFailureError({
        buildRoot,
        target,
        phase: 'prune',
        cause: err
      });
    }
    recordStateError(buildRoot, err);
  }
  return { rotated: true, existed: true };
};

const syncParentDirectory = async (filePath) => {
  const parentPath = path.dirname(filePath);
  let handle = null;
  try {
    handle = await fs.open(parentPath, 'r');
    await handle.sync();
  } catch (err) {
    const code = String(err?.code || '').toUpperCase();
    // Some platforms/filesystems do not support directory fsync.
    if (code !== 'EINVAL' && code !== 'ENOTSUP' && code !== 'EPERM') {
      throw err;
    }
  } finally {
    try {
      await handle?.close();
    } catch {}
  }
};

const writeTextWithDurability = async (filePath, text, {
  append = false,
  durable = false
} = {}) => {
  if (!append) {
    await atomicWriteText(filePath, text, { newline: false });
    return;
  }
  if (!durable) {
    await fs.appendFile(filePath, text, 'utf8');
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const existedBefore = Boolean(await statIfExists(filePath));
  const handle = await fs.open(filePath, append ? 'a' : 'w');
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (!existedBefore || !append) {
    await syncParentDirectory(filePath);
  }
};

const appendEventLog = async (
  buildRoot,
  events,
  { durabilityClass = BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT } = {}
) => {
  if (!buildRoot || !events || !events.length) return true;
  const filePath = resolveEventsPath(buildRoot);
  const resolvedDurabilityClass = resolveBuildStateDurabilityClass(durabilityClass);
  try {
    await rotateLogIfNeeded(
      filePath,
      EVENT_LOG_MAX_BYTES,
      buildRoot,
      'events',
      resolvedDurabilityClass
    );
    const lines = events.map((event) => JSON.stringify(event)).join('\n') + '\n';
    await writeTextWithDurability(filePath, lines, {
      append: true,
      durable: isRequiredBuildStateDurability(resolvedDurabilityClass)
    });
    return true;
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
    return false;
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
  if (!buildRoot || !deltas || !deltas.length) return true;
  const filePath = resolveDeltasPath(buildRoot);
  const resolvedDurabilityClass = resolveBuildStateDurabilityClass(durabilityClass);
  try {
    const rotateResult = await rotateLogIfNeeded(
      filePath,
      DELTA_LOG_MAX_BYTES,
      buildRoot,
      'deltas',
      resolvedDurabilityClass
    );
    if (rotateResult.rotated && snapshot) {
      const snapshotLine = JSON.stringify({ op: 'snapshot', value: snapshot, ts: new Date().toISOString() }) + '\n';
      await writeTextWithDurability(filePath, snapshotLine, {
        durable: isRequiredBuildStateDurability(resolvedDurabilityClass)
      });
    } else if (!rotateResult.existed && snapshot) {
      const snapshotLine = JSON.stringify({ op: 'snapshot', value: snapshot, ts: new Date().toISOString() }) + '\n';
      await writeTextWithDurability(filePath, snapshotLine, {
        durable: isRequiredBuildStateDurability(resolvedDurabilityClass)
      });
    }
    const lines = deltas.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
    await writeTextWithDurability(filePath, lines, {
      append: true,
      durable: isRequiredBuildStateDurability(resolvedDurabilityClass)
    });
    return true;
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
    return false;
  }
};

export const loadBuildState = async (buildRoot) => {
  const cache = getCacheEntry(buildRoot);
  const statePath = resolveStatePath(buildRoot);
  const fingerprint = await readFingerprint(statePath);
  if (fingerprintsMatch(fingerprint, cache.fingerprint) && cache.state) {
    return { state: cache.state, loaded: true, cache };
  }
  const parsed = fingerprint
    ? await readJsonFile(statePath, {
      maxBytes: STATE_JSON_MAX_BYTES,
      label: 'state',
      strict: true,
      buildRoot,
      target: 'state'
    })
    : null;
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
    const parsed = fingerprint
      ? await readJsonFile(filePath, { maxBytes: PROGRESS_JSON_MAX_BYTES, label: 'progress' })
      : null;
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
  const lockPath = resolveStateWriteLockPath(buildRoot);
  const lock = await acquireFileLock({
    lockPath,
    waitMs: isRequiredBuildStateDurability(resolvedDurabilityClass) ? 5000 : 0,
    pollMs: 100,
    staleMs: 15 * 60 * 1000,
    forceStaleCleanup: false,
    timeoutBehavior: isRequiredBuildStateDurability(resolvedDurabilityClass) ? 'throw' : 'null',
    timeoutMessage: `[build_state] state write lock timeout for ${path.resolve(buildRoot)}`,
    metadata: { scope: 'build-state-write' }
  });
  if (!lock) {
    throw createBuildStateLockUnavailableError({
      buildRoot,
      durabilityClass: resolvedDurabilityClass
    });
  }
  let releaseError = null;
  try {
    const { main, progress, checkpoints } = splitPatch(patch);
    const patchId = sha1(JSON.stringify({
      main: main || null,
      progress: progress || null,
      checkpoints: checkpoints || null,
      events: Array.isArray(events) ? events : []
    }));
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
    if (events?.length && !hasPatchStageApplied(buildRoot, patchId, 'events')) {
      const eventsWritten = await appendEventLog(buildRoot, events, {
        durabilityClass: resolvedDurabilityClass
      });
      if (eventsWritten) {
        markPatchStageApplied(buildRoot, patchId, 'events');
      }
    }
    if (deltaEntries.length && !hasPatchStageApplied(buildRoot, patchId, 'deltas')) {
      const deltasWritten = await appendDeltaLog(buildRoot, deltaEntries, merged, {
        durabilityClass: resolvedDurabilityClass
      });
      if (deltasWritten) {
        markPatchStageApplied(buildRoot, patchId, 'deltas');
      }
    }
    return merged;
  } finally {
    let released = false;
    try {
      released = await lock.release();
    } catch (err) {
      releaseError = err;
    }
    if (!releaseError && released !== true) {
      releaseError = new Error(
        `[build_state] state write lock release returned false for ${path.resolve(buildRoot)}.`
      );
      releaseError.code = 'ERR_BUILD_STATE_LOCK_RELEASE_FAILED';
    }
    if (releaseError) {
      if (isRequiredBuildStateDurability(resolvedDurabilityClass)) {
        throw createBuildStateWriteFailureError({
          buildRoot,
          target: 'state-lock',
          phase: 'release',
          cause: releaseError
        });
      }
      recordStateError(buildRoot, releaseError);
    }
  }
};
