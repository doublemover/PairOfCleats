import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireFileLock } from '../../src/shared/locks/file-lock.js';
import { atomicWriteJson } from '../../src/shared/io/atomic-write.js';

const DEFAULT_LOCK_STALE_MS = 30 * 60 * 1000;
const VALID_SHUTDOWN_MODES = new Set(['running', 'stop-accepting', 'drain', 'cancel', 'force-stop']);

const normalizeQueueName = (value) => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw || raw === 'index') return null;
  return raw.replace(/[^a-z0-9_-]+/g, '-');
};

const normalizeIsoTimestamp = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
};

const normalizeTimeoutMs = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(250, Math.trunc(parsed));
};

const resolveMode = (value, fallback = 'running') => {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return VALID_SHUTDOWN_MODES.has(mode) ? mode : fallback;
};

const resolveModeFlags = (mode) => {
  if (mode === 'stop-accepting') {
    return { accepting: false, stopClaiming: false, forceAbort: false };
  }
  if (mode === 'drain') {
    return { accepting: false, stopClaiming: false, forceAbort: false };
  }
  if (mode === 'cancel') {
    return { accepting: false, stopClaiming: true, forceAbort: true };
  }
  if (mode === 'force-stop') {
    return { accepting: false, stopClaiming: true, forceAbort: true };
  }
  return { accepting: true, stopClaiming: false, forceAbort: false };
};

