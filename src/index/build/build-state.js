import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonObjectFile } from '../../shared/json-stream.js';

const STATE_FILE = 'build_state.json';

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
  return merged;
};

export async function initBuildState({
  buildRoot,
  buildId,
  repoRoot,
  modes,
  stage,
  configHash,
  toolVersion,
  repoProvenance
}) {
  if (!buildRoot) return null;
  const statePath = resolveStatePath(buildRoot);
  const now = new Date().toISOString();
  const payload = {
    buildId,
    repoRoot: repoRoot ? path.resolve(repoRoot) : null,
    createdAt: now,
    updatedAt: now,
    stage: stage || null,
    modes: Array.isArray(modes) ? modes : null,
    tool: {
      version: toolVersion || null,
      node: process.version
    },
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
  const statePath = resolveStatePath(buildRoot);
  let state = {};
  try {
    state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  } catch {}
  const now = new Date().toISOString();
  const merged = mergeState(state, { ...patch, updatedAt: now });
  try {
    await writeJsonObjectFile(statePath, { fields: merged, atomic: true });
  } catch {}
  return merged;
}

export async function markBuildPhase(buildRoot, phase, status, detail = null) {
  if (!buildRoot || !phase || !status) return null;
  const now = new Date().toISOString();
  let current = {};
  try {
    current = JSON.parse(await fs.readFile(resolveStatePath(buildRoot), 'utf8'));
  } catch {}
  const existing = current?.phases?.[phase] || {};
  const next = {
    ...existing,
    status,
    detail: detail || existing.detail || null,
    updatedAt: now
  };
  if (status === 'running' && !existing.startedAt) next.startedAt = now;
  if (status === 'done' || status === 'failed') next.finishedAt = now;
  return updateBuildState(buildRoot, {
    phase,
    phases: { [phase]: next }
  });
}

export function startBuildHeartbeat(buildRoot, stage, intervalMs = 30000) {
  if (!buildRoot) return () => {};
  const tick = () => {
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
