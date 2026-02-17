import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { atomicWriteJson, atomicWriteText } from '../../shared/io/atomic-write.js';
import { sha1 } from '../../shared/hash.js';
import { estimateJsonBytes } from '../../shared/cache.js';
import { createLifecycleRegistry } from '../../shared/lifecycle/registry.js';
import { logLine } from '../../shared/progress.js';
import {
  INDEX_PROFILE_DEFAULT,
  INDEX_PROFILE_SCHEMA_VERSION,
  normalizeIndexProfileId
} from '../../contracts/index-profile.js';
import {
  STAGE_CHECKPOINTS_SIDECAR_VERSION,
  STAGE_CHECKPOINTS_SIDECAR_PREFIX,
  STAGE_CHECKPOINTS_INDEX_BASENAME,
  buildStageCheckpointModeBasename
} from './stage-checkpoints/sidecar.js';

const STATE_FILE = 'build_state.json';
const STATE_PROGRESS_FILE = 'build_state.progress.json';
const LEGACY_STATE_CHECKPOINTS_FILE = 'build_state.stage-checkpoints.json';
const STATE_EVENTS_FILE = 'build_state.events.jsonl';
const STATE_DELTAS_FILE = 'build_state.deltas.jsonl';
const STATE_SCHEMA_VERSION = 1;
export const ORDERING_LEDGER_SCHEMA_VERSION = 1;
const HEARTBEAT_MIN_INTERVAL_MS = 5000;
const DEFAULT_DEBOUNCE_MS = 250;
const LONG_DEBOUNCE_MS = 500;
const VERY_LONG_DEBOUNCE_MS = 1000;
const EVENT_LOG_MAX_BYTES = 2 * 1024 * 1024;
const DELTA_LOG_MAX_BYTES = 4 * 1024 * 1024;
const LARGE_PATCH_BYTES = 64 * 1024;
const STATE_MAP_MAX_ENTRIES = 64;
const sortStrings = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));

const stateQueues = new Map();
const stateErrors = new Map();
const stateCaches = new Map();
const statePending = new Map();
const statePendingLifecycles = new Map();

const isActiveStateKey = (key) => (
  stateQueues.has(key)
  || statePending.has(key)
  || statePendingLifecycles.has(key)
);

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

const resolveStatePath = (buildRoot) => path.join(buildRoot, STATE_FILE);
const resolveProgressPath = (buildRoot) => path.join(buildRoot, STATE_PROGRESS_FILE);
const resolveLegacyCheckpointsPath = (buildRoot) => path.join(buildRoot, LEGACY_STATE_CHECKPOINTS_FILE);
const resolveCheckpointIndexPath = (buildRoot) => path.join(buildRoot, STAGE_CHECKPOINTS_INDEX_BASENAME);
const resolveCheckpointModePath = (buildRoot, mode) => (
  path.join(buildRoot, buildStageCheckpointModeBasename(mode))
);
const resolveEventsPath = (buildRoot) => path.join(buildRoot, STATE_EVENTS_FILE);
const resolveDeltasPath = (buildRoot) => path.join(buildRoot, STATE_DELTAS_FILE);

