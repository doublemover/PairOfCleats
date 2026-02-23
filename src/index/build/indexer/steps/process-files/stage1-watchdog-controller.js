import { createTimeoutError } from '../../../../../shared/promise-timeout.js';
import {
  snapshotTrackedSubprocesses,
  terminateTrackedSubprocesses
} from '../../../../../shared/subprocess.js';
import {
  buildStage1ProcessingStallSnapshot,
  collectStage1StalledFiles,
  formatStage1SchedulerStallSummary,
  formatStage1StalledFileText,
  summarizeStage1SoftKickCleanup
} from './stall-diagnostics.js';
import {
  buildFileProgressHeartbeatText,
  clampDurationMs,
  resolveStage1FileSubprocessOwnershipPrefix,
  resolveStage1StallAction
} from './watchdog-policy.js';

const STALL_SNAPSHOT_LOG_COOLDOWN_MS = 30000;

/**
 * Build stage1 watchdog controller for stall snapshots, heartbeats, and
 * soft-kick/abort recovery.
 *
 * The controller intentionally consumes `getProgress` and
 * `getOrderedCompletionTracker` callbacks instead of direct objects so it can
 * observe the latest mutable stage1 state across shard workers.
 *
 * @param {{
 *   mode:string,
 *   runtime:object,
 *   processStart:number,
 *   orderedAppender:object,
 *   postingsQueue:object|null,
 *   queueDelaySummary:object|null,
 *   inFlightFiles:Map<number,object>,
 *   stage1HangPolicy:object,
 *   getProgress:()=>({count:number,total:number}|null),
 *   getOrderedCompletionTracker:()=>({snapshot:Function}|null),
 *   abortProcessing:(reason?:unknown)=>void,
 *   logLine:(message:string,meta?:object)=>void
 * }} input
 * @returns {{
 *   ensureStallAbortTimer:()=>void,
 *   startTimers:()=>void,
 *   stopTimers:()=>void,
 *   onProgressTick:()=>void,
 *   logHangPolicy:()=>void,
 *   logAdaptiveSlowThreshold:(input?:{fileWatchdogConfig?:object,repoFileCount?:number,log?:Function})=>void,
 *   getPolicy:()=>{
 *     stallSnapshotMs:number,
 *     progressHeartbeatMs:number,
 *     stallAbortMs:number,
 *     stallSoftKickMs:number,
 *     stallSoftKickCooldownMs:number,
 *     stallSoftKickMaxAttempts:number
 *   },
 *   getStallRecoverySummary:()=>{
 *     softKickAttempts:number,
 *     softKickSuccessfulAttempts:number,
 *     softKickResetCount:number,
 *     softKickThresholdMs:number,
 *     softKickCooldownMs:number,
 *     softKickMaxAttempts:number,
 *     stallAbortMs:number
 *   }
 * }}
 */
