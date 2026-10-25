import fsSync from 'node:fs';
import os from 'node:os';
import { fork } from 'node:child_process';
import { readIndexArtifactBytes } from '../../../src/shared/ops/resource-visibility.js';
import { killProcessTree } from '../../../src/shared/kill-tree.js';
import { getIndexDir, resolveSqlitePaths } from '../../../tools/shared/dict-utils.js';
import { attachSilentLogging } from '../../helpers/test-env.js';
import { resolveBenchQueryByteEstimate } from '../../../tools/bench/language/query-byte-estimate.js';
import { isSqliteBackend } from '../../../tools/bench/language/query-backends.js';

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

const hasPositiveTimestamp = value => Number.isFinite(Number(value)) && Number(value) > 0;
export const classifyQueryBackend = backend => isSqliteBackend(backend) ? 'sqlite'
  : String(backend || '').trim().toLowerCase() === 'memory' ? 'memory' : null;

/** One global allowance for all selected query pools. Backend spellings retain
 * their workload identity while sharing a canonical process resource class.
 * Stages close completely before the next stage allocates workers. Estimates
 * constrain admission; they are not a guarantee about actual process RSS. */
export const resolveAdaptiveQueryWorkerCount = async ({
  requestedConcurrency, backends = [], runtimeRoot = '', userConfig = null,
  totalSystemMemoryBytes = os.totalmem(), codeArtifactBytes = null,
  proseArtifactBytes = null, sqliteCodeBytes = null, sqliteProseBytes = null
} = {}) => {
  const requested = Math.max(1, Math.floor(Number(requestedConcurrency) || 1));
  const selected = [...new Set(backends.map(backend => String(backend).trim().toLowerCase()))];
  const classes = [...new Set(selected.map(classifyQueryBackend))];
  if (classes.includes(null)) throw new RangeError('Unsupported benchmark query backend resource class.');
  const wantsMemory = classes.includes('memory'), wantsSqlite = classes.includes('sqlite');
  const codeBytes = wantsMemory ? await resolveBenchQueryByteEstimate(codeArtifactBytes,
    () => runtimeRoot ? readIndexArtifactBytes(getIndexDir(runtimeRoot, 'code', userConfig) || '') : null) : 0;
  const proseBytes = wantsMemory ? await resolveBenchQueryByteEstimate(proseArtifactBytes,
    () => runtimeRoot ? readIndexArtifactBytes(getIndexDir(runtimeRoot, 'prose', userConfig) || '') : null) : 0;
  const sqlitePaths = wantsSqlite && runtimeRoot ? resolveSqlitePaths(runtimeRoot, userConfig) : null;
  const sqliteCode = wantsSqlite ? await resolveBenchQueryByteEstimate(sqliteCodeBytes, () => statSizeSync(sqlitePaths?.codePath)) : 0;
  const sqliteProse = wantsSqlite ? await resolveBenchQueryByteEstimate(sqliteProseBytes, () => statSizeSync(sqlitePaths?.prosePath)) : 0;
  const totalArtifactBytes = toFiniteNonNegative(codeBytes) + toFiniteNonNegative(proseBytes);
  const totalSqliteBytes = toFiniteNonNegative(sqliteCode) + toFiniteNonNegative(sqliteProse);
  const estimates = { memory: Math.max(256 * MiB, Math.ceil(totalArtifactBytes * 2.5)),
    sqlite: Math.max(256 * MiB, Math.ceil(totalSqliteBytes * 0.75)) };
  const budgetBytes = Math.max(512 * MiB, Math.floor(toFiniteNonNegative(totalSystemMemoryBytes) * 0.4));
  const caps = { memory: totalArtifactBytes >= 2 * GiB ? 1 : totalArtifactBytes >= 512 * MiB ? 2 : requested, sqlite: 1 };
  const oversize = classes.filter(key => estimates[key] > budgetBytes);
  const simultaneousMinimum = classes.reduce((sum, key) => sum + estimates[key], 0);
  const staged = classes.length > requested || simultaneousMinimum > budgetBytes;
  const stageClasses = oversize.length ? [] : staged ? classes.map(key => [key]) : classes.length ? [classes] : [];
  const stages = stageClasses.map((members, index) => {
    const sizeByBackend = Object.fromEntries(members.map(key => [key, 1]));
    let bytes = members.reduce((sum, key) => sum + estimates[key], 0), count = members.length;
    for (const key of members) {
      const extra = Math.max(0, Math.min(caps[key] - 1, requested - count, Math.floor((budgetBytes - bytes) / estimates[key])));
      sizeByBackend[key] += extra; count += extra; bytes += extra * estimates[key];
    }
    return { id: index + 1, backends: selected.filter(backend => members.includes(classifyQueryBackend(backend))),
      sizeByBackend, effectiveConcurrency: count, estimatedConcurrentBytes: bytes };
  });
  const backendConcurrency = Object.assign({}, ...stages.map(stage => stage.sizeByBackend));
  const reason = oversize.length ? 'required_worker_exceeds_memory_estimate_budget'
    : !classes.length ? 'no_query_backends' : staged ? (classes.length > requested ? 'global_concurrency_staged' : 'shared_memory_budget_staged')
      : wantsMemory && totalArtifactBytes >= 2 * GiB ? 'memory_artifact_very_large'
        : wantsMemory && totalArtifactBytes >= 512 * MiB ? 'memory_artifact_large' : 'within_shared_budget';
  return { schemaVersion: 1, kind: 'bench-query-resource-plan', status: oversize.length ? 'unsupported' : 'admitted',
    concurrencyScope: 'global', requestedConcurrency: requested,
    effectiveConcurrency: Math.max(0, ...stages.map(stage => stage.effectiveConcurrency)), reason,
    totalArtifactBytes, totalSqliteBytes, estimatedPerWorkerBytes: Math.max(0, ...classes.map(key => estimates[key])),
    estimatedPerWorkerBytesByClass: Object.fromEntries(classes.map(key => [key, estimates[key]])),
    estimatedPeakConcurrentBytes: Math.max(0, ...stages.map(stage => stage.estimatedConcurrentBytes)), budgetBytes,
    estimateKind: 'artifact-size-heuristic', observedRssGuarantee: false, oversizeClasses: oversize,
    resourceClassByBackend: Object.fromEntries(selected.map(backend => [backend, classifyQueryBackend(backend)])),
    isolation: 'one-process-per-worker; SQLite aliases share a serialized resource class',
    stages, backendConcurrency,
    backendMaxRunsPerWorker: Object.fromEntries(classes.map(key => [key, key === 'sqlite' ? DEFAULT_SQLITE_QUERY_MAX_RUNS_PER_WORKER : 0])),
    retirementByClass: Object.fromEntries(classes.map(key => [key, key === 'sqlite'
      ? { policy: 'retire-after-each-query', maxRunsPerProcess: 1 } : { policy: 'reuse-within-stage', maxRunsPerProcess: null }])) };
};

