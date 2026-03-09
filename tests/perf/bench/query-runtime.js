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
const DEFAULT_QUERY_WORKER_STDERR_TAIL_LINES = 40;
const DEFAULT_SQLITE_QUERY_MAX_RUNS_PER_WORKER = 1;
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

const classifyQueryBackend = (backend) => (
  String(backend || '').startsWith('sqlite') ? 'sqlite' : 'memory'
);

/**
 * Estimate a safe query-worker count for bench searches. Memory-backed queries
 * duplicate large index caches per worker, and SQLite searches benefit little
 * from wide parallelism against the same repo-local DBs.
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
 *   budgetBytes:number,
 *   backendConcurrency:Record<string, number>,
 *   backendMaxRunsPerWorker:Record<string, number>
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
      budgetBytes: 0,
      backendConcurrency: {},
      backendMaxRunsPerWorker: {}
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
  const estimatedSqliteBytes = wantsSqlite ? Math.max(256 * MiB, Math.ceil(totalSqliteBytes * 0.75)) : 0;
  const estimatedPerWorkerBytes = estimatedMemoryBytes + estimatedSqliteBytes;
  const budgetBytes = Math.max(512 * MiB, Math.floor(toFiniteNonNegative(totalSystemMemoryBytes) * 0.4));

  let reason = 'requested';
  const backendConcurrency = {};
  const backendMaxRunsPerWorker = {};
  let remainingBudget = budgetBytes;
  let remainingRequested = requested;

  if (wantsMemory) {
    const memoryTarget = Math.max(1, requested - (wantsSqlite ? 1 : 0));
    let memoryCap = memoryTarget;
    if (totalArtifactBytes >= 2 * GiB) {
      memoryCap = 1;
      reason = 'memory_artifact_very_large';
    } else if (totalArtifactBytes >= 512 * MiB) {
      memoryCap = Math.min(memoryCap, 2);
      reason = 'memory_artifact_large';
    }
    const memoryBudgetCap = estimatedMemoryBytes > 0
      ? Math.max(1, Math.floor(remainingBudget / estimatedMemoryBytes))
      : memoryCap;
    const memoryWorkers = Math.max(1, Math.min(memoryCap, remainingRequested, memoryBudgetCap));
    backendConcurrency.memory = memoryWorkers;
    backendMaxRunsPerWorker.memory = Number.POSITIVE_INFINITY;
    remainingBudget = Math.max(0, remainingBudget - (memoryWorkers * estimatedMemoryBytes));
    remainingRequested = Math.max(0, remainingRequested - memoryWorkers);
    if (memoryWorkers < memoryTarget && reason === 'requested') {
      reason = 'memory_budget';
    }
  }

  if (wantsSqlite) {
    const sqliteTarget = Math.max(1, wantsMemory ? 1 : Math.min(2, requested));
    let sqliteCap = sqliteTarget;
    if (wantsMemory) {
      sqliteCap = 1;
      if (reason === 'requested') reason = 'sqlite_mixed_serialized';
    } else if (totalSqliteBytes >= GiB) {
      sqliteCap = 1;
      if (reason === 'requested') reason = 'sqlite_db_very_large';
    }
    const sqliteBudgetCap = estimatedSqliteBytes > 0
      ? Math.max(1, Math.floor((remainingBudget || budgetBytes) / estimatedSqliteBytes))
      : sqliteCap;
    const sqliteWorkers = Math.max(1, Math.min(sqliteCap, Math.max(1, remainingRequested || sqliteCap), sqliteBudgetCap));
    backendConcurrency.sqlite = sqliteWorkers;
    backendMaxRunsPerWorker.sqlite = DEFAULT_SQLITE_QUERY_MAX_RUNS_PER_WORKER;
    remainingBudget = Math.max(0, remainingBudget - (sqliteWorkers * estimatedSqliteBytes));
    if (sqliteWorkers < sqliteTarget && reason === 'requested') {
      reason = 'sqlite_budget';
    }
  }

  const effectiveConcurrency = Math.max(
    1,
    Object.values(backendConcurrency).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0)
  );
  if (reason === 'requested' && estimatedPerWorkerBytes > 0) {
    reason = 'within_budget';
  }
  return {
    requestedConcurrency: requested,
    effectiveConcurrency,
    reason,
    totalArtifactBytes,
    totalSqliteBytes,
    estimatedPerWorkerBytes,
    budgetBytes,
    backendConcurrency,
    backendMaxRunsPerWorker
  };
};

const createWorkerStallError = ({ label, workerLabel, id, elapsedMs }) => {
  const error = new Error(
    `Query worker ${workerLabel} stalled for ${Math.round(elapsedMs)}ms while running ${label} (request=${id}).`
  );
  error.code = 'ERR_QUERY_WORKER_STALLED';
  return error;
};

const createWorkerExitError = ({
  label,
  workerLabel,
  code,
  signal,
  requestId = null,
  meta = null,
  elapsedMs = null,
  sinceHeartbeatMs = null,
  rssBytes = null,
  stderrTail = '',
  completedRuns = 0
}) => {
  const backend = meta?.backend ? ` backend=${meta.backend}` : '';
  const queryText = typeof meta?.query === 'string' && meta.query.trim()
    ? ` query="${meta.query.trim().slice(0, 80)}${meta.query.trim().length > 80 ? '...' : ''}"`
    : '';
  const elapsedText = Number.isFinite(Number(elapsedMs)) ? ` elapsedMs=${Math.floor(Number(elapsedMs))}` : '';
  const heartbeatText = Number.isFinite(Number(sinceHeartbeatMs))
    ? ` sinceHeartbeatMs=${Math.floor(Number(sinceHeartbeatMs))}`
    : '';
  const rssText = Number.isFinite(Number(rssBytes))
    ? ` rssMiB=${(Number(rssBytes) / MiB).toFixed(1)}`
    : '';
  const requestText = Number.isFinite(Number(requestId)) ? ` request=${Math.floor(Number(requestId))}` : '';
  const error = new Error(
    `Query worker ${workerLabel} exited early while running ${label} ` +
    `(code=${code ?? 'null'}, signal=${signal ?? 'null'}, completedRuns=${completedRuns}).` +
    `${requestText}${backend}${elapsedText}${heartbeatText}${rssText}${queryText}` +
    (stderrTail ? ` stderrTail=${stderrTail}` : '')
  );
  error.code = 'ERR_QUERY_WORKER_EXIT';
  error.meta = {
    workerLabel,
    label,
    code,
    signal,
    requestId,
    backend: meta?.backend || null,
    query: meta?.query || null,
    elapsedMs: Number.isFinite(Number(elapsedMs)) ? Math.floor(Number(elapsedMs)) : null,
    sinceHeartbeatMs: Number.isFinite(Number(sinceHeartbeatMs)) ? Math.floor(Number(sinceHeartbeatMs)) : null,
    rssBytes: Number.isFinite(Number(rssBytes)) ? Number(rssBytes) : null,
    completedRuns,
    stderrTail
  };
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
 *   maxRunsPerProcess?:number,
 *   stderrTailLines?:number,
 *   now?:()=>number
 * }} input
 * @returns {{run:(args:string[],meta?:object)=>Promise<any>,close:()=>Promise<void>,isBusy:()=>boolean,completedRuns:()=>number}}
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
  maxRunsPerProcess = Number.POSITIVE_INFINITY,
  stderrTailLines = DEFAULT_QUERY_WORKER_STDERR_TAIL_LINES,
  now = () => Date.now()
}) => {
  let nextMessageId = 1;
  let child = null;
  let watchdog = null;
  let activeRequest = null;
  let completedRuns = 0;
  let runsSinceChildStart = 0;
  let stderrLines = [];

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

  const appendStderr = (chunk) => {
    const text = String(chunk || '');
    if (!text) return;
    stderrLines.push(...text.split(/\r?\n/).filter(Boolean));
    if (stderrLines.length > stderrTailLines) {
      stderrLines = stderrLines.slice(-stderrTailLines);
    }
  };

  const getStderrTail = () => stderrLines.join(' | ');

  const closeChild = async (targetChild = child) => {
    if (!targetChild || targetChild.killed || targetChild.exitCode != null) return;
    if (child === targetChild) {
      child = null;
    }
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      targetChild.once('exit', finish);
      try {
        targetChild.send({ type: 'shutdown' });
      } catch {
        finish();
      }
      const timeout = setTimeout(() => {
        terminateChild(targetChild, 'SIGTERM');
        finish();
      }, Math.max(250, Math.floor(shutdownTimeoutMs)));
      timeout.unref?.();
    });
  };

  const ensureChild = () => {
    if (child && child.exitCode == null && child.killed !== true) return child;
    child = fork(workerScriptPath, [], {
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    stderrLines = [];
    runsSinceChildStart = 0;
    attachSilentLogging(child, label);
    child.stderr?.on('data', appendStderr);
    child.on('message', (message) => {
      const id = Number(message?.id);
      if (message?.type === 'run-start') {
        if (!activeRequest || activeRequest.id !== id) return;
        activeRequest.startedAt = now();
        activeRequest.lastHeartbeatAt = activeRequest.startedAt;
        emitEvent({
          type: 'run-start',
          id,
          meta: activeRequest.meta,
          elapsedMs: 0,
          pid: child.pid
        });
        return;
      }
      if (message?.type === 'run-heartbeat') {
        if (!activeRequest || activeRequest.id !== id) return;
        activeRequest.lastHeartbeatAt = now();
        activeRequest.lastRssBytes = toFiniteNonNegative(message.rssBytes);
        emitEvent({
          type: 'run-heartbeat',
          id,
          meta: activeRequest.meta,
          elapsedMs: toFiniteNonNegative(message.elapsedMs),
          rssBytes: activeRequest.lastRssBytes,
          pid: child.pid
        });
        return;
      }
      if (message?.type === 'run-complete') {
        if (!activeRequest || activeRequest.id !== id) return;
        emitEvent({
          type: 'run-complete',
          id,
          elapsedMs: toFiniteNonNegative(message.elapsedMs),
          pid: child.pid
        });
        return;
      }
      if (!Number.isFinite(id) || !activeRequest || activeRequest.id !== id) return;
      const request = activeRequest;
      activeRequest = null;
      if (message?.ok) {
        completedRuns += 1;
        runsSinceChildStart += 1;
        request.resolve(message.payload || {});
        return;
      }
      const err = new Error(message?.error?.message || `Query worker ${label} failed`);
      err.code = message?.error?.code || 'ERR_QUERY_WORKER';
      request.reject(err);
    });
    child.on('error', (err) => {
      if (!activeRequest) return;
      const request = activeRequest;
      activeRequest = null;
      request.reject(err instanceof Error ? err : new Error(String(err)));
    });
    child.on('exit', (code, signal) => {
      if (!activeRequest) return;
      const request = activeRequest;
      activeRequest = null;
      const elapsedMs = Number.isFinite(Number(request.startedAt))
        ? Math.max(0, now() - request.startedAt)
        : null;
      const sinceHeartbeatMs = Number.isFinite(Number(request.lastHeartbeatAt))
        ? Math.max(0, now() - request.lastHeartbeatAt)
        : null;
      request.reject(createWorkerExitError({
        label,
        workerLabel: label,
        code,
        signal,
        requestId: request.id,
        meta: request.meta,
        elapsedMs,
        sinceHeartbeatMs,
        rssBytes: request.lastRssBytes,
        stderrTail: getStderrTail(),
        completedRuns
      }));
    });
    clearWatchdog();
    watchdog = setInterval(() => {
      if (!activeRequest) return;
      const currentTs = now();
      const heartbeatAt = activeRequest.lastHeartbeatAt || activeRequest.startedAt || activeRequest.sentAt;
      const elapsedMs = Math.max(0, currentTs - (activeRequest.startedAt || activeRequest.sentAt));
      const sinceHeartbeatMs = Math.max(0, currentTs - heartbeatAt);
      if (sinceHeartbeatMs >= stallWarnMs && currentTs - activeRequest.lastWarnAt >= stallWarnMs) {
        activeRequest.lastWarnAt = currentTs;
        emitEvent({
          type: 'stall-warning',
          id: activeRequest.id,
          meta: activeRequest.meta,
          elapsedMs,
          sinceHeartbeatMs,
          rssBytes: activeRequest.lastRssBytes,
          pid: child?.pid || null
        });
      }
      if (stallTimeoutMs > 0 && sinceHeartbeatMs >= stallTimeoutMs) {
        const request = activeRequest;
        activeRequest = null;
        const error = createWorkerStallError({ label, workerLabel: label, id: request.id, elapsedMs });
        emitEvent({
          type: 'stalled',
          id: request.id,
          meta: request.meta,
          elapsedMs,
          sinceHeartbeatMs,
          rssBytes: request.lastRssBytes,
          pid: child?.pid || null
        });
        request.reject(error);
        terminateChild(child, 'SIGTERM');
        child = null;
        clearWatchdog();
      }
    }, Math.max(250, Math.floor(heartbeatMs)));
    watchdog.unref?.();
    return child;
  };

  const run = async (args, meta = null) => {
    if (activeRequest) {
      const err = new Error(`Query worker ${label} received concurrent work while busy.`);
      err.code = 'ERR_QUERY_WORKER_BUSY';
      throw err;
    }
    const activeChild = ensureChild();
    const id = nextMessageId;
    nextMessageId += 1;
    const payload = await new Promise((resolve, reject) => {
      activeRequest = {
        id,
        resolve,
        reject,
        meta,
        args,
        sentAt: now(),
        startedAt: null,
        lastHeartbeatAt: now(),
        lastWarnAt: 0,
        lastRssBytes: null
      };
      try {
        activeChild.send({ type: 'run', id, args, meta });
      } catch (error) {
        activeRequest = null;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    if (runsSinceChildStart >= maxRunsPerProcess) {
      await closeChild(activeChild);
    }
    return payload;
  };

  const close = async () => {
    clearWatchdog();
    await closeChild(child);
  };

  return {
    run,
    close,
    isBusy: () => Boolean(activeRequest),
    completedRuns: () => completedRuns
  };
};

/**
 * Create a worker pool for bench search queries.
 *
 * @param {{
 *   size:number,
 *   maxRunsPerProcess?:number,
 *   sizeByBackend?:Record<string, number>|null,
 *   maxRunsPerWorkerByBackend?:Record<string, number>|null,
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
  maxRunsPerProcess = Number.POSITIVE_INFINITY,
  sizeByBackend = null,
  maxRunsPerWorkerByBackend = null,
  env,
  workerScriptPath,
  onEvent = null,
  heartbeatMs = DEFAULT_QUERY_WORKER_HEARTBEAT_MS,
  stallWarnMs = DEFAULT_QUERY_WORKER_STALL_WARN_MS,
  stallTimeoutMs = DEFAULT_QUERY_WORKER_STALL_TIMEOUT_MS
}) => {
  const normalizedSizeByBackend = sizeByBackend && typeof sizeByBackend === 'object'
    ? Object.fromEntries(
      Object.entries(sizeByBackend)
        .map(([key, value]) => [String(key), Math.max(0, Math.floor(Number(value) || 0))])
        .filter(([, value]) => value > 0)
    )
    : null;
  const backendEntries = normalizedSizeByBackend
    ? Object.entries(normalizedSizeByBackend)
    : [['default', Math.max(1, Math.floor(size) || 1)]];
  const workerGroups = Object.fromEntries(
    backendEntries.map(([backendKey, workerCount]) => [
      backendKey,
      Array.from({ length: workerCount }, (_, index) => (
        createSearchWorker({
          label: `bench-worker:${backendKey}:${index + 1}`,
          env,
          workerScriptPath,
          onEvent,
          heartbeatMs,
          stallWarnMs,
          stallTimeoutMs,
          maxRunsPerProcess: Number.isFinite(Number(maxRunsPerWorkerByBackend?.[backendKey]))
            ? Math.max(1, Math.floor(Number(maxRunsPerWorkerByBackend[backendKey])))
            : (Number.isFinite(Number(maxRunsPerProcess))
              ? Math.max(1, Math.floor(Number(maxRunsPerProcess)))
              : Number.POSITIVE_INFINITY)
        })
      ))
    ])
  );
  const queue = [];
  let pumping = false;

  const resolveGroupKey = (meta = null) => {
    if (!normalizedSizeByBackend) return 'default';
    const preferredKey = classifyQueryBackend(meta?.backend);
    if (workerGroups[preferredKey]?.length) return preferredKey;
    return Object.keys(workerGroups)[0];
  };

  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length) {
        let dispatched = false;
        for (let index = 0; index < queue.length; index += 1) {
          const request = queue[index];
          const groupKey = resolveGroupKey(request.meta);
          const workers = workerGroups[groupKey] || [];
          const worker = workers.find((candidate) => !candidate.isBusy());
          if (!worker) continue;
          queue.splice(index, 1);
          dispatched = true;
          void worker.run(request.args, request.meta)
            .then(request.resolve, request.reject)
            .finally(() => {
              void pump();
            });
          break;
        }
        if (!dispatched) break;
      }
    } finally {
      pumping = false;
    }
  };

  const run = (args, meta = null) => new Promise((resolve, reject) => {
    queue.push({ args, meta, resolve, reject });
    void pump();
  });

  const close = async () => {
    const allWorkers = Object.values(workerGroups).flat();
    await Promise.all(allWorkers.map((worker) => worker.close()));
  };
  return { run, close };
};
