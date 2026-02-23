import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { SCHEDULER_QUEUE_NAMES } from '../runtime/scheduler.js';
import { resolveWriteStartTimestampMs } from './lane-policy.js';
import {
  countPendingLaneWrites,
  hasPendingLaneWrites,
  pickDispatchLane,
  resolveDispatchLaneBudgets,
  takeLaneDispatchEntries
} from './write-dispatch-lanes.js';
import { resolveDispatchWriteSchedulerTokens } from './write-scheduler-tokens.js';
import { recordArtifactMetricRow } from './write-telemetry.js';
import {
  resolveArtifactWriteLatencyClass,
  selectTailWorkerWriteEntry
} from './write-strategy.js';

/**
 * Drain artifact write lanes with adaptive concurrency and tail-rescue behavior.
 *
 * The caller owns queue construction and write-concurrency controller setup.
 * This helper owns only dispatch/settlement sequencing so artifact contracts
 * remain centralized and deterministic.
 *
 * @param {object} input
 * @param {object|null} [input.scheduler]
 * @param {string} input.outDir
 * @param {{ultraLight:object[],massive:object[],light:object[],heavy:object[]}} input.laneWrites
 * @param {object} input.writeFsStrategy
 * @param {number} input.ultraLightWriteThresholdBytes
 * @param {number} input.writeConcurrency
 * @param {boolean} input.adaptiveWriteConcurrencyEnabled
 * @param {{observe:(snapshot?:object)=>number,getCurrentConcurrency:()=>number}} input.writeConcurrencyController
 * @param {number|null} [input.workClassSmallConcurrencyOverride]
 * @param {number|null} [input.workClassMediumConcurrencyOverride]
 * @param {number|null} [input.workClassLargeConcurrencyOverride]
 * @param {boolean} input.writeTailRescueEnabled
 * @param {number} input.writeTailRescueMaxPending
 * @param {number} input.writeTailRescueStallSeconds
 * @param {number} input.writeTailRescueBoostIoTokens
 * @param {number} input.writeTailRescueBoostMemTokens
 * @param {boolean} input.writeTailWorkerEnabled
 * @param {number} input.writeTailWorkerMaxPending
 * @param {number} input.massiveWriteIoTokens
 * @param {number} input.massiveWriteMemTokens
 * @param {(estimatedBytes:number)=>number} input.resolveArtifactWriteMemTokens
 * @param {() => number} input.getLongestWriteStallSeconds
 * @param {Map<string, number>} input.activeWrites
 * @param {Map<string, number>} input.activeWriteBytes
 * @param {{start:()=>void,stop:()=>void,clearLabelAlerts:(label:string)=>void}} input.writeHeartbeat
 * @param {() => void} input.updateWriteInFlightTelemetry
 * @param {(piecePath:string,meta?:object)=>void} input.updatePieceMetadata
 * @param {(label:string)=>void} input.logWriteProgress
 * @param {Map<string, object>} input.artifactMetrics
 * @param {Map<string, number[]>} input.artifactQueueDelaySamples
 * @param {(message:string,options?:object)=>void} input.logLine
 * @returns {Promise<void>}
 */
