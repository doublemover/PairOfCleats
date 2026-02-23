import { captureProcessSnapshot, snapshotTrackedSubprocesses } from '../../../src/shared/subprocess.js';
import { clampInt } from '../../../src/shared/limits.js';
import {
  WATCHDOG_MAX_MS,
  WATCHDOG_SOFT_KICK_COOLDOWN_DEFAULT_MS,
  WATCHDOG_SOFT_KICK_MAX_ATTEMPTS_DEFAULT
} from './constants.js';

/**
 * Extract top-level and run-stage watchdog config objects from one request.
 *
 * @param {object} request
 * @returns {{rawWatchdog:object,runStageWatchdog:object}}
 */
const resolveWatchdogConfigSource = (request) => {
  const rawWatchdog = request?.watchdog && typeof request.watchdog === 'object'
    ? request.watchdog
    : {};
  const runStageWatchdog = rawWatchdog?.stages?.run && typeof rawWatchdog.stages.run === 'object'
    ? rawWatchdog.stages.run
    : {};
  return { rawWatchdog, runStageWatchdog };
};

/**
 * Resolve run-stage watchdog policy from layered request fields.
 *
 * Order of precedence is stage-specific watchdog config, then top-level watchdog
 * config, then legacy `watchdogMs`. Derived values are clamped, and `softKickMs`
 * is guaranteed to be strictly below `hardTimeoutMs` when hard timeouts are enabled.
 *
 * @param {object} [request]
 * @returns {{
 *  hardTimeoutMs:number,
 *  heartbeatMs:number,
 *  softKickMs:number,
 *  softKickCooldownMs:number,
 *  softKickMaxAttempts:number
 * }}
 */
export const resolveWatchdogPolicy = (request) => {
  const { rawWatchdog, runStageWatchdog } = resolveWatchdogConfigSource(request);
  const hardTimeoutMs = clampInt(
    runStageWatchdog.hardTimeoutMs
      ?? runStageWatchdog.timeoutMs
      ?? rawWatchdog.hardTimeoutMs
      ?? rawWatchdog.timeoutMs
      ?? request?.watchdogMs,
    0,
    WATCHDOG_MAX_MS,
    0
  );
  const heartbeatMs = clampInt(
    runStageWatchdog.heartbeatMs
      ?? runStageWatchdog.progressHeartbeatMs
      ?? rawWatchdog.heartbeatMs
      ?? rawWatchdog.progressHeartbeatMs,
    0,
    WATCHDOG_MAX_MS,
    hardTimeoutMs > 0
      ? Math.max(250, Math.min(5000, Math.floor(hardTimeoutMs / 4)))
      : 0
  );
  const configuredSoftKickMs = clampInt(
    runStageWatchdog.softKickMs
      ?? runStageWatchdog.stallSoftKickMs
      ?? rawWatchdog.softKickMs
      ?? rawWatchdog.stallSoftKickMs,
    0,
    WATCHDOG_MAX_MS,
    -1
  );
  let softKickMs = configuredSoftKickMs >= 0
    ? configuredSoftKickMs
    : (hardTimeoutMs > 0 ? Math.max(250, Math.floor(hardTimeoutMs * 0.5)) : 0);
  if (hardTimeoutMs > 0 && softKickMs >= hardTimeoutMs) {
    softKickMs = Math.max(1, hardTimeoutMs - 1);
  }
  const softKickCooldownMs = clampInt(
    runStageWatchdog.softKickCooldownMs
      ?? rawWatchdog.softKickCooldownMs,
    0,
    WATCHDOG_MAX_MS,
    WATCHDOG_SOFT_KICK_COOLDOWN_DEFAULT_MS
  );
  const softKickMaxAttempts = clampInt(
    runStageWatchdog.softKickMaxAttempts
      ?? rawWatchdog.softKickMaxAttempts,
    0,
    8,
    WATCHDOG_SOFT_KICK_MAX_ATTEMPTS_DEFAULT
  );
  return {
    hardTimeoutMs,
    heartbeatMs,
    softKickMs,
    softKickCooldownMs,
    softKickMaxAttempts
  };
};