const createWorkerStallError = ({ label, workerLabel, id, elapsedMs }) => {
  const error = new Error(
    `Query worker ${workerLabel} stalled for ${Math.round(elapsedMs)}ms while running ${label} (request=${id}).`
  );
  error.code = 'ERR_QUERY_WORKER_STALLED';
  return error;
};

const createWorkerClosedError = ({ label, workerLabel, requestId = null, meta = null }) => {
  const backend = meta?.backend ? ` backend=${meta.backend}` : '';
  const queryText = typeof meta?.query === 'string' && meta.query.trim()
    ? ` query="${meta.query.trim().slice(0, 80)}${meta.query.trim().length > 80 ? '...' : ''}"`
    : '';
  const requestText = Number.isFinite(Number(requestId)) ? ` request=${Math.floor(Number(requestId))}` : '';
  const error = new Error(
    `Query worker ${workerLabel} closed before completing ${label}.${requestText}${backend}${queryText}`
  );
  error.code = 'ERR_QUERY_WORKER_CLOSED';
  error.meta = {
    workerLabel,
    label,
    requestId: Number.isFinite(Number(requestId)) ? Math.floor(Number(requestId)) : null,
    backend: meta?.backend || null,
    query: meta?.query || null
  };
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

const resolveRequestElapsedMs = (request, nowTs) => {
  if (hasPositiveTimestamp(request?.startedAt)) {
    return Math.max(0, nowTs - Number(request.startedAt));
  }
  if (hasPositiveTimestamp(request?.sentAt)) {
    return Math.max(0, nowTs - Number(request.sentAt));
  }
  return null;
};

const resolveSinceHeartbeatMs = (request, nowTs) => {
  if (hasPositiveTimestamp(request?.lastHeartbeatAt)) {
    return Math.max(0, nowTs - Number(request.lastHeartbeatAt));
  }
  if (hasPositiveTimestamp(request?.startedAt)) {
    return Math.max(0, nowTs - Number(request.startedAt));
  }
  if (hasPositiveTimestamp(request?.sentAt)) {
    return Math.max(0, nowTs - Number(request.sentAt));
  }
  return null;
};

const normalizeMaxRunsPerProcess = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Number.POSITIVE_INFINITY;
  const normalized = Math.floor(numeric);
  return normalized > 0 ? normalized : Number.POSITIVE_INFINITY;
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
  const normalizedMaxRunsPerProcess = normalizeMaxRunsPerProcess(maxRunsPerProcess);
  let nextMessageId = 1;
  let nextGeneration = 1;
  let currentSession = null;
  let watchdog = null;
  let activeRequest = null;
  let running = false;
  let completedRuns = 0;
  let closed = false;

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
    if (!Number.isFinite(pid)) return Promise.resolve();
    return killProcessTree(pid, {
      killSignal: signal,
      graceMs: 250,
      killTree: true,
      detached: process.platform !== 'win32'
    }).catch(() => {});
  };

  const appendStderr = (session, chunk) => {
    const text = String(chunk || '');
    if (!text) return;
    session.stderrLines.push(...text.split(/\r?\n/).filter(Boolean));
    if (session.stderrLines.length > stderrTailLines) {
      session.stderrLines = session.stderrLines.slice(-stderrTailLines);
    }
  };

  const getStderrTail = (session) => session?.stderrLines?.join(' | ') || '';

  const ownsActiveRequest = (session, id) => (
    Number.isFinite(Number(id)) &&
    Boolean(activeRequest) &&
    activeRequest.id === Number(id) &&
    activeRequest.ownerGeneration === session.generation
  );

  const clearActiveRequest = (session, id) => {
    if (!ownsActiveRequest(session, id)) return null;
    const request = activeRequest;
    activeRequest = null;
    return request;
  };

  const createWorkerSession = () => {
    const spawnedChild = fork(workerScriptPath, [], {
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    const session = {
      generation: nextGeneration,
      child: spawnedChild,
      closed: new Promise(resolve => spawnedChild.once('close', resolve)),
      pid: Number(spawnedChild?.pid) || null,
      runsSinceStart: 0,
      stderrLines: []
    };
    nextGeneration += 1;
    currentSession = session;
    attachSilentLogging(spawnedChild, label);
    spawnedChild.stderr?.on('data', (chunk) => appendStderr(session, chunk));
    spawnedChild.on('message', (message) => {
      const id = Number(message?.id);
      if (message?.type === 'run-start') {
        if (!ownsActiveRequest(session, id)) return;
        activeRequest.startedAt = now();
        activeRequest.lastHeartbeatAt = activeRequest.startedAt;
        emitEvent({
          type: 'run-start',
          id,
          meta: activeRequest.meta,
          elapsedMs: 0,
          rssBytes: Number.isFinite(message.rssBytes) ? message.rssBytes : null,
          pid: session.pid
        });
        return;
      }
      if (message?.type === 'run-heartbeat') {
        if (!ownsActiveRequest(session, id)) return;
        activeRequest.lastHeartbeatAt = now();
        activeRequest.lastRssBytes = toFiniteNonNegative(message.rssBytes);
        emitEvent({
          type: 'run-heartbeat',
          id,
          meta: activeRequest.meta,
          elapsedMs: toFiniteNonNegative(message.elapsedMs),
          rssBytes: activeRequest.lastRssBytes,
          pid: session.pid
        });
        return;
      }
      if (message?.type === 'run-complete') {
        if (!ownsActiveRequest(session, id)) return;
        activeRequest.lastHeartbeatAt = now();
        emitEvent({
          type: 'run-complete',
          id,
          meta: activeRequest.meta,
          rssBytes: Number.isFinite(message.rssBytes) ? message.rssBytes : null,
          elapsedMs: toFiniteNonNegative(message.elapsedMs),
          pid: session.pid
        });
        return;
      }
      if (!Number.isFinite(id)) return;
      const request = clearActiveRequest(session, id);
      if (!request) return;
      if (message?.ok) {
        completedRuns += 1;
        session.runsSinceStart += 1;
        request.resolve(message.payload || {});
        return;
      }
      const err = new Error(message?.error?.message || `Query worker ${label} failed`);
      err.code = message?.error?.code || 'ERR_QUERY_WORKER';
      request.reject(err);
    });
    spawnedChild.on('error', (err) => {
      const request = activeRequest?.ownerGeneration === session.generation ? activeRequest : null;
      if (!request) return;
      activeRequest = null;
      request.reject(err instanceof Error ? err : new Error(String(err)));
    });
    spawnedChild.on('exit', (code, signal) => {
      if (currentSession === session) {
        currentSession = null;
      }
      const request = activeRequest?.ownerGeneration === session.generation ? activeRequest : null;
      if (!request) return;
      activeRequest = null;
      const nowTs = now();
      const elapsedMs = resolveRequestElapsedMs(request, nowTs);
      const sinceHeartbeatMs = resolveSinceHeartbeatMs(request, nowTs);
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
        stderrTail: getStderrTail(session),
        completedRuns
      }));
    });
    spawnedChild.once('close', () => emitEvent({ type: 'process-close', pid: session.pid }));
    emitEvent({ type: 'process-start', pid: session.pid });
    return session;
  };

  const closeChild = async (targetSession = currentSession, { cancelActiveRequest = false } = {}) => {
    const targetChild = targetSession?.child;
    if (!targetChild) return;
    if (currentSession === targetSession) {
      currentSession = null;
    }
    if (
      cancelActiveRequest === true &&
      activeRequest?.ownerGeneration === targetSession?.generation
    ) {
      const request = activeRequest;
      activeRequest = null;
      request.reject(createWorkerClosedError({
        label,
        workerLabel: label,
        requestId: request.id,
        meta: request.meta
      }));
    }
    let timeout;
    try {
      const graceful = new Promise(resolve => {
        timeout = setTimeout(() => resolve(false), Math.max(250, Math.floor(shutdownTimeoutMs)));
      });
      if (targetChild.connected) {
        targetChild.send({ type: 'shutdown' }, () => {});
      }
      const closedGracefully = await Promise.race([targetSession.closed.then(() => true), graceful]);
      if (!closedGracefully) await terminateChild(targetChild, 'SIGTERM');
      await targetSession.closed;
    } finally {
      clearTimeout(timeout);
    }
  };

  const ensureChild = () => {
    if (closed) {
      const err = new Error(`Query worker ${label} is closed.`);
      err.code = 'ERR_QUERY_WORKER_CLOSED';
      throw err;
    }
    if (
      currentSession &&
      currentSession.child?.exitCode == null &&
      currentSession.child?.killed !== true
    ) {
      return currentSession;
    }
    const session = createWorkerSession();
    clearWatchdog();
    watchdog = setInterval(() => {
      if (!activeRequest) return;
      const currentTs = now();
      const elapsedMs = resolveRequestElapsedMs(activeRequest, currentTs);
      const sinceHeartbeatMs = resolveSinceHeartbeatMs(activeRequest, currentTs);
      if (sinceHeartbeatMs >= stallWarnMs && currentTs - activeRequest.lastWarnAt >= stallWarnMs) {
        activeRequest.lastWarnAt = currentTs;
        emitEvent({
          type: 'stall-warning',
          id: activeRequest.id,
          meta: activeRequest.meta,
          elapsedMs,
          sinceHeartbeatMs,
          rssBytes: activeRequest.lastRssBytes,
          pid: activeRequest.ownerPid
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
          pid: request.ownerPid
        });
        request.reject(error);
        if (currentSession?.generation === request.ownerGeneration) {
          currentSession = null;
        }
        terminateChild(request.ownerSession?.child, 'SIGTERM');
        clearWatchdog();
      }
    }, Math.max(250, Math.floor(heartbeatMs)));
    watchdog.unref?.();
    return session;
  };

  const run = async (args, meta = null) => {
    if (closed) {
      throw createWorkerClosedError({ label, workerLabel: label, meta });
    }
    if (running) {
      const err = new Error(`Query worker ${label} received concurrent work while busy.`);
      err.code = 'ERR_QUERY_WORKER_BUSY';
      throw err;
    }
    running = true;
    try {
      const activeSession = ensureChild();
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
          lastRssBytes: null,
          ownerGeneration: activeSession.generation,
          ownerPid: activeSession.pid,
          ownerSession: activeSession
        };
        try {
          activeSession.child.send({ type: 'run', id, args, meta });
        } catch (error) {
          activeRequest = null;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
      if (activeSession.runsSinceStart >= normalizedMaxRunsPerProcess) {
        await closeChild(activeSession);
      }
      return payload;
    } finally { running = false; }
  };

  const close = async () => {
    closed = true;
    clearWatchdog();
    await closeChild(currentSession, { cancelActiveRequest: true });
  };

  return {
    run,
    close,
    isBusy: () => running,
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
            ? normalizeMaxRunsPerProcess(maxRunsPerWorkerByBackend[backendKey])
            : normalizeMaxRunsPerProcess(maxRunsPerProcess)
        })
      ))
    ])
  );
  const queue = [];
  let pumping = false;
  let closed = false;

  const createPoolClosedError = (meta = null) => {
    const backend = meta?.backend ? ` backend=${meta.backend}` : '';
    const queryText = typeof meta?.query === 'string' && meta.query.trim()
      ? ` query="${meta.query.trim().slice(0, 80)}${meta.query.trim().length > 80 ? '...' : ''}"`
      : '';
    const error = new Error(`Bench query worker pool closed before dispatch.${backend}${queryText}`);
    error.code = 'ERR_QUERY_WORKER_POOL_CLOSED';
    error.meta = {
      backend: meta?.backend || null,
      query: meta?.query || null
    };
    return error;
  };

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
        if (closed) {
          while (queue.length) {
            const request = queue.shift();
            request?.reject(createPoolClosedError(request?.meta));
          }
          break;
        }
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
    if (closed) {
      reject(createPoolClosedError(meta));
      return;
    }
    queue.push({ args, meta, resolve, reject });
    void pump();
  });

  const close = async () => {
    closed = true;
    while (queue.length) {
      const request = queue.shift();
      request?.reject(createPoolClosedError(request?.meta));
    }
    const allWorkers = Object.values(workerGroups).flat();
    await Promise.all(allWorkers.map((worker) => worker.close()));
  };
  return { run, close };
};