export const drainArtifactWriteQueues = async ({
  scheduler = null,
  outDir,
  laneWrites,
  writeFsStrategy,
  ultraLightWriteThresholdBytes,
  writeConcurrency,
  adaptiveWriteConcurrencyEnabled,
  writeConcurrencyController,
  workClassSmallConcurrencyOverride = null,
  workClassMediumConcurrencyOverride = null,
  workClassLargeConcurrencyOverride = null,
  writeTailRescueEnabled,
  writeTailRescueMaxPending,
  writeTailRescueStallSeconds,
  writeTailRescueBoostIoTokens,
  writeTailRescueBoostMemTokens,
  writeTailWorkerEnabled,
  writeTailWorkerMaxPending,
  massiveWriteIoTokens,
  massiveWriteMemTokens,
  resolveArtifactWriteMemTokens,
  getLongestWriteStallSeconds,
  activeWrites,
  activeWriteBytes,
  writeHeartbeat,
  updateWriteInFlightTelemetry,
  updatePieceMetadata,
  logWriteProgress,
  artifactMetrics,
  artifactQueueDelaySamples,
  logLine
}) => {
  const hostConcurrency = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : (Array.isArray(os.cpus()) ? os.cpus().length : 1);
  const laneQueues = {
    ultraLight: Array.isArray(laneWrites?.ultraLight) ? laneWrites.ultraLight.slice() : [],
    massive: Array.isArray(laneWrites?.massive) ? laneWrites.massive.slice() : [],
    light: Array.isArray(laneWrites?.light) ? laneWrites.light.slice() : [],
    heavy: Array.isArray(laneWrites?.heavy) ? laneWrites.heavy.slice() : []
  };
  const laneActive = {
    ultraLight: 0,
    massive: 0,
    light: 0,
    heavy: 0
  };
  let activeCount = 0;
  let fatalWriteError = null;
  const inFlightWrites = new Set();
  let forcedTailRescueConcurrency = null;
  let tailRescueActive = false;
  let tailWorkerActive = 0;
  const pendingWriteCount = () => countPendingLaneWrites(laneQueues);
  const getActiveWriteConcurrency = () => (
    forcedTailRescueConcurrency != null
      ? Math.max(
        forcedTailRescueConcurrency,
        adaptiveWriteConcurrencyEnabled
          ? writeConcurrencyController.getCurrentConcurrency()
          : writeConcurrency
      )
      : (
        adaptiveWriteConcurrencyEnabled
          ? writeConcurrencyController.getCurrentConcurrency()
          : writeConcurrency
      )
  );
  /**
   * Tail-rescue activates only on a short queue plus sustained stall.
   *
   * Keeping both conditions guards against stealing capacity from healthy
   * write bursts while still boosting the long-tail phase.
   *
   * @returns {{active:boolean,remainingWrites:number,longestStallSec:number}}
   */
  const resolveTailRescueState = () => {
    const pendingWrites = pendingWriteCount();
    const remainingWrites = pendingWrites + activeCount;
    const longestStallSec = getLongestWriteStallSeconds();
    const active = writeTailRescueEnabled
      && remainingWrites > 0
      && remainingWrites <= writeTailRescueMaxPending
      && longestStallSec >= writeTailRescueStallSeconds;
    return {
      active,
      remainingWrites,
      longestStallSec
    };
  };
  /**
   * Observe adaptive signals once per dispatch cycle before lane picks.
   *
   * This keeps queue + memory pressure sampling aligned to dispatch decisions
   * instead of per-write completion timing.
   *
   * @returns {number}
   */
  const observeAdaptiveWriteConcurrency = () => {
    const rescueState = resolveTailRescueState();
    if (rescueState.active !== tailRescueActive) {
      tailRescueActive = rescueState.active;
      if (tailRescueActive) {
        logLine(
          `[perf] write tail rescue active: remaining=${rescueState.remainingWrites}, ` +
          `stall=${rescueState.longestStallSec}s, boost=+${writeTailRescueBoostIoTokens}io/+${writeTailRescueBoostMemTokens}mem`,
          { kind: 'warning' }
        );
      } else {
        logLine('[perf] write tail rescue cleared', { kind: 'status' });
      }
    }
    forcedTailRescueConcurrency = rescueState.active ? writeConcurrency : null;
    if (!adaptiveWriteConcurrencyEnabled) return getActiveWriteConcurrency();
    const schedulerStats = scheduler?.stats ? scheduler.stats() : null;
    const memorySignals = schedulerStats?.adaptive?.signals?.memory || null;
    return writeConcurrencyController.observe({
      pendingWrites: pendingWriteCount(),
      activeWrites: activeCount,
      longestStallSec: rescueState.longestStallSec,
      memoryPressure: Number(memorySignals?.pressureScore),
      gcPressure: Number(memorySignals?.gcPressureScore),
      rssUtilization: Number(memorySignals?.rssUtilization)
    });
  };
  const resolveLaneBudgets = () => resolveDispatchLaneBudgets({
    laneQueues,
    laneActive,
    writeConcurrency: getActiveWriteConcurrency(),
    smallConcurrencyOverride: workClassSmallConcurrencyOverride,
    mediumConcurrencyOverride: workClassMediumConcurrencyOverride,
    largeConcurrencyOverride: workClassLargeConcurrencyOverride,
    hostConcurrency
  });
  const scheduleWriteJob = (fn, tokens) => {
    if (!scheduler?.schedule || typeof fn !== 'function') return fn();
    return scheduler.schedule(
      SCHEDULER_QUEUE_NAMES.stage2Write,
      tokens,
      fn
    );
  };
  const runSingleWrite = async (
    { label, job, estimatedBytes, enqueuedAt, prefetched, prefetchStartedAt },
    laneName,
    { rescueBoost = false, tailWorker = false, batchSize = 1, batchIndex = 0 } = {}
  ) => {
    const activeLabel = label || '(unnamed artifact)';
    const dispatchStartedAt = Date.now();
    const started = resolveWriteStartTimestampMs(prefetchStartedAt, dispatchStartedAt);
    const queueDelayMs = Math.max(0, started - (Number(enqueuedAt) || started));
    const startedConcurrency = getActiveWriteConcurrency();
    activeWrites.set(activeLabel, started);
    activeWriteBytes.set(activeLabel, Number.isFinite(estimatedBytes) ? estimatedBytes : 0);
    updateWriteInFlightTelemetry();
    try {
      const schedulerTokens = resolveDispatchWriteSchedulerTokens({
        estimatedBytes,
        laneName,
        rescueBoost,
        massiveWriteIoTokens,
        massiveWriteMemTokens,
        writeTailRescueBoostIoTokens,
        writeTailRescueBoostMemTokens,
        resolveArtifactWriteMemTokens
      });
      const writeResult = prefetched
        ? await prefetched
        : await scheduleWriteJob(job, schedulerTokens);
      const durationMs = Math.max(0, Date.now() - started);
      const serializationMs = Number.isFinite(Number(writeResult?.serializationMs))
        ? Math.max(0, Number(writeResult.serializationMs))
        : null;
      const diskMs = Number.isFinite(Number(writeResult?.diskMs))
        ? Math.max(0, Number(writeResult.diskMs))
        : (serializationMs != null ? Math.max(0, durationMs - serializationMs) : null);
      let bytes = null;
      if (Number.isFinite(Number(writeResult?.bytes))) {
        bytes = Number(writeResult.bytes);
      }
      if (!Number.isFinite(bytes) && label) {
        try {
          const stat = await fs.stat(path.join(outDir, label));
          bytes = stat.size;
        } catch {}
      }
      const throughputBytesPerSec = Number.isFinite(bytes) && durationMs > 0
        ? Math.round(bytes / (durationMs / 1000))
        : null;
      const latencyClass = resolveArtifactWriteLatencyClass({
        queueDelayMs,
        durationMs,
        bytes,
        estimatedBytes
      });
      recordArtifactMetricRow({
        label,
        metric: {
          queueDelayMs,
          waitMs: queueDelayMs,
          durationMs,
          bytes,
          estimatedBytes: Number.isFinite(estimatedBytes) ? estimatedBytes : null,
          throughputBytesPerSec,
          serializationMs,
          diskMs,
          directFdStreaming: writeResult?.directFdStreaming === true,
          tailRescueBoosted: rescueBoost === true,
          tailWorker: tailWorker === true,
          batchSize: batchSize > 1 ? batchSize : null,
          batchIndex: batchSize > 1 ? batchIndex + 1 : null,
          latencyClass,
          fsStrategyMode: writeFsStrategy?.mode,
          checksum: typeof writeResult?.checksum === 'string' ? writeResult.checksum : null,
          checksumAlgo: typeof writeResult?.checksumAlgo === 'string' ? writeResult.checksumAlgo : null,
          lane: laneName,
          schedulerIoTokens: schedulerTokens.io || 0,
          schedulerMemTokens: schedulerTokens.mem || 0,
          writeConcurrencyAtStart: startedConcurrency
        },
        artifactMetrics,
        artifactQueueDelaySamples
      });
      updatePieceMetadata(label, {
        bytes,
        checksum: typeof writeResult?.checksum === 'string' ? writeResult.checksum : null,
        checksumAlgo: typeof writeResult?.checksumAlgo === 'string' ? writeResult.checksumAlgo : null,
        checksumHash: typeof writeResult?.checksumHash === 'string' ? writeResult.checksumHash : null
      });
    } finally {
      activeWrites.delete(activeLabel);
      activeWriteBytes.delete(activeLabel);
      updateWriteInFlightTelemetry();
      writeHeartbeat.clearLabelAlerts(activeLabel);
      logWriteProgress(label);
    }
  };
  const runWriteBatch = async (entries, laneName, options = {}) => {
    const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
    if (!list.length) return;
    if (list.length === 1) {
      await runSingleWrite(list[0], laneName, options);
      return;
    }
    for (let index = 0; index < list.length; index += 1) {
      await runSingleWrite(list[index], laneName, {
        ...options,
        batchSize: list.length,
        batchIndex: index
      });
    }
  };
  const dispatchWrites = () => {
    observeAdaptiveWriteConcurrency();
    while (!fatalWriteError) {
      const activeConcurrency = getActiveWriteConcurrency();
      const remainingWrites = pendingWriteCount() + activeCount;
      const tailWorkerEligible = writeTailWorkerEnabled
        && tailWorkerActive < 1
        && remainingWrites > 0
        && remainingWrites <= writeTailWorkerMaxPending;
      const concurrencyLimit = activeConcurrency + (tailWorkerEligible ? 1 : 0);
      if (activeCount >= concurrencyLimit) break;
      const rescueState = resolveTailRescueState();
      const budgets = resolveLaneBudgets();
      let laneName = pickDispatchLane({
        laneQueues,
        laneActive,
        budgets
      });
      let dispatchEntries = laneName
        ? takeLaneDispatchEntries({
          laneQueues,
          laneName,
          writeFsStrategy,
          ultraLightWriteThresholdBytes
        })
        : [];
      let usedTailWorker = false;
      if (
        (!laneName || dispatchEntries.length === 0)
        && tailWorkerEligible
        && activeCount >= activeConcurrency
      ) {
        const tailSelection = selectTailWorkerWriteEntry(laneQueues, {
          laneOrder: ['massive', 'heavy', 'light', 'ultraLight']
        });
        if (tailSelection?.entry) {
          laneName = tailSelection.laneName;
          dispatchEntries = [tailSelection.entry];
          usedTailWorker = true;
        }
      }
      if (!laneName || dispatchEntries.length === 0) break;
      if (usedTailWorker) {
        tailWorkerActive += 1;
      } else {
        laneActive[laneName] += 1;
      }
      activeCount += 1;
      const tracked = runWriteBatch(
        dispatchEntries,
        laneName,
        {
          rescueBoost: rescueState.active && laneName !== 'ultraLight',
          tailWorker: usedTailWorker
        }
      )
        .then(() => ({ ok: true }))
        .catch((error) => ({ ok: false, error }))
        .finally(() => {
          if (usedTailWorker) {
            tailWorkerActive = Math.max(0, tailWorkerActive - 1);
          } else {
            laneActive[laneName] = Math.max(0, laneActive[laneName] - 1);
          }
          activeCount = Math.max(0, activeCount - 1);
        });
      inFlightWrites.add(tracked);
      tracked
        .finally(() => {
          inFlightWrites.delete(tracked);
        })
        .catch(() => {});
    }
  };

  writeHeartbeat.start();
  try {
    dispatchWrites();
    while (
      inFlightWrites.size > 0
      || hasPendingLaneWrites(laneQueues)
    ) {
      if (fatalWriteError) break;
      if (!inFlightWrites.size) {
        dispatchWrites();
        if (!inFlightWrites.size) break;
      }
      const settled = await Promise.race(inFlightWrites);
      if (!settled?.ok) {
        fatalWriteError = settled?.error || new Error('artifact write failed');
        break;
      }
      dispatchWrites();
    }
    if (fatalWriteError) {
      if (inFlightWrites.size > 0) {
        await Promise.allSettled(Array.from(inFlightWrites));
      }
      throw fatalWriteError;
    }
  } finally {
    writeHeartbeat.stop();
    activeWrites.clear();
    activeWriteBytes.clear();
    updateWriteInFlightTelemetry();
  }
};