/**
 * Resolve watchdog polling cadence from active timeout policy.
 *
 * @param {{hardTimeoutMs:number,heartbeatMs:number}} watchdogPolicy
 * @returns {number}
 */
const resolveWatchdogPollIntervalMs = (watchdogPolicy) => Math.max(
  250,
  Math.min(
    1000,
    Math.floor(Math.max(watchdogPolicy.hardTimeoutMs || watchdogPolicy.heartbeatMs || 1000, 1000) / 4)
  )
);

/**
 * Capture a compact watchdog diagnostic snapshot for logs and protocol events.
 *
 * @param {{
 *  job?:object,
 *  idleMs?:number,
 *  source?:string,
 *  includeStack?:boolean,
 *  buildFlowSnapshot:()=>object,
 *  nowIso:()=>string
 * }} input
 * @returns {object}
 */
const buildSupervisorWatchdogSnapshot = ({
  job,
  idleMs = 0,
  source = 'watchdog',
  includeStack = true,
  buildFlowSnapshot,
  nowIso
}) => ({
  source,
  capturedAt: nowIso(),
  idleMs: Math.max(0, Math.floor(Number(idleMs) || 0)),
  job: {
    id: job?.id || null,
    status: job?.status || null,
    pid: job?.pid || null,
    startedAt: Number.isFinite(Number(job?.startedAt))
      ? new Date(Number(job.startedAt)).toISOString()
      : null
  },
  flow: buildFlowSnapshot(),
  trackedSubprocesses: snapshotTrackedSubprocesses({ limit: 6 }),
  process: captureProcessSnapshot({
    includeStack,
    frameLimit: includeStack ? 12 : 8,
    handleTypeLimit: 8
  })
});

/**
 * Build watchdog timer controls for one running job attempt.
 *
 * Controller emits heartbeat/soft-kick/hard-timeout diagnostics and aborts
 * the subprocess when hard inactivity thresholds are crossed.
 *
 * @param {{
 *  job:object,
 *  jobId:string,
 *  watchdogPolicy:object,
 *  getLastActivityAt:()=>number,
 *  emit:(event:string,payload?:object,options?:object)=>void,
 *  emitLog:(jobId:string,level:'info'|'warn'|'error',message:string,extra?:object)=>void,
 *  buildFlowSnapshot:()=>object,
 *  nowIso:()=>string
 * }} input
 * @returns {{start:()=>void,stop:()=>void}}
 */
