import fsSync from 'node:fs';
import os from 'node:os';
import { fork } from 'node:child_process';
import { readIndexArtifactBytes } from '../../../src/shared/ops-resource-visibility.js';
import { killProcessTree } from '../../../src/shared/kill-tree.js';
import { getIndexDir, resolveSqlitePaths } from '../../../tools/shared/dict-utils.js';
import { attachSilentLogging } from '../../helpers/test-env.js';

export const DEFAULT_QUERY_WORKER_HEARTBEAT_MS = 5000;
export const DEFAULT_QUERY_WORKER_STALL_WARN_MS = 30000;
export const DEFAULT_QUERY_WORKER_STALL_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_QUERY_WORKER_SHUTDOWN_TIMEOUT_MS = 2000;
const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

const toFiniteNonNegative = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
};

const statSizeSync = (filePath) => {
  try {
    const stat = fsSync.statSync(filePath);
    return Number.isFinite(stat.size) ? stat.size : 0;
  } catch {
    return 0;
  }
};

const includesBackend = (backends, prefix) => (
  Array.isArray(backends) && backends.some((backend) => String(backend || '').startsWith(prefix))
);

/**
 * Estimate a safe query-worker count for bench searches. Memory-backed queries
 * duplicate large index caches per worker, so giant repos can appear hung while
 * four workers each load tens of GB of data.
 *
 * @param {{
 *   requestedConcurrency:number,
 *   backends:string[],
 *   runtimeRoot?:string,
 *   userConfig?:object,
 *   totalSystemMemoryBytes?:number,
 *   codeArtifactBytes?:number,
 *   proseArtifactBytes?:number,
 *   sqliteCodeBytes?:number,
 *   sqliteProseBytes?:number
 * }} input
 * @returns {Promise<{
 *   requestedConcurrency:number,
 *   effectiveConcurrency:number,
 *   reason:string,
 *   totalArtifactBytes:number,
 *   totalSqliteBytes:number,
 *   estimatedPerWorkerBytes:number,
 *   budgetBytes:number
 * }>}
 */
export const resolveAdaptiveQueryWorkerCount = async ({
  requestedConcurrency,
  backends,
  runtimeRoot = '',
  userConfig = null,
  totalSystemMemoryBytes = os.totalmem(),
  codeArtifactBytes = null,
  proseArtifactBytes = null,
  sqliteCodeBytes = null,
  sqliteProseBytes = null
} = {}) => {
  const requested = Math.max(1, Math.floor(Number(requestedConcurrency) || 1));
  const wantsMemory = Array.isArray(backends) && backends.includes('memory');
  const wantsSqlite = includesBackend(backends, 'sqlite');
  if (!wantsMemory && !wantsSqlite) {
    return {
      requestedConcurrency: requested,
      effectiveConcurrency: requested,
      reason: 'no_query_backends',
      totalArtifactBytes: 0,
      totalSqliteBytes: 0,
      estimatedPerWorkerBytes: 0,
      budgetBytes: 0
    };
  }

  const codeBytes = Number.isFinite(Number(codeArtifactBytes))
    ? Number(codeArtifactBytes)
    : (runtimeRoot ? await readIndexArtifactBytes(getIndexDir(runtimeRoot, 'code', userConfig) || '') : null);
  const proseBytes = Number.isFinite(Number(proseArtifactBytes))
    ? Number(proseArtifactBytes)
    : (runtimeRoot ? await readIndexArtifactBytes(getIndexDir(runtimeRoot, 'prose', userConfig) || '') : null);
  const sqlitePaths = runtimeRoot ? resolveSqlitePaths(runtimeRoot, userConfig) : null;
  const sqliteCode = Number.isFinite(Number(sqliteCodeBytes))
    ? Number(sqliteCodeBytes)
    : statSizeSync(sqlitePaths?.codePath);
  const sqliteProse = Number.isFinite(Number(sqliteProseBytes))
    ? Number(sqliteProseBytes)
    : statSizeSync(sqlitePaths?.prosePath);

  const totalArtifactBytes = toFiniteNonNegative(codeBytes) + toFiniteNonNegative(proseBytes);
  const totalSqliteBytes = toFiniteNonNegative(sqliteCode) + toFiniteNonNegative(sqliteProse);
  const estimatedMemoryBytes = wantsMemory ? Math.max(256 * MiB, Math.ceil(totalArtifactBytes * 2.5)) : 0;
  const estimatedSqliteBytes = wantsSqlite ? Math.max(128 * MiB, Math.ceil(totalSqliteBytes * 0.35)) : 0;
  const estimatedPerWorkerBytes = estimatedMemoryBytes + estimatedSqliteBytes;
  const budgetBytes = Math.max(512 * MiB, Math.floor(toFiniteNonNegative(totalSystemMemoryBytes) * 0.4));
  const budgetCap = estimatedPerWorkerBytes > 0
    ? Math.max(1, Math.floor(budgetBytes / estimatedPerWorkerBytes))
    : requested;

  let hardCap = requested;
  let reason = 'requested';
  if (wantsMemory && totalArtifactBytes >= 2 * GiB) {
    hardCap = 1;
    reason = 'memory_artifact_very_large';
  } else if (wantsMemory && totalArtifactBytes >= 512 * MiB) {
    hardCap = Math.min(hardCap, 2);
    reason = 'memory_artifact_large';
  } else if (estimatedPerWorkerBytes > 0 && budgetCap < requested) {
    reason = 'memory_budget';
  }

  const effectiveConcurrency = Math.max(1, Math.min(requested, hardCap, budgetCap));
  if (effectiveConcurrency === requested && reason === 'requested' && estimatedPerWorkerBytes > 0) {
    reason = 'within_budget';
  }
  return {
    requestedConcurrency: requested,
    effectiveConcurrency,
    reason,
    totalArtifactBytes,
    totalSqliteBytes,
    estimatedPerWorkerBytes,
    budgetBytes
  };
};

