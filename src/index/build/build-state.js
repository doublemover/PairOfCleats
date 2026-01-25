import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonObjectFile } from '../../shared/json-stream.js';

const STATE_FILE = 'build_state.json';
const STATE_SCHEMA_VERSION = 1;
const HEARTBEAT_MIN_INTERVAL_MS = 5000;

const stateQueues = new Map();
const stateErrors = new Map();

const resolveStatePath = (buildRoot) => path.join(buildRoot, STATE_FILE);

const mergeState = (base, patch) => {
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
  if (patch.ignore) {
    merged.ignore = { ...(base?.ignore || {}), ...patch.ignore };
  }
  return merged;
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

const loadBuildState = async (buildRoot) => {
  const statePath = resolveStatePath(buildRoot);
  try {
    const parsed = JSON.parse(await fs.readFile(statePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return { state: parsed, loaded: true };
  } catch {
    return { state: null, loaded: false };
  }
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
  return enqueueStateUpdate(buildRoot, async () => {
    const statePath = resolveStatePath(buildRoot);
    const loadedState = await loadBuildState(buildRoot);
    let state = ensureStateVersions(loadedState?.state || {}, buildRoot, loadedState?.loaded);
    const now = new Date().toISOString();
    const merged = mergeState(state, { ...patch, updatedAt: now });
    if (!Number.isFinite(Number(merged.schemaVersion))) merged.schemaVersion = STATE_SCHEMA_VERSION;
    try {
      await writeJsonObjectFile(statePath, { fields: merged, atomic: true });
      return merged;
    } catch (err) {
      recordStateError(buildRoot, err);
      return null;
    }
  });
}

export async function markBuildPhase(buildRoot, phase, status, detail = null) {
  if (!buildRoot || !phase || !status) return null;
  return enqueueStateUpdate(buildRoot, async () => {
    const now = new Date().toISOString();
    const statePath = resolveStatePath(buildRoot);
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
    const merged = mergeState(current, {
      currentPhase: phase,
      phases: { [phase]: next },
      finishedAt,
      updatedAt: now
    });
    if (!Number.isFinite(Number(merged.schemaVersion))) merged.schemaVersion = STATE_SCHEMA_VERSION;
    try {
      await writeJsonObjectFile(statePath, { fields: merged, atomic: true });
      return merged;
    } catch (err) {
      recordStateError(buildRoot, err);
      return null;
    }
  });
}

export function startBuildHeartbeat(buildRoot, stage, intervalMs = 30000) {
  if (!buildRoot) return () => {};
  let lastWrite = 0;
  const tick = () => {
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
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
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