const readJson = async (filePath, fallback) => {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const withControlLock = async (lockPath, worker) => {
  const lock = await acquireFileLock({
    lockPath,
    waitMs: 5000,
    pollMs: 100,
    staleMs: DEFAULT_LOCK_STALE_MS,
    metadata: { scope: 'service-shutdown-state' },
    timeoutBehavior: 'throw',
    timeoutMessage: 'Shutdown state lock timeout.'
  });
  if (!lock) {
    throw new Error('Shutdown state lock timeout.');
  }
  try {
    return await worker();
  } finally {
    await lock.release();
  }
};

const buildDefaultWorkerState = () => ({
  pid: null,
  ownerId: null,
  status: 'idle',
  activeJobs: [],
  lastSeenAt: null,
  lastExitAt: null,
  lastExitReason: null
});

export function getServiceShutdownPaths(dirPath, queueName = null) {
  const normalized = normalizeQueueName(queueName);
  const suffix = normalized ? `-${normalized}` : '';
  return {
    statePath: path.join(dirPath, `service-state${suffix}.json`),
    lockPath: path.join(dirPath, `service-state${suffix}.lock`)
  };
}

export function normalizeServiceShutdownState(state = {}, queueName = null) {
  const mode = resolveMode(state?.mode, 'running');
  const flags = resolveModeFlags(mode);
  const worker = state?.worker && typeof state.worker === 'object'
    ? state.worker
    : {};
  return {
    queueName: queueName || state?.queueName || 'index',
    mode,
    accepting: flags.accepting,
    stopClaiming: flags.stopClaiming,
    forceAbort: flags.forceAbort,
    requestId: typeof state?.requestId === 'string' && state.requestId.trim()
      ? state.requestId.trim()
      : null,
    requestedAt: normalizeIsoTimestamp(state?.requestedAt || null),
    updatedAt: normalizeIsoTimestamp(state?.updatedAt || null) || new Date().toISOString(),
    deadlineAt: normalizeIsoTimestamp(state?.deadlineAt || null),
    timeoutMs: normalizeTimeoutMs(state?.timeoutMs),
    requestedBy: typeof state?.requestedBy === 'string' && state.requestedBy.trim()
      ? state.requestedBy.trim()
      : null,
    source: typeof state?.source === 'string' && state.source.trim()
      ? state.source.trim()
      : null,
    completion: {
      completedAt: normalizeIsoTimestamp(state?.completion?.completedAt || null),
      reason: typeof state?.completion?.reason === 'string' && state.completion.reason.trim()
        ? state.completion.reason.trim()
        : null
    },
    worker: {
      ...buildDefaultWorkerState(),
      ...(worker && typeof worker === 'object' ? worker : {}),
      activeJobs: Array.isArray(worker?.activeJobs)
        ? worker.activeJobs
          .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
          .filter(Boolean)
        : [],
      lastSeenAt: normalizeIsoTimestamp(worker?.lastSeenAt || null),
      lastExitAt: normalizeIsoTimestamp(worker?.lastExitAt || null)
    }
  };
}

export async function loadServiceShutdownState(dirPath, queueName = null) {
  const resolvedQueueName = queueName || 'index';
  const { statePath } = getServiceShutdownPaths(dirPath, resolvedQueueName);
  const payload = await readJson(statePath, {});
  return normalizeServiceShutdownState(payload, resolvedQueueName);
}

export async function saveServiceShutdownState(dirPath, state, queueName = null) {
  const resolvedQueueName = queueName || state?.queueName || 'index';
  const normalized = normalizeServiceShutdownState(state, resolvedQueueName);
  const { statePath } = getServiceShutdownPaths(dirPath, resolvedQueueName);
  await atomicWriteJson(statePath, normalized, { spaces: 2 });
  return normalized;
}

export async function requestServiceShutdown(dirPath, queueName = null, {
  mode = 'drain',
  timeoutMs = null,
  requestedBy = null,
  source = 'operator'
} = {}) {
  const resolvedQueueName = queueName || 'index';
  const normalizedMode = resolveMode(mode, 'drain');
  const normalizedTimeoutMs = normalizeTimeoutMs(timeoutMs);
  const requestedAt = new Date().toISOString();
  const deadlineAt = normalizedTimeoutMs != null
    ? new Date(Date.parse(requestedAt) + normalizedTimeoutMs).toISOString()
    : null;
  const { lockPath } = getServiceShutdownPaths(dirPath, resolvedQueueName);
  return await withControlLock(lockPath, async () => {
    const previous = await loadServiceShutdownState(dirPath, resolvedQueueName);
    return await saveServiceShutdownState(dirPath, {
      ...previous,
      queueName: resolvedQueueName,
      mode: normalizedMode,
      requestId: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      requestedAt,
      updatedAt: requestedAt,
      deadlineAt,
      timeoutMs: normalizedTimeoutMs,
      requestedBy: requestedBy || previous.requestedBy || null,
      source,
      completion: {
        completedAt: null,
        reason: null
      }
    }, resolvedQueueName);
  });
}

export async function resumeServiceShutdown(dirPath, queueName = null, {
  requestedBy = null,
  source = 'operator'
} = {}) {
  const resolvedQueueName = queueName || 'index';
  const { lockPath } = getServiceShutdownPaths(dirPath, resolvedQueueName);
  return await withControlLock(lockPath, async () => {
    const previous = await loadServiceShutdownState(dirPath, resolvedQueueName);
    const resumedAt = new Date().toISOString();
    return await saveServiceShutdownState(dirPath, {
      ...previous,
      queueName: resolvedQueueName,
      mode: 'running',
      requestId: null,
      requestedAt: null,
      updatedAt: resumedAt,
      deadlineAt: null,
      timeoutMs: null,
      requestedBy: requestedBy || previous.requestedBy || null,
      source,
      completion: {
        completedAt: resumedAt,
        reason: 'resumed'
      }
    }, resolvedQueueName);
  });
}

export async function updateServiceShutdownWorker(dirPath, queueName = null, patch = {}) {
  const resolvedQueueName = queueName || 'index';
  const { lockPath } = getServiceShutdownPaths(dirPath, resolvedQueueName);
  return await withControlLock(lockPath, async () => {
    const previous = await loadServiceShutdownState(dirPath, resolvedQueueName);
    const workerPatch = patch && typeof patch === 'object' ? patch : {};
    return await saveServiceShutdownState(dirPath, {
      ...previous,
      updatedAt: new Date().toISOString(),
      worker: {
        ...previous.worker,
        ...workerPatch,
        activeJobs: Array.isArray(workerPatch.activeJobs)
          ? workerPatch.activeJobs
          : previous.worker.activeJobs
      }
    }, resolvedQueueName);
  });
}

export async function completeServiceShutdown(dirPath, queueName = null, {
  reason = null
} = {}) {
  const resolvedQueueName = queueName || 'index';
  const { lockPath } = getServiceShutdownPaths(dirPath, resolvedQueueName);
  return await withControlLock(lockPath, async () => {
    const previous = await loadServiceShutdownState(dirPath, resolvedQueueName);
    const completedAt = new Date().toISOString();
    return await saveServiceShutdownState(dirPath, {
      ...previous,
      updatedAt: completedAt,
      completion: {
        completedAt,
        reason: typeof reason === 'string' && reason.trim() ? reason.trim() : previous.completion?.reason || null
      },
      worker: {
        ...previous.worker,
        status: 'stopped',
        activeJobs: [],
        lastSeenAt: completedAt,
        lastExitAt: completedAt,
        lastExitReason: typeof reason === 'string' && reason.trim()
          ? reason.trim()
          : previous.worker?.lastExitReason || null
      }
    }, resolvedQueueName);
  });
}
