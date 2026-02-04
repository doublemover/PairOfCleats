import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { writeJsonObjectFile } from '../../shared/json-stream.js';
import { sha1 } from '../../shared/hash.js';

const STATE_FILE = 'build_state.json';
const STATE_PROGRESS_FILE = 'build_state.progress.json';
const STATE_CHECKPOINTS_FILE = 'build_state.stage-checkpoints.json';
const STATE_EVENTS_FILE = 'build_state.events.jsonl';
const STATE_SCHEMA_VERSION = 1;
const HEARTBEAT_MIN_INTERVAL_MS = 5000;
const DEFAULT_DEBOUNCE_MS = 250;
const LONG_DEBOUNCE_MS = 500;
const EVENT_LOG_MAX_BYTES = 2 * 1024 * 1024;

const stateQueues = new Map();
const stateErrors = new Map();
const stateCaches = new Map();
const statePending = new Map();
const stateTimers = new Map();

const resolveStatePath = (buildRoot) => path.join(buildRoot, STATE_FILE);
const resolveProgressPath = (buildRoot) => path.join(buildRoot, STATE_PROGRESS_FILE);
const resolveCheckpointsPath = (buildRoot) => path.join(buildRoot, STATE_CHECKPOINTS_FILE);
const resolveEventsPath = (buildRoot) => path.join(buildRoot, STATE_EVENTS_FILE);

const resolveDebounceMs = (patch) => {
  if (!patch || typeof patch !== 'object') return DEFAULT_DEBOUNCE_MS;
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
      stageCheckpoints: null,
      checkpointsFingerprint: null,
      checkpointsHash: null,
      lastHash: null,
      lastComparableHash: null
    });
  }
  return stateCaches.get(key);
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
  // Surface the failure without crashing the build.
  console.warn(`[build_state] ${message}`);
};

const appendEventLog = async (buildRoot, events) => {
  if (!buildRoot || !events || !events.length) return;
  const filePath = resolveEventsPath(buildRoot);
  try {
    const stat = fsSync.existsSync(filePath) ? fsSync.statSync(filePath) : null;
    if (stat && stat.size >= EVENT_LOG_MAX_BYTES) {
      const rotated = `${filePath.replace(/\.jsonl$/, '')}.${Date.now()}.jsonl`;
      try { fsSync.renameSync(filePath, rotated); } catch {}
    }
    const lines = events.map((event) => JSON.stringify(event)).join('\n') + '\n';
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
  const filePath = type === 'progress'
    ? resolveProgressPath(buildRoot)
    : resolveCheckpointsPath(buildRoot);
  const fingerprint = await readFingerprint(filePath);
  if (type === 'progress') {
    if (fingerprintsMatch(fingerprint, cache.progressFingerprint) && cache.progress) {
      return cache.progress;
    }
    const parsed = fingerprint ? await readJsonFile(filePath) : null;
    cache.progress = parsed;
    cache.progressFingerprint = fingerprint;
    cache.progressHash = parsed ? hashJson(parsed) : null;
    return parsed;
  }
  if (fingerprintsMatch(fingerprint, cache.checkpointsFingerprint) && cache.stageCheckpoints) {
    return cache.stageCheckpoints;
  }
  const parsed = fingerprint ? await readJsonFile(filePath) : null;
  cache.stageCheckpoints = parsed;
  cache.checkpointsFingerprint = fingerprint;
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
  return {
    ...state,
    schemaVersion: schemaVersion ?? STATE_SCHEMA_VERSION,
    signatureVersion
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
    await writeJsonObjectFile(statePath, { fields: state, atomic: true });
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

const writeSidecarFile = async (buildRoot, type, payload, cache) => {
  if (!buildRoot || !payload) return null;
  const filePath = type === 'progress'
    ? resolveProgressPath(buildRoot)
    : resolveCheckpointsPath(buildRoot);
  const nextHash = hashJson(payload);
  const cachedHash = type === 'progress' ? cache.progressHash : cache.checkpointsHash;
  if (nextHash && cachedHash === nextHash) {
    if (type === 'progress') cache.progress = payload;
    if (type === 'checkpoints') cache.stageCheckpoints = payload;
    return payload;
  }
  try {
    await writeJsonObjectFile(filePath, { fields: payload, atomic: true });
    const fingerprint = await readFingerprint(filePath);
    if (type === 'progress') {
      cache.progress = payload;
      cache.progressFingerprint = fingerprint;
      cache.progressHash = nextHash;
    } else {
      cache.stageCheckpoints = payload;
      cache.checkpointsFingerprint = fingerprint;
      cache.checkpointsHash = nextHash;
    }
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
  if (checkpoints) writes.push(writeSidecarFile(buildRoot, 'checkpoints', nextCheckpoints, cache));

  let merged = state;
  if (main && Object.keys(main).length > 0) {
    merged = mergeState(state, main);
    merged = sanitizeMainState(ensureStateVersions(merged, buildRoot, false));
    const comparableHash = hashJson(stripUpdatedAt(merged));
    const shouldWrite = comparableHash && comparableHash !== cache.lastComparableHash;
    cache.lastComparableHash = comparableHash;
    if (shouldWrite) {
      merged.updatedAt = new Date().toISOString();
      writes.push(writeStateFile(buildRoot, merged, cache, { comparableHash }));
    } else {
      cache.state = merged;
    }
  }

  if (writes.length) {
    await Promise.all(writes);
  }
  if (events?.length) {
    await appendEventLog(buildRoot, events);
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
    if (!pending.patch && !pending.timer) statePending.delete(key);
    return result;
  } catch (err) {
    rejects.forEach((reject) => reject(err));
    recordStateError(buildRoot, err);
    if (!pending.patch && !pending.timer) statePending.delete(key);
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
  if (pending.timer) {
    clearTimeout(pending.timer);
    pending.timer = null;
  }
  if (flushNow) {
    void flushPendingState(buildRoot);
  } else {
    const delay = resolveDebounceMs(pending.patch);
    pending.timer = setTimeout(() => {
      pending.timer = null;
      void flushPendingState(buildRoot);
    }, delay);
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
  signatureVersion
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
    repo: repoProvenance || null,
    phases: {},
    progress: {}
  };
  await fs.mkdir(buildRoot, { recursive: true });
  await writeJsonObjectFile(statePath, { fields: payload, atomic: true });
  return statePath;
}

export async function updateBuildState(buildRoot, patch) {
  if (!buildRoot || !patch) return null;
  const events = collectCheckpointEvents(patch.stageCheckpoints);
  return queueStatePatch(buildRoot, patch, events);
}

export async function flushBuildState(buildRoot) {
  if (!buildRoot) return null;
  const key = path.resolve(buildRoot);
  const pending = statePending.get(key);
  if (pending?.timer) {
    clearTimeout(pending.timer);
    pending.timer = null;
  }
  return flushPendingState(buildRoot);
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
  let lastWrite = 0;
  let active = true;
  const stop = () => {
    active = false;
    clearInterval(timer);
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
    void updateBuildState(buildRoot, {
      heartbeat: {
        stage: stage || null,
        lastHeartbeatAt: now
      }
    }).catch(() => {});
  };
  void tick();
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
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