export const createStage1ProcessingWatchdog = ({
  mode,
  runtime,
  processStart,
  orderedAppender,
  postingsQueue,
  queueDelaySummary,
  inFlightFiles,
  stage1HangPolicy,
  getProgress,
  getOrderedCompletionTracker,
  abortProcessing,
  logLine
}) => {
  const stallSnapshotMs = Number(stage1HangPolicy?.stallSnapshotMs) || 0;
  const progressHeartbeatMs = Number(stage1HangPolicy?.progressHeartbeatMs) || 0;
  const stallAbortMs = Number(stage1HangPolicy?.stallAbortMs) || 0;
  const stallSoftKickMs = Number(stage1HangPolicy?.stallSoftKickMs) || 0;
  const stallSoftKickCooldownMs = Number(stage1HangPolicy?.stallSoftKickCooldownMs) || 0;
  const stallSoftKickMaxAttempts = Number(stage1HangPolicy?.stallSoftKickMaxAttempts) || 0;
  const stage1OwnershipPrefix = `${resolveStage1FileSubprocessOwnershipPrefix(runtime, mode)}:`;

  let stage1StallAbortTriggered = false;
  let stage1StallSoftKickAttempts = 0;
  let stage1StallSoftKickSuccessCount = 0;
  let stage1StallSoftKickResetCount = 0;
  let stage1StallSoftKickInFlight = false;
  let lastStallSoftKickAt = 0;
  let lastProgressAt = Date.now();
  let lastStallSnapshotAt = 0;
  let watchdogAdaptiveLogged = false;

  let stallSnapshotTimer = null;
  let progressHeartbeatTimer = null;
  let stallAbortTimer = null;

  const getOrderedPendingCount = () => {
    const tracker = getOrderedCompletionTracker?.();
    if (!tracker || typeof tracker.snapshot !== 'function') return 0;
    const snapshot = tracker.snapshot();
    return Number(snapshot?.pending) || 0;
  };

  const collectStalledFiles = (limit = 6) => (
    collectStage1StalledFiles(inFlightFiles, { limit })
  );

  const buildProcessingStallSnapshot = ({
    reason = 'stall_snapshot',
    idleMs = null,
    includeStack = false
  } = {}) => buildStage1ProcessingStallSnapshot({
    reason,
    idleMs,
    includeStack,
    lastProgressAt,
    progress: getProgress?.() || null,
    processStart,
    inFlightFiles,
    getOrderedPendingCount,
    orderedAppender,
    postingsQueue,
    queueDelaySummary,
    stage1OwnershipPrefix,
    runtime
  });

  const toStalledFileText = (stalledFiles = []) => formatStage1StalledFileText(stalledFiles);
  const formatSchedulerStallSummary = (snapshot) => formatStage1SchedulerStallSummary(snapshot);
  const summarizeSoftKickCleanup = (cleanupResults = []) => summarizeStage1SoftKickCleanup(cleanupResults);

  const performStage1SoftKick = async ({
    idleMs = 0,
    source = 'watchdog',
    snapshot = null
  } = {}) => {
    if (stage1StallSoftKickInFlight || stage1StallAbortTriggered) return;
    stage1StallSoftKickInFlight = true;
    stage1StallSoftKickAttempts += 1;
    const attempt = stage1StallSoftKickAttempts;
    lastStallSoftKickAt = Date.now();
    const resolvedSnapshot = snapshot || buildProcessingStallSnapshot({
      reason: 'stall_soft_kick',
      idleMs,
      includeStack: true
    });
    const stalledFiles = Array.isArray(resolvedSnapshot?.stalledFiles)
      ? resolvedSnapshot.stalledFiles
      : collectStalledFiles(6);
    const targetedOwnershipIds = Array.from(new Set(
      stalledFiles
        .map((entry) => entry?.ownershipId)
        .filter((value) => typeof value === 'string' && value)
    )).slice(0, 3);
    logLine(
      `[watchdog] soft-kick attempt ${attempt}/${stallSoftKickMaxAttempts} `
        + `idle=${Math.round(clampDurationMs(idleMs) / 1000)}s source=${source} `
        + `targets=${targetedOwnershipIds.length || 0}`,
      {
        kind: 'warning',
        mode,
        stage: 'processing',
        idleMs: clampDurationMs(idleMs),
        source,
        softKickAttempt: attempt,
        softKickMaxAttempts: stallSoftKickMaxAttempts,
        softKickThresholdMs: stallSoftKickMs,
        targetedOwnershipIds,
        watchdogSnapshot: resolvedSnapshot
      }
    );
    try {
      const cleanupResults = [];
      if (targetedOwnershipIds.length > 0) {
        for (const ownershipId of targetedOwnershipIds) {
          cleanupResults.push(await terminateTrackedSubprocesses({
            reason: `stage1_processing_stall_soft_kick:${attempt}:${ownershipId}`,
            force: false,
            ownershipId
          }));
        }
      } else {
        cleanupResults.push(await terminateTrackedSubprocesses({
          reason: `stage1_processing_stall_soft_kick:${attempt}:prefix`,
          force: false,
          ownershipPrefix: stage1OwnershipPrefix
        }));
      }
      const cleanupSummary = summarizeSoftKickCleanup(cleanupResults);
      if (cleanupSummary.attempted > 0 && cleanupSummary.failures < cleanupSummary.attempted) {
        stage1StallSoftKickSuccessCount += 1;
      }
      logLine(
        `[watchdog] soft-kick result attempt=${attempt} attempted=${cleanupSummary.attempted} `
          + `failures=${cleanupSummary.failures} terminatedPids=${cleanupSummary.terminatedPids.length}`,
        {
          kind: cleanupSummary.failures > 0 ? 'warning' : 'status',
          mode,
          stage: 'processing',
          idleMs: clampDurationMs(idleMs),
          source,
          softKickAttempt: attempt,
          softKickResult: cleanupSummary
        }
      );
    } catch (error) {
      logLine(
        `[watchdog] soft-kick attempt ${attempt} failed: ${error?.message || error}`,
        {
          kind: 'warning',
          mode,
          stage: 'processing',
          idleMs: clampDurationMs(idleMs),
          source,
          softKickAttempt: attempt
        }
      );
    } finally {
      stage1StallSoftKickInFlight = false;
    }
  };

  const evaluateStalledProcessing = (source = 'watchdog') => {
    const progress = getProgress?.();
    if (!progress || stage1StallAbortTriggered) return;
    const orderedPending = getOrderedPendingCount();
    if (progress.count >= progress.total && inFlightFiles.size === 0 && orderedPending === 0) return;
    const now = Date.now();
    const idleMs = Math.max(0, now - lastProgressAt);
    const decision = resolveStage1StallAction({
      idleMs,
      hardAbortMs: stallAbortMs,
      softKickMs: stallSoftKickMs,
      softKickAttempts: stage1StallSoftKickAttempts,
      softKickMaxAttempts: stallSoftKickMaxAttempts,
      softKickInFlight: stage1StallSoftKickInFlight,
      lastSoftKickAtMs: lastStallSoftKickAt,
      softKickCooldownMs: stallSoftKickCooldownMs,
      nowMs: now
    });
    if (decision.action === 'none') return;
    const snapshot = buildProcessingStallSnapshot({
      reason: decision.action === 'abort' ? 'stall_timeout' : 'stall_soft_kick',
      idleMs,
      includeStack: true
    });
    if (decision.action === 'soft-kick') {
      void performStage1SoftKick({
        idleMs,
        source,
        snapshot
      });
      return;
    }
    stage1StallAbortTriggered = true;
    const err = createTimeoutError({
      message: `Stage1 processing stalled for ${idleMs}ms at ${progress.count}/${progress.total}`,
      code: 'FILE_PROCESS_STALL_TIMEOUT',
      retryable: false,
      meta: {
        idleMs,
        progressDone: progress.count,
        progressTotal: progress.total,
        inFlight: inFlightFiles.size,
        orderedPending,
        trackedSubprocesses: Number(snapshot?.trackedSubprocesses?.total) || 0,
        softKickAttempts: stage1StallSoftKickAttempts
      }
    });
    logLine(
      `[watchdog] stall-timeout idle=${Math.round(idleMs / 1000)}s progress=${progress.count}/${progress.total}; aborting stage1.`,
      {
        kind: 'error',
        mode,
        stage: 'processing',
        source,
        code: err.code,
        idleMs,
        progressDone: progress.count,
        progressTotal: progress.total,
        inFlight: inFlightFiles.size,
        orderedPending,
        softKickAttempts: stage1StallSoftKickAttempts,
        softKickThresholdMs: stallSoftKickMs,
        stallAbortMs,
        watchdogSnapshot: snapshot
      }
    );
    const schedulerSummary = formatSchedulerStallSummary(snapshot?.scheduler);
    if (schedulerSummary) {
      logLine(`[watchdog] scheduler snapshot: ${schedulerSummary}`, {
        kind: 'error',
        mode,
        stage: 'processing',
        scheduler: snapshot?.scheduler || null
      });
    }
    if (Array.isArray(snapshot?.stalledFiles) && snapshot.stalledFiles.length) {
      logLine(`[watchdog] stalled files: ${toStalledFileText(snapshot.stalledFiles)}`, {
        kind: 'error',
        mode,
        stage: 'processing'
      });
    }
    const stackFrames = Array.isArray(snapshot?.process?.stack?.frames)
      ? snapshot.process.stack.frames
      : [];
    if (stackFrames.length > 0) {
      logLine(`[watchdog] stack snapshot: ${stackFrames.slice(0, 3).join(' | ')}`, {
        kind: 'error',
        mode,
        stage: 'processing'
      });
    }
    orderedAppender.abort(err);
    abortProcessing?.(err);
    void terminateTrackedSubprocesses({
      reason: 'stage1_processing_stall_timeout',
      force: false
    }).then((cleanup) => {
      if (!cleanup || cleanup.attempted <= 0) return;
      logLine(
        `[watchdog] cleaned ${cleanup.attempted} tracked subprocess(es) after stage1 stall-timeout.`,
        {
          kind: 'warning',
          mode,
          stage: 'processing',
          cleanup
        }
      );
    }).catch(() => {});
  };

  const emitProcessingStallSnapshot = () => {
    const progress = getProgress?.();
    if (stallSnapshotMs <= 0 || !progress) return;
    const orderedPending = getOrderedPendingCount();
    if (progress.count >= progress.total && inFlightFiles.size === 0 && orderedPending === 0) return;
    const now = Date.now();
    const idleMs = Math.max(0, now - lastProgressAt);
    if (idleMs < stallSnapshotMs) return;
    if (lastStallSnapshotAt > 0 && now - lastStallSnapshotAt < STALL_SNAPSHOT_LOG_COOLDOWN_MS) return;
    lastStallSnapshotAt = now;
    const includeStack = (stallSoftKickMs > 0 && idleMs >= stallSoftKickMs)
      || (stallAbortMs > 0 && idleMs >= stallAbortMs);
    const snapshot = buildProcessingStallSnapshot({
      reason: 'stall_snapshot',
      idleMs,
      includeStack
    });
    const trackedSubprocesses = Number(snapshot?.trackedSubprocesses?.total) || 0;
    logLine(
      `[watchdog] stall snapshot idle=${Math.round(idleMs / 1000)}s progress=${progress.count}/${progress.total} `
        + `next=${snapshot?.orderedSnapshot?.nextIndex ?? '?'} pending=${snapshot?.orderedSnapshot?.pendingCount ?? '?'} `
        + `orderedPending=${snapshot?.orderedPending ?? 0} inFlight=${inFlightFiles.size} `
        + `trackedSubprocesses=${trackedSubprocesses}`,
      {
        kind: 'warning',
        mode,
        stage: 'processing',
        progressDone: progress.count,
        progressTotal: progress.total,
        idleMs,
        orderedSnapshot: snapshot?.orderedSnapshot || null,
        orderedPending: snapshot?.orderedPending || 0,
        postingsPending: snapshot?.postingsSnapshot?.pending || null,
        stalledFiles: snapshot?.stalledFiles || [],
        trackedSubprocesses,
        watchdogSnapshot: snapshot
      }
    );
    const schedulerSummary = formatSchedulerStallSummary(snapshot?.scheduler);
    if (schedulerSummary) {
      logLine(`[watchdog] scheduler snapshot: ${schedulerSummary}`, {
        kind: 'warning',
        mode,
        stage: 'processing',
        scheduler: snapshot?.scheduler || null
      });
    }
    if (Array.isArray(snapshot?.stalledFiles) && snapshot.stalledFiles.length) {
      logLine(`[watchdog] oldest in-flight: ${toStalledFileText(snapshot.stalledFiles)}`, {
        kind: 'warning',
        mode,
        stage: 'processing'
      });
    }
    const trackedEntries = Array.isArray(snapshot?.trackedSubprocesses?.entries)
      ? snapshot.trackedSubprocesses.entries
      : [];
    if (trackedEntries.length > 0) {
      const trackedText = trackedEntries
        .map((entry) => `${entry.pid ?? '?'}:${entry.ownershipId || entry.scope || 'unknown'}`)
        .join(', ');
      logLine(`[watchdog] tracked subprocess snapshot: ${trackedText}`, {
        kind: 'warning',
        mode,
        stage: 'processing'
      });
    }
    evaluateStalledProcessing('stall_snapshot');
  };

  const emitProcessingProgressHeartbeat = () => {
    const progress = getProgress?.();
    if (progressHeartbeatMs <= 0 || !progress) return;
    const orderedPending = getOrderedPendingCount();
    if (progress.count >= progress.total && inFlightFiles.size === 0 && orderedPending === 0) return;
    const now = Date.now();
    const trackedSubprocesses = snapshotTrackedSubprocesses({
      ownershipPrefix: stage1OwnershipPrefix,
      limit: 1
    }).total;
    const oldestInFlight = collectStalledFiles(3)
      .map((entry) => `${entry.file || 'unknown'}@${Math.round((entry.elapsedMs || 0) / 1000)}s`);
    const oldestText = oldestInFlight.length ? ` oldest=${oldestInFlight.join(',')}` : '';
    logLine(
      `${buildFileProgressHeartbeatText({
        count: progress.count,
        total: progress.total,
        startedAtMs: processStart,
        nowMs: now,
        inFlight: inFlightFiles.size,
        trackedSubprocesses
      })} orderedPending=${orderedPending}${oldestText}`,
      {
        kind: 'status',
        mode,
        stage: 'processing',
        progressDone: progress.count,
        progressTotal: progress.total,
        inFlight: inFlightFiles.size,
        orderedPending,
        trackedSubprocesses,
        oldestInFlight
      }
    );
    evaluateStalledProcessing('progress_heartbeat');
  };

  const startTimers = () => {
    if (stallSnapshotMs > 0 && !stallSnapshotTimer) {
      stallSnapshotTimer = setInterval(() => {
        emitProcessingStallSnapshot();
      }, Math.min(30000, Math.max(10000, Math.floor(stallSnapshotMs / 2))));
      stallSnapshotTimer.unref?.();
    }
    if (progressHeartbeatMs > 0 && !progressHeartbeatTimer) {
      progressHeartbeatTimer = setInterval(() => {
        emitProcessingProgressHeartbeat();
      }, progressHeartbeatMs);
      progressHeartbeatTimer.unref?.();
    }
  };

  const ensureStallAbortTimer = () => {
    if (stallAbortMs <= 0 || stallAbortTimer) return;
    const pollMs = Math.max(2000, Math.min(10000, Math.floor(stallAbortMs / 6)));
    stallAbortTimer = setInterval(() => {
      evaluateStalledProcessing('stall_poll_timer');
    }, pollMs);
    stallAbortTimer.unref?.();
  };

  const stopTimers = () => {
    if (stallSnapshotTimer) {
      clearInterval(stallSnapshotTimer);
      stallSnapshotTimer = null;
    }
    if (progressHeartbeatTimer) {
      clearInterval(progressHeartbeatTimer);
      progressHeartbeatTimer = null;
    }
    if (stallAbortTimer) {
      clearInterval(stallAbortTimer);
      stallAbortTimer = null;
    }
  };

  const onProgressTick = () => {
    lastProgressAt = Date.now();
    if (stage1StallSoftKickAttempts > 0) {
      stage1StallSoftKickAttempts = 0;
      lastStallSoftKickAt = 0;
      stage1StallSoftKickResetCount += 1;
    }
  };

  const logHangPolicy = () => {
    logLine(
      `[watchdog] stage1 hang policy heartbeat=${progressHeartbeatMs}ms snapshot=${stallSnapshotMs}ms `
        + `softKick=${stallSoftKickMs}ms abort=${stallAbortMs}ms `
        + `softKickMaxAttempts=${stallSoftKickMaxAttempts}`,
      {
        kind: 'status',
        mode,
        stage: 'processing',
        watchdogPolicy: {
          heartbeatMs: progressHeartbeatMs,
          snapshotMs: stallSnapshotMs,
          softKickMs: stallSoftKickMs,
          softKickCooldownMs: stallSoftKickCooldownMs,
          softKickMaxAttempts: stallSoftKickMaxAttempts,
          abortMs: stallAbortMs
        }
      }
    );
  };

  const logAdaptiveSlowThreshold = ({
    fileWatchdogConfig = null,
    repoFileCount = 0,
    log = () => {}
  } = {}) => {
    if (watchdogAdaptiveLogged || Number(fileWatchdogConfig?.adaptiveSlowFloorMs) <= 0) return;
    watchdogAdaptiveLogged = true;
    log(
      `[watchdog] large repo detected (${Math.max(0, Math.floor(Number(repoFileCount) || 0)).toLocaleString()} files); `
      + `slow-file base threshold raised to ${fileWatchdogConfig.slowFileMs}ms.`
    );
  };

  const getPolicy = () => ({
    stallSnapshotMs,
    progressHeartbeatMs,
    stallAbortMs,
    stallSoftKickMs,
    stallSoftKickCooldownMs,
    stallSoftKickMaxAttempts
  });

  const getStallRecoverySummary = () => ({
    softKickAttempts: stage1StallSoftKickAttempts,
    softKickSuccessfulAttempts: stage1StallSoftKickSuccessCount,
    softKickResetCount: stage1StallSoftKickResetCount,
    softKickThresholdMs: stallSoftKickMs,
    softKickCooldownMs: stallSoftKickCooldownMs,
    softKickMaxAttempts: stallSoftKickMaxAttempts,
    stallAbortMs
  });

  return {
    ensureStallAbortTimer,
    startTimers,
    stopTimers,
    onProgressTick,
    logHangPolicy,
    logAdaptiveSlowThreshold,
    getPolicy,
    getStallRecoverySummary
  };
};