const resolveDebounceMs = (patch) => {
  if (!patch || typeof patch !== 'object') return DEFAULT_DEBOUNCE_MS;
  const patchBytes = estimateJsonBytes(patch);
  if (patchBytes > LARGE_PATCH_BYTES) return VERY_LONG_DEBOUNCE_MS;
  if (patch.heartbeat) return LONG_DEBOUNCE_MS;
  if (patch.progress || patch.stageCheckpoints) return LONG_DEBOUNCE_MS;
  return DEFAULT_DEBOUNCE_MS;
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

const getPendingLifecycle = (buildRoot) => {
  const key = path.resolve(buildRoot);
  if (!statePendingLifecycles.has(key)) {
    statePendingLifecycles.set(
      key,
      createLifecycleRegistry({ name: `build-state-pending:${path.basename(key)}` })
    );
  }
  return statePendingLifecycles.get(key);
};

const releasePendingLifecycle = (buildRoot) => {
  const key = path.resolve(buildRoot);
  const lifecycle = statePendingLifecycles.get(key);
  if (!lifecycle) return;
  statePendingLifecycles.delete(key);
  void lifecycle.close().catch(() => {});
};

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

const buildRootExists = async (buildRoot) => {
  if (!buildRoot) return false;
  try {
    await fs.access(buildRoot);
    return true;
  } catch {
    return false;
  }
};

const hydrateStateDefaults = async (state, buildRoot) => {
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

const mergeState = (base, patch) => {
  const merged = { ...base, ...patch };
  const isObject = (value) => (
    value && typeof value === 'object' && !Array.isArray(value)
  );
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
      if (isObject(value) && isObject(next[mode])) {
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

const mergeStageCheckpoints = (base, patch) => {
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

const normalizeOrderingLedger = (ledger) => {
  if (!ledger || typeof ledger !== 'object') return null;
  const version = Number.isFinite(Number(ledger.schemaVersion))
    ? Number(ledger.schemaVersion)
    : 0;
  let next = {
    schemaVersion: version || ORDERING_LEDGER_SCHEMA_VERSION,
    seeds: ledger.seeds && typeof ledger.seeds === 'object' ? { ...ledger.seeds } : {},
    stages: ledger.stages && typeof ledger.stages === 'object' ? { ...ledger.stages } : {}
  };
  if (version && version > ORDERING_LEDGER_SCHEMA_VERSION) {
    return { ...next, schemaVersion: version };
  }
  if (version && version !== ORDERING_LEDGER_SCHEMA_VERSION) {
    next = {
      ...next,
      schemaVersion: ORDERING_LEDGER_SCHEMA_VERSION
    };
  }
  return next;
};

const mergeOrderingLedger = (base, patch) => {
  if (!patch) return base || null;
  const normalizedBase = normalizeOrderingLedger(base) || {
    schemaVersion: ORDERING_LEDGER_SCHEMA_VERSION,
    seeds: {},
    stages: {}
  };
  const normalizedPatch = normalizeOrderingLedger(patch) || {
    schemaVersion: ORDERING_LEDGER_SCHEMA_VERSION,
    seeds: {},
    stages: {}
  };
  const next = {
    schemaVersion: ORDERING_LEDGER_SCHEMA_VERSION,
    seeds: { ...(normalizedBase.seeds || {}), ...(normalizedPatch.seeds || {}) },
    stages: { ...(normalizedBase.stages || {}) }
  };
  for (const [stage, value] of Object.entries(normalizedPatch.stages || {})) {
    if (!value || typeof value !== 'object') {
      next.stages[stage] = value;
      continue;
    }
    const baseStage = normalizedBase.stages?.[stage];
    const mergedStage = {
      ...(baseStage && typeof baseStage === 'object' ? baseStage : {}),
      ...value
    };
    if (value.seeds && typeof value.seeds === 'object') {
      mergedStage.seeds = {
        ...(baseStage?.seeds && typeof baseStage.seeds === 'object' ? baseStage.seeds : {}),
        ...value.seeds
      };
    }
    if (value.artifacts && typeof value.artifacts === 'object') {
      mergedStage.artifacts = {
        ...(baseStage?.artifacts && typeof baseStage.artifacts === 'object' ? baseStage.artifacts : {}),
        ...value.artifacts
      };
    }
    next.stages[stage] = mergedStage;
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

const collectCheckpointEvents = (stageCheckpoints, fallbackAt = null) => {
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

const recordStateError = (buildRoot, err) => {
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

const appendEventLog = async (buildRoot, events) => {
  if (!buildRoot || !events || !events.length) return;
  const filePath = resolveEventsPath(buildRoot);
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

const appendDeltaLog = async (buildRoot, deltas, snapshot = null) => {
  if (!buildRoot || !deltas || !deltas.length) return;
  const filePath = resolveDeltasPath(buildRoot);
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
    recordStateError(buildRoot, err);
  }
};

const enqueueStateUpdate = (buildRoot, action) => {
  if (!buildRoot) return Promise.resolve(null);
  const key = path.resolve(buildRoot);
  const prior = stateQueues.get(key) || Promise.resolve();
  const next = prior.catch(() => {}).then(action);
  stateQueues.set(key, next.finally(() => {
    if (stateQueues.get(key) === next) stateQueues.delete(key);
  }));
  return next;
};

const readJsonFile = async (filePath) => {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
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
  const modeKeys = Object.keys(indexValue?.modes || {}).sort(sortStrings);
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

const loadCheckpointSlices = async (buildRoot) => {
  const index = await readCheckpointIndex(buildRoot);
  if (index?.modes && Object.keys(index.modes).length) {
    const merged = {};
    const modeKeys = Object.keys(index.modes).sort(sortStrings);
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

const loadBuildState = async (buildRoot) => {
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

const ensureStateVersions = (state, buildRoot, loaded) => {
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

const writeStateFile = async (buildRoot, state, cache, { comparableHash = null } = {}) => {
  if (!buildRoot || !state) return null;
  const statePath = resolveStatePath(buildRoot);
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
    recordStateError(buildRoot, err);
    return null;
  }
};

/**
 * Persist stage checkpoint payloads by mode so updates only rewrite changed
 * slices instead of a full combined snapshot on every checkpoint flush.
 */
const writeCheckpointSlices = async (buildRoot, {
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
  const modeKeys = Object.keys(modeSource || {}).sort(sortStrings);
  for (const mode of modeKeys) {
    const modePayload = mergedCheckpoints?.[mode];
    if (!modePayload || typeof modePayload !== 'object') continue;
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

const writeSidecarFile = async (buildRoot, type, payload, cache) => {
  if (!buildRoot || !payload) return null;
  if (type === 'checkpoints') {
    return writeCheckpointSlices(buildRoot, {
      checkpointPatch: payload.patch,
      mergedCheckpoints: payload.merged,
      cache
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
    recordStateError(buildRoot, err);
    return null;
  }
};

const applyStatePatch = async (buildRoot, patch, events = []) => {
  if (!buildRoot || !patch) return null;
  if (!(await buildRootExists(buildRoot))) return null;
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
  if (progress) writes.push(writeSidecarFile(buildRoot, 'progress', nextProgress, cache));
  if (checkpoints) {
    writes.push(writeSidecarFile(buildRoot, 'checkpoints', {
      patch: checkpoints,
      merged: nextCheckpoints
    }, cache));
  }

  let merged = state;
  if (main && Object.keys(main).length > 0) {
    merged = mergeState(state, main);
    merged = sanitizeMainState(ensureStateVersions(merged, buildRoot, false));
    const comparableHash = hashJson(stripUpdatedAt(merged));
    const shouldWrite = comparableHash && comparableHash !== cache.lastComparableHash;
    if (shouldWrite) {
      merged.updatedAt = new Date().toISOString();
      writes.push(writeStateFile(buildRoot, merged, cache, { comparableHash }));
    } else {
      if (comparableHash) cache.lastComparableHash = comparableHash;
      cache.state = merged;
    }
  }

  if (writes.length) {
    await Promise.all(writes);
  }
  if (events?.length) {
    await appendEventLog(buildRoot, events);
  }
  if (deltaEntries.length) {
    void appendDeltaLog(buildRoot, deltaEntries, merged);
  }
  return merged;
};

const getPendingEntry = (buildRoot) => {
  const key = path.resolve(buildRoot);
  if (!statePending.has(key)) {
    statePending.set(key, {
      patch: null,
      events: [],
      timer: null,
      timerCancel: null,
      lifecycle: getPendingLifecycle(buildRoot),
      resolves: [],
      rejects: []
    });
  }
  return statePending.get(key);
};

const flushPendingState = async (buildRoot) => {
  const key = path.resolve(buildRoot);
  const pending = statePending.get(key);
  if (!pending || !pending.patch) return null;
  if (pending.timerCancel) {
    pending.timerCancel();
    pending.timerCancel = null;
    pending.timer = null;
  }
  const patch = pending.patch;
  const events = pending.events;
  const resolves = pending.resolves;
  const rejects = pending.rejects;
  pending.patch = null;
  pending.events = [];
  pending.resolves = [];
  pending.rejects = [];
  try {
    const result = await enqueueStateUpdate(buildRoot, () => applyStatePatch(buildRoot, patch, events));
    resolves.forEach((resolve) => resolve(result));
    if (!pending.patch && !pending.timer) {
      statePending.delete(key);
      releasePendingLifecycle(buildRoot);
    }
    return result;
  } catch (err) {
    rejects.forEach((reject) => reject(err));
    recordStateError(buildRoot, err);
    if (!pending.patch && !pending.timer) {
      statePending.delete(key);
      releasePendingLifecycle(buildRoot);
    }
    return null;
  }
};

const queueStatePatch = (buildRoot, patch, events = [], { flushNow = false } = {}) => {
  if (!buildRoot || !patch) return Promise.resolve(null);
  const pending = getPendingEntry(buildRoot);
  pending.patch = pending.patch ? mergeState(pending.patch, patch) : patch;
  if (events.length) pending.events.push(...events);
  const promise = new Promise((resolve, reject) => {
    pending.resolves.push(resolve);
    pending.rejects.push(reject);
  });
  if (pending.timerCancel) {
    pending.timerCancel();
    pending.timerCancel = null;
  } else if (pending.timer) {
    clearTimeout(pending.timer);
  }
  if (pending.timer) {
    pending.timer = null;
  }
  if (flushNow) {
    void flushPendingState(buildRoot);
  } else {
    const delay = resolveDebounceMs(pending.patch);
    pending.timer = setTimeout(() => {
      pending.timer = null;
      pending.timerCancel = null;
      void flushPendingState(buildRoot);
    }, delay);
    pending.timerCancel = pending.lifecycle.registerTimer(pending.timer, {
      label: 'build-state-debounce'
    });
  }
  return promise;
};

export async function initBuildState({
  buildRoot,
  buildId,
  repoRoot,
  modes,
  stage,
  configHash,
  toolVersion,
  repoProvenance,
  signatureVersion,
  profile = null
}) {
  if (!buildRoot) return null;
  const statePath = resolveStatePath(buildRoot);
  const now = new Date().toISOString();
  const payload = {
    schemaVersion: STATE_SCHEMA_VERSION,
    buildId,
    buildRoot: path.resolve(buildRoot),
    repoRoot: repoRoot ? path.resolve(repoRoot) : null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: null,
    stage: stage || null,
    modes: Array.isArray(modes) ? modes : null,
    currentPhase: null,
    tool: {
      version: toolVersion || null,
      node: process.version
    },
    signatureVersion: signatureVersion ?? null,
    configHash: configHash || null,
    profile: {
      id: normalizeIndexProfileId(profile?.id, INDEX_PROFILE_DEFAULT),
      schemaVersion: Number.isFinite(Number(profile?.schemaVersion))
        ? Math.max(1, Math.floor(Number(profile.schemaVersion)))
        : INDEX_PROFILE_SCHEMA_VERSION
    },
    repo: repoProvenance || null,
    phases: {},
    progress: {}
  };
  await fs.mkdir(buildRoot, { recursive: true });
  await atomicWriteJson(statePath, payload, { spaces: 0 });
  return statePath;
}

export async function updateBuildState(buildRoot, patch) {
  if (!buildRoot || !patch) return null;
  const events = collectCheckpointEvents(patch.stageCheckpoints);
  return queueStatePatch(buildRoot, patch, events);
}

const normalizeSeedInputs = (inputs = {}) => ({
  discoveryHash: typeof inputs.discoveryHash === 'string' ? inputs.discoveryHash : null,
  fileListHash: typeof inputs.fileListHash === 'string' ? inputs.fileListHash : null,
  fileCount: Number.isFinite(inputs.fileCount) ? inputs.fileCount : null,
  mode: typeof inputs.mode === 'string' ? inputs.mode : null
});

const resolveStageKey = (stage, mode) => {
  if (!stage) return null;
  const stageKey = String(stage);
  return mode ? `${stageKey}:${mode}` : stageKey;
};

export async function recordOrderingSeedInputs(buildRoot, inputs = {}, { stage = null, mode = null } = {}) {
  if (!buildRoot) return null;
  const seeds = normalizeSeedInputs({ ...inputs, mode });
  const stageKey = resolveStageKey(stage, mode);
  const now = new Date().toISOString();
  const patch = {
    orderingLedger: {
      schemaVersion: ORDERING_LEDGER_SCHEMA_VERSION,
      seeds,
      ...(stageKey ? { stages: { [stageKey]: { seeds } } } : {})
    }
  };
  return updateBuildState(buildRoot, patch);
}

export async function recordOrderingHash(buildRoot, {
  stage,
  mode = null,
  artifact,
  hash,
  rule = null,
  count = null
} = {}) {
  if (!buildRoot || !stage || !artifact || !hash) return null;
  const stageKey = resolveStageKey(stage, mode);
  if (!stageKey) return null;
  const loaded = await loadBuildState(buildRoot);
  const currentLedger = normalizeOrderingLedger(loaded?.state?.orderingLedger);
  const currentEntry = currentLedger?.stages?.[stageKey]?.artifacts?.[artifact];
  const entry = {
    hash,
    rule,
    count: Number.isFinite(count) ? count : null,
    mode
  };
  if (currentEntry
    && currentEntry.hash === entry.hash
    && currentEntry.rule === entry.rule
    && currentEntry.count === entry.count
    && currentEntry.mode === entry.mode) {
    return currentLedger;
  }
  const patch = {
    orderingLedger: {
      schemaVersion: ORDERING_LEDGER_SCHEMA_VERSION,
      stages: {
        [stageKey]: {
          artifacts: {
            [artifact]: entry
          }
        }
      }
    }
  };
  return updateBuildState(buildRoot, patch);
}

export async function loadOrderingLedger(buildRoot) {
  if (!buildRoot) return null;
  const loaded = await loadBuildState(buildRoot);
  return normalizeOrderingLedger(loaded?.state?.orderingLedger);
}

export function validateOrderingLedger(ledger) {
  const normalized = normalizeOrderingLedger(ledger);
  if (!normalized) return { ok: false, errors: ['orderingLedger missing'] };
  const errors = [];
  if (!Number.isFinite(Number(normalized.schemaVersion))) {
    errors.push('orderingLedger.schemaVersion missing');
  }
  if (!normalized.stages || typeof normalized.stages !== 'object') {
    errors.push('orderingLedger.stages missing');
  }
  return { ok: errors.length === 0, errors, value: normalized };
}

export async function exportOrderingLedger(buildRoot, outputPath = null) {
  const ledger = await loadOrderingLedger(buildRoot);
  if (outputPath && ledger) {
    await atomicWriteJson(outputPath, ledger, { spaces: 0 });
  }
  return ledger;
}

export async function flushBuildState(buildRoot) {
  if (!buildRoot) return null;
  const key = path.resolve(buildRoot);
  const pending = statePending.get(key);
  if (pending?.timerCancel) {
    pending.timerCancel();
    pending.timerCancel = null;
    pending.timer = null;
  } else if (pending?.timer) {
    clearTimeout(pending.timer);
    pending.timer = null;
  }
  const result = await flushPendingState(buildRoot);
  if (pending && !pending.patch && !pending.timer) {
    statePending.delete(key);
    releasePendingLifecycle(buildRoot);
  }
  return result;
}

export async function markBuildPhase(buildRoot, phase, status, detail = null) {
  if (!buildRoot || !phase || !status) return null;
  if (!(await buildRootExists(buildRoot))) return null;
  const now = new Date().toISOString();
  const loadedState = await loadBuildState(buildRoot);
  let current = ensureStateVersions(loadedState?.state || {}, buildRoot, loadedState?.loaded);
  const existing = current?.phases?.[phase] || {};
  const next = {
    ...existing,
    status,
    detail: detail || existing.detail || null,
    updatedAt: now
  };
  if (status === 'running' && !existing.startedAt) next.startedAt = now;
  if (status === 'done' || status === 'failed') next.finishedAt = now;
  const finishedAt = (status === 'done' || status === 'failed')
    && (phase === 'promote' || phase === 'watch')
    ? now
    : current?.finishedAt || null;
  const patch = {
    currentPhase: phase,
    phases: { [phase]: next },
    finishedAt
  };
  const events = [{
    at: now,
    type: 'phase',
    phase,
    status,
    detail: detail || null
  }];
  return queueStatePatch(buildRoot, patch, events);
}

export function startBuildHeartbeat(buildRoot, stage, intervalMs = 30000) {
  if (!buildRoot) return () => {};
  const lifecycle = createLifecycleRegistry({
    name: `build-state-heartbeat:${path.basename(path.resolve(buildRoot))}`
  });
  let lastWrite = 0;
  let active = true;
  let timer = null;
  const stop = () => {
    if (!active) return;
    active = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    void lifecycle.close().catch(() => {});
    void flushBuildState(buildRoot);
  };
  const tick = async () => {
    if (!active) return;
    if (!(await buildRootExists(buildRoot))) {
      stop();
      return;
    }
    const nowMs = Date.now();
    if (nowMs - lastWrite < HEARTBEAT_MIN_INTERVAL_MS) return;
    lastWrite = nowMs;
    const now = new Date().toISOString();
    const writeTask = updateBuildState(buildRoot, {
      heartbeat: {
        stage: stage || null,
        lastHeartbeatAt: now
      }
    }).catch(() => {});
    lifecycle.registerPromise(writeTask, { label: 'build-state-heartbeat-write' });
  };
  const queueTick = () => {
    if (!active || lifecycle.isClosed()) return;
    lifecycle.registerPromise(tick(), { label: 'build-state-heartbeat-tick' });
  };
  queueTick();
  timer = setInterval(() => {
    queueTick();
  }, intervalMs);
  lifecycle.registerTimer(timer, { label: 'build-state-heartbeat-interval' });
  return stop;
}

export function createBuildCheckpoint({
  buildRoot,
  mode,
  totalFiles,
  batchSize = 1000,
  intervalMs = 120000
}) {
  if (!buildRoot || !mode) {
    return { tick() {}, finish() {} };
  }
  let processed = 0;
  let lastAt = 0;
  const flush = () => {
    const now = new Date().toISOString();
    void updateBuildState(buildRoot, {
      progress: {
        [mode]: {
          processedFiles: processed,
          totalFiles: Number.isFinite(totalFiles) ? totalFiles : null,
          updatedAt: now
        }
      }
    }).catch(() => {});
    lastAt = Date.now();
  };
  return {
    tick() {
      processed += 1;
      const now = Date.now();
      if (processed % batchSize === 0 || now - lastAt >= intervalMs) {
        flush();
      }
    },
    finish() {
      flush();
    }
  };
}

export function resolveBuildStatePath(buildRoot) {
  return buildRoot ? resolveStatePath(buildRoot) : null;
}