const createWorkerStallError = ({ label, workerLabel, id, elapsedMs }) => {
  const error = new Error(
    `Query worker ${workerLabel} stalled for ${Math.round(elapsedMs)}ms while running ${label} (request=${id}).`
  );
  error.code = 'ERR_QUERY_WORKER_STALLED';
  return error;
};

const createWorkerExitError = ({ label, workerLabel, code, signal }) => {
  const error = new Error(
    `Query worker ${workerLabel} exited early while running ${label} (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`
  );
  error.code = 'ERR_QUERY_WORKER_EXIT';
  return error;
};

/**
 * Create a forked worker wrapper with heartbeat-aware stall detection.
 *
 * @param {{
 *   label:string,
 *   env:NodeJS.ProcessEnv,
 *   workerScriptPath:string,
 *   onEvent?:(event:object)=>void,
 *   heartbeatMs?:number,
 *   stallWarnMs?:number,
 *   stallTimeoutMs?:number,
 *   shutdownTimeoutMs?:number,
 *   now?:()=>number
 * }} input
 * @returns {{run:(args:string[],meta?:object)=>Promise<any>,close:()=>Promise<void>}}
 */
const createSearchWorker = ({
  label,
  env,
  workerScriptPath,
  onEvent = null,
  heartbeatMs = DEFAULT_QUERY_WORKER_HEARTBEAT_MS,
  stallWarnMs = DEFAULT_QUERY_WORKER_STALL_WARN_MS,
  stallTimeoutMs = DEFAULT_QUERY_WORKER_STALL_TIMEOUT_MS,
  shutdownTimeoutMs = DEFAULT_QUERY_WORKER_SHUTDOWN_TIMEOUT_MS,
  now = () => Date.now()
}) => {
  let nextMessageId = 1;
  let child = null;
  let watchdog = null;
  const pending = new Map();

  const emitEvent = (event) => {
    if (typeof onEvent !== 'function') return;
    try {
      onEvent({ workerLabel: label, ...event });
    } catch {}
  };

  const clearWatchdog = () => {
    if (!watchdog) return;
    clearInterval(watchdog);
    watchdog = null;
  };

  const cleanupPending = (error) => {
    for (const [, entry] of pending) {
      entry.reject(error);
    }
    pending.clear();
  };

  const terminateChild = (targetChild, signal = 'SIGTERM') => {
    const pid = Number(targetChild?.pid);
    if (!Number.isFinite(pid)) return;
    void killProcessTree(pid, {
      signal,
      forceSignal: signal === 'SIGKILL' ? undefined : 'SIGKILL',
      graceMs: 250,
      killTree: true,
      detached: process.platform !== 'win32'
    }).catch(() => {});
  };

  const ensureChild = () => {
    if (child && child.exitCode == null && child.killed !== true) return child;
    child = fork(workerScriptPath, [], {
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    attachSilentLogging(child, label);
    child.on('message', (message) => {
      const id = Number(message?.id);
      if (message?.type === 'run-start') {
        const entry = pending.get(id);
        if (!entry) return;
        entry.startedAt = now();
        entry.lastHeartbeatAt = entry.startedAt;
        emitEvent({
          type: 'run-start',
          id,
          meta: entry.meta,
          elapsedMs: 0,
          pid: child.pid
        });
        return;
      }
      if (message?.type === 'run-heartbeat') {
        const entry = pending.get(id);
        if (!entry) return;
        entry.lastHeartbeatAt = now();
        emitEvent({
          type: 'run-heartbeat',
          id,
          meta: entry.meta,
          elapsedMs: toFiniteNonNegative(message.elapsedMs),
          rssBytes: toFiniteNonNegative(message.rssBytes),
          pid: child.pid
        });
        return;
      }
      if (message?.type === 'run-complete') {
        emitEvent({
          type: 'run-complete',
          id,
          elapsedMs: toFiniteNonNegative(message.elapsedMs),
          pid: child.pid
        });
        return;
      }
      if (!Number.isFinite(id) || !pending.has(id)) return;
      const entry = pending.get(id);
      pending.delete(id);
      if (message?.ok) {
        entry.resolve(message.payload || {});
        return;
      }
      const err = new Error(message?.error?.message || `Query worker ${label} failed`);
      err.code = message?.error?.code || 'ERR_QUERY_WORKER';
      entry.reject(err);
    });
    child.on('error', (err) => {
      cleanupPending(err instanceof Error ? err : new Error(String(err)));
    });
    child.on('exit', (code, signal) => {
      if (!pending.size) return;
      cleanupPending(createWorkerExitError({ label, workerLabel: label, code, signal }));
    });
    clearWatchdog();
    watchdog = setInterval(() => {
      if (!pending.size) return;
      const currentTs = now();
      for (const [id, entry] of pending.entries()) {
        const heartbeatAt = entry.lastHeartbeatAt || entry.startedAt || entry.sentAt;
        const elapsedMs = Math.max(0, currentTs - (entry.startedAt || entry.sentAt));
        const sinceHeartbeatMs = Math.max(0, currentTs - heartbeatAt);
        if (sinceHeartbeatMs >= stallWarnMs && currentTs - entry.lastWarnAt >= stallWarnMs) {
          entry.lastWarnAt = currentTs;
          emitEvent({
            type: 'stall-warning',
            id,
            meta: entry.meta,
            elapsedMs,
            sinceHeartbeatMs,
            pid: child?.pid || null
          });
        }
        if (stallTimeoutMs > 0 && sinceHeartbeatMs >= stallTimeoutMs) {
          const error = createWorkerStallError({ label, workerLabel: label, id, elapsedMs });
          emitEvent({
            type: 'stalled',
            id,
            meta: entry.meta,
            elapsedMs,
            sinceHeartbeatMs,
            pid: child?.pid || null
          });
          cleanupPending(error);
          terminateChild(child, 'SIGTERM');
          child = null;
          clearWatchdog();
          break;
        }
      }
    }, Math.max(250, Math.floor(heartbeatMs)));
    watchdog.unref?.();
    return child;
  };

  const run = (args, meta = null) => new Promise((resolve, reject) => {
    const activeChild = ensureChild();
    const id = nextMessageId;
    nextMessageId += 1;
    pending.set(id, {
      resolve,
      reject,
      meta,
      sentAt: now(),
      startedAt: null,
      lastHeartbeatAt: now(),
      lastWarnAt: 0
    });
    try {
      activeChild.send({ type: 'run', id, args, meta });
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });

  const close = async () => {
    clearWatchdog();
    const activeChild = child;
    child = null;
    if (!activeChild || activeChild.killed) return;
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      activeChild.once('exit', finish);
      try {
        activeChild.send({ type: 'shutdown' });
      } catch {
        finish();
      }
      const timeout = setTimeout(() => {
        terminateChild(activeChild, 'SIGTERM');
        finish();
      }, Math.max(250, Math.floor(shutdownTimeoutMs)));
      timeout.unref?.();
    });
  };

  return { run, close };
};

/**
 * Create a worker pool for bench search queries.
 *
 * @param {{
 *   size:number,
 *   env:NodeJS.ProcessEnv,
 *   workerScriptPath:string,
 *   onEvent?:(event:object)=>void,
 *   heartbeatMs?:number,
 *   stallWarnMs?:number,
 *   stallTimeoutMs?:number
 * }} input
 * @returns {{run:(args:string[],meta?:object)=>Promise<any>,close:()=>Promise<void>}}
 */
export const createSearchWorkerPool = ({
  size,
  env,
  workerScriptPath,
  onEvent = null,
  heartbeatMs = DEFAULT_QUERY_WORKER_HEARTBEAT_MS,
  stallWarnMs = DEFAULT_QUERY_WORKER_STALL_WARN_MS,
  stallTimeoutMs = DEFAULT_QUERY_WORKER_STALL_TIMEOUT_MS
}) => {
  const workerCount = Math.max(1, Math.floor(size) || 1);
  const workers = Array.from({ length: workerCount }, (_, index) => (
    createSearchWorker({
      label: `bench-worker:${index + 1}`,
      env,
      workerScriptPath,
      onEvent,
      heartbeatMs,
      stallWarnMs,
      stallTimeoutMs
    })
  ));
  let nextWorker = 0;
  const run = (args, meta = null) => {
    const worker = workers[nextWorker];
    nextWorker = (nextWorker + 1) % workers.length;
    return worker.run(args, meta);
  };
  const close = async () => {
    await Promise.all(workers.map((worker) => worker.close()));
  };
  return { run, close };
};