export const createJobWatchdogController = ({
  job,
  jobId,
  watchdogPolicy,
  getLastActivityAt,
  emit,
  emitLog,
  buildFlowSnapshot,
  nowIso
}) => {
  let watchdogTimer = null;
  let watchdogLastHeartbeatAt = 0;
  let watchdogSoftKickAttempts = 0;
  let watchdogSoftKickInFlight = false;
  let watchdogLastSoftKickAt = 0;

  /**
   * Emit watchdog heartbeat log when job is idle past heartbeat threshold.
   *
   * @param {number} idleMs
   * @returns {void}
   */
  const emitWatchdogHeartbeat = (idleMs) => {
    if (watchdogPolicy.heartbeatMs <= 0) return;
    const nowMs = Date.now();
    if (watchdogLastHeartbeatAt > 0 && (nowMs - watchdogLastHeartbeatAt) < watchdogPolicy.heartbeatMs) return;
    watchdogLastHeartbeatAt = nowMs;
    const snapshot = buildSupervisorWatchdogSnapshot({
      job,
      idleMs,
      source: 'watchdog_heartbeat',
      includeStack: false,
      buildFlowSnapshot,
      nowIso
    });
    emitLog(
      jobId,
      'info',
      `watchdog heartbeat idle=${Math.floor(idleMs)}ms pid=${job.pid || 'n/a'}`,
      {
        watchdogPhase: 'heartbeat',
        idleMs: Math.floor(idleMs),
        watchdogSnapshot: snapshot
      }
    );
  };

  /**
   * Execute one watchdog soft-kick attempt.
   *
   * @param {number} idleMs
   * @returns {void}
   */
  const runSoftKick = (idleMs) => {
    if (watchdogSoftKickInFlight || job.finalized || job.abortController.signal.aborted) return;
    watchdogSoftKickInFlight = true;
    watchdogSoftKickAttempts += 1;
    watchdogLastSoftKickAt = Date.now();
    const snapshot = buildSupervisorWatchdogSnapshot({
      job,
      idleMs,
      source: 'watchdog_soft_kick',
      includeStack: true,
      buildFlowSnapshot,
      nowIso
    });
    emitLog(
      jobId,
      'warn',
      `watchdog soft-kick attempt ${watchdogSoftKickAttempts}/${watchdogPolicy.softKickMaxAttempts} `
        + `(idle=${Math.floor(idleMs)}ms)`,
      {
        watchdogPhase: 'soft-kick',
        softKickAttempt: watchdogSoftKickAttempts,
        softKickMaxAttempts: watchdogPolicy.softKickMaxAttempts,
        idleMs: Math.floor(idleMs),
        watchdogSnapshot: snapshot
      }
    );
    emit('job:watchdog', {
      phase: 'soft-kick',
      idleMs: Math.floor(idleMs),
      attempt: watchdogSoftKickAttempts,
      maxAttempts: watchdogPolicy.softKickMaxAttempts,
      snapshot
    }, { jobId, critical: true });
    try {
      if (Number.isFinite(Number(job.pid)) && Number(job.pid) > 0 && process.platform !== 'win32') {
        process.kill(Number(job.pid), 'SIGCONT');
      }
    } catch {} finally {
      watchdogSoftKickInFlight = false;
    }
  };

  /**
   * Abort job due to watchdog hard-timeout.
   *
   * @param {number} idleMs
   * @returns {void}
   */
  const runHardTimeout = (idleMs) => {
    const snapshot = buildSupervisorWatchdogSnapshot({
      job,
      idleMs,
      source: 'watchdog_hard_timeout',
      includeStack: true,
      buildFlowSnapshot,
      nowIso
    });
    job.cancelReason = 'watchdog_timeout';
    emitLog(
      jobId,
      'warn',
      `watchdog timeout (${watchdogPolicy.hardTimeoutMs}ms inactivity)`,
      {
        watchdogPhase: 'hard-timeout',
        idleMs: Math.floor(idleMs),
        watchdogSnapshot: snapshot
      }
    );
    emit('job:watchdog', {
      phase: 'hard-timeout',
      idleMs: Math.floor(idleMs),
      hardTimeoutMs: watchdogPolicy.hardTimeoutMs,
      softKickAttempts: watchdogSoftKickAttempts,
      snapshot
    }, { jobId, critical: true });
    job.abortController.abort('watchdog_timeout');
  };

  /**
   * Watchdog polling tick: heartbeat, soft-kick, and hard-timeout checks.
   *
   * @returns {void}
   */
  const tick = () => {
    if (job.finalized || job.abortController.signal.aborted) return;
    const nowMs = Date.now();
    const idleMs = Math.max(0, nowMs - getLastActivityAt());
    if (watchdogPolicy.heartbeatMs > 0 && idleMs >= watchdogPolicy.heartbeatMs) {
      emitWatchdogHeartbeat(idleMs);
    }
    if (
      watchdogPolicy.softKickMs > 0
      && idleMs >= watchdogPolicy.softKickMs
      && watchdogSoftKickAttempts < watchdogPolicy.softKickMaxAttempts
      && (watchdogPolicy.softKickCooldownMs <= 0 || nowMs - watchdogLastSoftKickAt >= watchdogPolicy.softKickCooldownMs)
    ) {
      runSoftKick(idleMs);
    }
    if (watchdogPolicy.hardTimeoutMs <= 0 || idleMs < watchdogPolicy.hardTimeoutMs) return;
    runHardTimeout(idleMs);
  };

  return {
    start() {
      if (watchdogPolicy.hardTimeoutMs <= 0 && watchdogPolicy.softKickMs <= 0 && watchdogPolicy.heartbeatMs <= 0) {
        return;
      }
      watchdogTimer = setInterval(tick, resolveWatchdogPollIntervalMs(watchdogPolicy));
      if (typeof watchdogTimer.unref === 'function') watchdogTimer.unref();
    },
    stop() {
      if (!watchdogTimer) return;
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
  };
};
