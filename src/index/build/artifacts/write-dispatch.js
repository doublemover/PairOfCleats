import fs from 'node:fs/promises';
import path from 'node:path';
import { SCHEDULER_QUEUE_NAMES } from '../runtime/scheduler.js';
import { resolveWriteStartTimestampMs, resolveArtifactWorkClassConcurrency } from './lane-policy.js';
import { resolveDispatchWriteSchedulerTokens } from './write-scheduler-tokens.js';
import {
  resolveArtifactWriteLatencyClass,
  selectMicroWriteBatch,
  selectTailWorkerWriteEntry
} from './write-strategy.js';
import { recordArtifactMetricRow } from './write-telemetry.js';

/**
 * Drain the queued artifact-write lanes using the adaptive dispatcher runtime.
 *
 * @param {object} input
 * @returns {Promise<void>}
 */
export const dispatchArtifactWrites = async (input = {}) => {
  const {
    laneQueues,
    writeFsStrategy,
    ultraLightWriteThresholdBytes,
    writeTailWorkerEnabled,
    writeTailWorkerMaxPending,
    writeTailRescueEnabled,
    writeTailRescueMaxPending,
    writeTailRescueStallSeconds,
    writeTailRescueBoostIoTokens,
    writeTailRescueBoostMemTokens,
    adaptiveWriteConcurrencyEnabled,
    adaptiveWriteObserveIntervalMs,
    adaptiveWriteQueuePendingThreshold,
    adaptiveWriteQueueOldestWaitMsThreshold,
    adaptiveWriteQueueWaitP95MsThreshold,
    adaptiveWriteStallScaleDownSeconds,
    writeConcurrencyController,
    writeConcurrency,
    workClassSmallConcurrencyOverride,
    workClassMediumConcurrencyOverride,
    workClassLargeConcurrencyOverride,
    hostConcurrency,
    scheduler,
    effectiveAbortSignal,
    canDispatchEntryUnderHugeWritePolicy,
    activeWrites,
    activeWriteBytes,
    activeWriteMeta,
    hugeWriteState,
    updateWriteInFlightTelemetry,
    getLongestWriteStallSeconds,
    getActiveWriteTelemetrySnapshot,
    updateActiveWriteMeta,
    resolveEntryEstimatedBytes,
    resolveHugeWriteFamily,
    massiveWriteIoTokens,
    massiveWriteMemTokens,
    resolveArtifactWriteMemTokens,
    outDir,
    artifactMetrics,
    artifactQueueDelaySamples,
    updatePieceMetadata,
    formatBytes,
    logLine,
    logWriteProgress,
    writeHeartbeat
  } = input;

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
  let lastNonWriteStallLogAt = Number.NEGATIVE_INFINITY;

  const pendingWriteCount = () => (
    laneQueues.ultraLight.length
    + laneQueues.massive.length
    + laneQueues.light.length
    + laneQueues.heavy.length
  );

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

  const resolveTailRescueState = ({ writeQueueBackedUp = false } = {}) => {
    const pendingWrites = pendingWriteCount();
    const remainingWrites = pendingWrites + activeCount;
    const longestStallSec = getLongestWriteStallSeconds();
    const active = writeTailRescueEnabled
      && remainingWrites > 0
      && remainingWrites <= writeTailRescueMaxPending
      && longestStallSec >= writeTailRescueStallSeconds
      && writeQueueBackedUp;
    return {
      active,
      remainingWrites,
      longestStallSec
    };
  };

  const observeAdaptiveWriteConcurrency = () => {
    const schedulerStats = scheduler?.stats ? scheduler.stats() : null;
    const schedulerWriteStats = schedulerStats?.queues?.[SCHEDULER_QUEUE_NAMES.stage2Write] || null;
    const schedulerWritePending = Number(schedulerWriteStats?.pending);
    const schedulerWriteOldestWaitMs = Number(schedulerWriteStats?.oldestWaitMs);
    const schedulerWriteWaitP95Ms = Number(schedulerWriteStats?.waitP95Ms);
    const queueBackedUp = (
      Number.isFinite(schedulerWritePending)
      && schedulerWritePending >= adaptiveWriteQueuePendingThreshold
      && (
        (Number.isFinite(schedulerWriteOldestWaitMs)
          && schedulerWriteOldestWaitMs >= adaptiveWriteQueueOldestWaitMsThreshold)
        || (Number.isFinite(schedulerWriteWaitP95Ms)
          && schedulerWriteWaitP95Ms >= adaptiveWriteQueueWaitP95MsThreshold)
      )
    );
    const rescueState = resolveTailRescueState({ writeQueueBackedUp: queueBackedUp });
    const nonWriteTailStall = (
      rescueState.longestStallSec >= adaptiveWriteStallScaleDownSeconds
      && !queueBackedUp
    );
    const activeWriteSnapshot = getActiveWriteTelemetrySnapshot();
    const activeStallOwner = activeWriteSnapshot.stallOwner || null;
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
    forcedTailRescueConcurrency = rescueState.active && !nonWriteTailStall ? writeConcurrency : null;
    if (!adaptiveWriteConcurrencyEnabled) return getActiveWriteConcurrency();
    const memorySignals = schedulerStats?.adaptive?.signals?.memory || null;
    if (
      rescueState.longestStallSec >= adaptiveWriteStallScaleDownSeconds
      && !queueBackedUp
      && Number.isFinite(schedulerWritePending)
      && Number.isFinite(schedulerWriteOldestWaitMs)
    ) {
      const nowMs = Date.now();
      if ((nowMs - lastNonWriteStallLogAt) >= 10000) {
        lastNonWriteStallLogAt = nowMs;
        const oldestInflight = activeWriteSnapshot.inflight[0] || null;
        const stallAttribution = activeStallOwner || 'non-write';
        const phaseSuffix = activeWriteSnapshot.phaseSummaryText
          ? `, phases={${activeWriteSnapshot.phaseSummaryText}}`
          : '';
        const familySuffix = activeWriteSnapshot.familySummaryText
          ? `, families={${activeWriteSnapshot.familySummaryText}}`
          : '';
        const oldestPhaseClassSuffix = oldestInflight?.phaseClass
          ? `, oldestPhaseClass=${oldestInflight.phaseClass}`
          : '';
        const previewSuffix = activeWriteSnapshot.previewText
          ? `, preview=${activeWriteSnapshot.previewText}`
          : '';
        const hugeSuffix = hugeWriteState.families.size > 0
          ? `, hugeFamilies=${Array.from(hugeWriteState.families).sort().join('+')}, hugeBytes=${formatBytes(hugeWriteState.bytes)}`
          : '';
        logLine(
          `[perf] artifact stall attribution: ${stallAttribution} ` +
          `(active=${activeCount}, pendingWrites=${pendingWriteCount()}, ` +
          `writeQ.pending=${schedulerWritePending}, writeQ.oldest=${schedulerWriteOldestWaitMs}ms, ` +
          `writeQ.p95=${Number.isFinite(schedulerWriteWaitP95Ms) ? schedulerWriteWaitP95Ms : 'n/a'}ms` +
          `${phaseSuffix}${familySuffix}${oldestPhaseClassSuffix}${previewSuffix}${hugeSuffix})`,
          { kind: 'warning' }
        );
      }
    }
    return writeConcurrencyController.observe({
      pendingWrites: pendingWriteCount(),
      activeWrites: activeCount,
      activeWriteBytes: Array.from(activeWriteBytes.values()).reduce(
        (total, value) => total + (Number.isFinite(value) && value > 0 ? value : 0),
        0
      ),
      longestStallSec: rescueState.longestStallSec,
      memoryPressure: Number(memorySignals?.pressureScore),
      gcPressure: Number(memorySignals?.gcPressureScore),
      rssUtilization: Number(memorySignals?.rssUtilization),
      schedulerWritePending,
      schedulerWriteOldestWaitMs,
      schedulerWriteWaitP95Ms,
      activeStallOwner
    });
  };

  const resolveLaneBudgets = () => {
    const ultraLightWritesTotal = laneQueues.ultraLight.length + laneActive.ultraLight;
    const lightWritesTotal = laneQueues.light.length + laneActive.light;
    const mediumWritesTotal = laneQueues.heavy.length + laneActive.heavy;
    const largeWritesTotal = laneQueues.massive.length + laneActive.massive;
    const workClass = resolveArtifactWorkClassConcurrency({
      writeConcurrency: getActiveWriteConcurrency(),
      smallWrites: ultraLightWritesTotal + lightWritesTotal,
      mediumWrites: mediumWritesTotal,
      largeWrites: largeWritesTotal,
      smallConcurrencyOverride: workClassSmallConcurrencyOverride,
      mediumConcurrencyOverride: workClassMediumConcurrencyOverride,
      largeConcurrencyOverride: workClassLargeConcurrencyOverride,
      hostConcurrency
    });
    const smallBudget = Math.max(0, workClass.smallConcurrency);
    let ultraLightConcurrency = 0;
    let lightConcurrency = 0;
    if (smallBudget > 0) {
      if (ultraLightWritesTotal > 0) {
        const ultraReserve = Math.max(1, Math.min(2, smallBudget));
        ultraLightConcurrency = Math.min(ultraLightWritesTotal, ultraReserve);
      }
      const remainingAfterUltra = Math.max(0, smallBudget - ultraLightConcurrency);
      lightConcurrency = Math.min(lightWritesTotal, remainingAfterUltra);
      let remainingAfterLight = Math.max(0, smallBudget - ultraLightConcurrency - lightConcurrency);
      if (remainingAfterLight > 0 && lightWritesTotal > lightConcurrency) {
        const growLight = Math.min(remainingAfterLight, lightWritesTotal - lightConcurrency);
        lightConcurrency += growLight;
        remainingAfterLight -= growLight;
      }
      if (remainingAfterLight > 0 && ultraLightWritesTotal > ultraLightConcurrency) {
        ultraLightConcurrency += Math.min(remainingAfterLight, ultraLightWritesTotal - ultraLightConcurrency);
      }
    }
    return {
      ultraLightConcurrency,
      massiveConcurrency: workClass.largeConcurrency,
      lightConcurrency,
      heavyConcurrency: workClass.mediumConcurrency,
      workClass
    };
  };

  const pickDispatchLane = (budgets) => {
    const laneHasEligibleEntry = (laneName) => {
      const queue = Array.isArray(laneQueues?.[laneName]) ? laneQueues[laneName] : null;
      return Array.isArray(queue) && queue.some((entry) => canDispatchEntryUnderHugeWritePolicy(entry));
    };
    const ultraLightAvailable = laneActive.ultraLight < Math.max(0, budgets.ultraLightConcurrency)
      && laneHasEligibleEntry('ultraLight');
    const massiveAvailable = laneActive.massive < Math.max(0, budgets.massiveConcurrency)
      && laneHasEligibleEntry('massive');
    const lightAvailable = laneActive.light < Math.max(0, budgets.lightConcurrency)
      && laneHasEligibleEntry('light');
    const heavyAvailable = laneActive.heavy < Math.max(0, budgets.heavyConcurrency)
      && laneHasEligibleEntry('heavy');
    if (ultraLightAvailable) return 'ultraLight';
    if (massiveAvailable) return 'massive';
    if (heavyAvailable) return 'heavy';
    if (lightAvailable) return 'light';
    return null;
  };

  const takeLaneDispatchEntries = (laneName) => {
    const queue = Array.isArray(laneQueues?.[laneName]) ? laneQueues[laneName] : null;
    if (!queue || !queue.length) return [];
    if (laneName === 'ultraLight' && writeFsStrategy.microCoalescing) {
      const eligibleIndex = queue.findIndex((entry) => canDispatchEntryUnderHugeWritePolicy(entry));
      if (eligibleIndex < 0) return [];
      if (eligibleIndex === 0) {
        const batch = selectMicroWriteBatch(queue, {
          maxEntries: writeFsStrategy.microBatchMaxCount,
          maxBytes: writeFsStrategy.microBatchMaxBytes,
          maxEntryBytes: ultraLightWriteThresholdBytes
        });
        return Array.isArray(batch?.entries)
          ? batch.entries.filter((entry) => entry && canDispatchEntryUnderHugeWritePolicy(entry))
          : [];
      }
      const removed = queue.splice(eligibleIndex, 1);
      return removed[0] ? [removed[0]] : [];
    }
    const eligibleIndex = queue.findIndex((entry) => canDispatchEntryUnderHugeWritePolicy(entry));
    if (eligibleIndex < 0) return [];
    const removed = queue.splice(eligibleIndex, 1);
    const entry = removed[0];
    return entry ? [entry] : [];
  };

  const scheduleWriteJob = (fn, tokens) => {
    if (!scheduler?.schedule || typeof fn !== 'function') return fn();
    const schedulerTokens = {
      ...tokens,
      signal: effectiveAbortSignal
    };
    return scheduler.schedule(
      SCHEDULER_QUEUE_NAMES.stage2Write,
      schedulerTokens,
      fn
    );
  };

  const runSingleWrite = async (
    { label, job, estimatedBytes, enqueuedAt, prefetched, prefetchStartedAt, family, progressUnit, estimatedItems, familyCapability, exclusivePublisherFamily },
    laneName,
    { rescueBoost = false, tailWorker = false, batchSize = 1, batchIndex = 0 } = {}
  ) => {
    const activeLabel = label || '(unnamed artifact)';
    const dispatchStartedAt = Date.now();
    const started = resolveWriteStartTimestampMs(prefetchStartedAt, dispatchStartedAt);
    const queueDelayMs = Math.max(0, started - (Number(enqueuedAt) || started));
    const startedConcurrency = getActiveWriteConcurrency();
    const hugeWriteFamily = resolveHugeWriteFamily({
      label: activeLabel,
      family,
      progressUnit,
      estimatedItems,
      familyCapability,
      exclusivePublisherFamily,
      laneHint: laneName
    });
    const effectiveEstimatedBytes = resolveEntryEstimatedBytes({
      label: activeLabel,
      estimatedBytes,
      lane: laneName
    });
    const hugeWriteBytes = hugeWriteFamily ? effectiveEstimatedBytes : 0;
    activeWrites.set(activeLabel, started);
    activeWriteBytes.set(activeLabel, effectiveEstimatedBytes);
    const existingPhase = activeWriteMeta.get(activeLabel)?.phase;
    updateActiveWriteMeta(activeLabel, {
      phase: existingPhase || (prefetched ? 'prefetch-wait' : 'scheduler-wait'),
      lane: laneName,
      family,
      progressUnit,
      estimatedItems,
      exclusivePublisherFamily,
      hugeWriteFamily,
      rescueBoost: rescueBoost === true,
      tailWorker: tailWorker === true
    });
    if (hugeWriteFamily) {
      hugeWriteState.families.add(hugeWriteFamily);
      hugeWriteState.bytes += hugeWriteBytes;
    }
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
      updateActiveWriteMeta(activeLabel, {
        phase: prefetched ? 'prefetch-await' : 'write-execute'
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
          phaseTimings: writeResult?.phaseTimings && typeof writeResult.phaseTimings === 'object'
            ? writeResult.phaseTimings
            : null,
          directFdStreaming: writeResult?.directFdStreaming === true,
          tailRescueBoosted: rescueBoost === true,
          tailWorker: tailWorker === true,
          batchSize: batchSize > 1 ? batchSize : null,
          batchIndex: batchSize > 1 ? batchIndex + 1 : null,
          latencyClass,
          fsStrategyMode: writeFsStrategy.mode,
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
      activeWriteMeta.delete(activeLabel);
      if (hugeWriteFamily) {
        hugeWriteState.bytes = Math.max(0, hugeWriteState.bytes - hugeWriteBytes);
        const familyStillActive = Array.from(activeWriteMeta.values()).some(
          (meta) => meta?.hugeWriteFamily === hugeWriteFamily
        );
        if (!familyStillActive) {
          hugeWriteState.families.delete(hugeWriteFamily);
        }
      }
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

  const getSchedulerWriteQueueSnapshot = () => {
    const schedulerStats = scheduler?.stats ? scheduler.stats() : null;
    const schedulerWriteStats = schedulerStats?.queues?.[SCHEDULER_QUEUE_NAMES.stage2Write] || null;
    return {
      pending: Number(schedulerWriteStats?.pending),
      running: Number(schedulerWriteStats?.running),
      oldestWaitMs: Number(schedulerWriteStats?.oldestWaitMs),
      waitP95Ms: Number(schedulerWriteStats?.waitP95Ms)
    };
  };

  const schedulerWriteQueueHasWork = (snapshot = null) => {
    const effectiveSnapshot = snapshot || getSchedulerWriteQueueSnapshot();
    return (
      Number.isFinite(effectiveSnapshot.pending) && effectiveSnapshot.pending > 0
    ) || (
      Number.isFinite(effectiveSnapshot.running) && effectiveSnapshot.running > 0
    );
  };

  const waitForSchedulerWriteQueueDrain = async ({
    timeoutMs = 30_000,
    pollMs = 10,
    reason = 'artifact write closeout'
  } = {}) => {
    const startedAt = Date.now();
    let snapshot = getSchedulerWriteQueueSnapshot();
    while (schedulerWriteQueueHasWork(snapshot)) {
      if ((Date.now() - startedAt) >= timeoutMs) {
        throw new Error(
          `[artifact-write] scheduler queue did not drain during ${reason} ` +
          `(pending=${Number.isFinite(snapshot.pending) ? snapshot.pending : 'n/a'}, ` +
          `running=${Number.isFinite(snapshot.running) ? snapshot.running : 'n/a'}, ` +
          `oldestWaitMs=${Number.isFinite(snapshot.oldestWaitMs) ? snapshot.oldestWaitMs : 'n/a'}, ` +
          `waitP95Ms=${Number.isFinite(snapshot.waitP95Ms) ? snapshot.waitP95Ms : 'n/a'})`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      snapshot = getSchedulerWriteQueueSnapshot();
    }
  };

  const repairImpossibleIdleWriteState = () => {
    if (activeCount > 0 || inFlightWrites.size > 0) return false;
    const activeEntries = [...activeWriteBytes.entries()].map(([label, estimatedBytes]) => ({
      label,
      estimatedBytes,
      lane: activeWriteMeta.get(label)?.lane || null,
      phase: activeWriteMeta.get(label)?.phase || null
    }));
    let repaired = false;
    if (hugeWriteState.families.size > 0 || hugeWriteState.bytes > 0) {
      hugeWriteState.families.clear();
      hugeWriteState.bytes = 0;
      repaired = true;
    }
    if (activeEntries.length > 0) {
      activeWrites.clear();
      activeWriteBytes.clear();
      activeWriteMeta.clear();
      repaired = true;
    }
    for (const laneName of ['ultraLight', 'massive', 'light', 'heavy']) {
      if ((laneActive[laneName] || 0) > 0) {
        laneActive[laneName] = 0;
        repaired = true;
      }
    }
    if (repaired) {
      updateWriteInFlightTelemetry();
    }
    return repaired;
  };

  const dispatchWrites = () => {
    let dispatchedCount = 0;
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
      const schedulerStats = scheduler?.stats ? scheduler.stats() : null;
      const schedulerWriteStats = schedulerStats?.queues?.[SCHEDULER_QUEUE_NAMES.stage2Write] || null;
      const schedulerWritePending = Number(schedulerWriteStats?.pending);
      const schedulerWriteOldestWaitMs = Number(schedulerWriteStats?.oldestWaitMs);
      const schedulerWriteWaitP95Ms = Number(schedulerWriteStats?.waitP95Ms);
      const queueBackedUp = (
        Number.isFinite(schedulerWritePending)
        && schedulerWritePending >= adaptiveWriteQueuePendingThreshold
        && (
          (Number.isFinite(schedulerWriteOldestWaitMs)
            && schedulerWriteOldestWaitMs >= adaptiveWriteQueueOldestWaitMsThreshold)
          || (Number.isFinite(schedulerWriteWaitP95Ms)
            && schedulerWriteWaitP95Ms >= adaptiveWriteQueueWaitP95MsThreshold)
        )
      );
      const rescueState = resolveTailRescueState({ writeQueueBackedUp: queueBackedUp });
      const budgets = resolveLaneBudgets();
      let laneName = pickDispatchLane(budgets);
      let dispatchEntries = laneName ? takeLaneDispatchEntries(laneName) : [];
      let usedTailWorker = false;
      if (
        (!laneName || dispatchEntries.length === 0)
        && tailWorkerEligible
        && activeCount >= activeConcurrency
      ) {
        const tailSelection = selectTailWorkerWriteEntry(laneQueues, {
          laneOrder: ['massive', 'heavy', 'light', 'ultraLight'],
          canSelect: (entry) => canDispatchEntryUnderHugeWritePolicy(entry)
        });
        if (tailSelection?.entry) {
          laneName = tailSelection.laneName;
          dispatchEntries = [tailSelection.entry];
          usedTailWorker = true;
        }
      }
      if (!laneName || dispatchEntries.length === 0) break;
      dispatchedCount += dispatchEntries.length;
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
    return dispatchedCount;
  };

  writeHeartbeat.start();
  try {
    let undispatchableSince = null;
    dispatchWrites();
    while (
      inFlightWrites.size > 0
      || laneQueues.ultraLight.length > 0
      || laneQueues.massive.length > 0
      || laneQueues.light.length > 0
      || laneQueues.heavy.length > 0
    ) {
      if (fatalWriteError) break;
      if (!inFlightWrites.size) {
        const dispatchedCount = dispatchWrites();
        if (dispatchedCount <= 0) {
          const pendingWrites = pendingWriteCount();
          if (pendingWrites <= 0) break;
          if (repairImpossibleIdleWriteState()) {
            undispatchableSince = null;
            await Promise.resolve();
            continue;
          }
          const schedulerSnapshot = getSchedulerWriteQueueSnapshot();
          if (schedulerWriteQueueHasWork(schedulerSnapshot)) {
            undispatchableSince = null;
            await waitForSchedulerWriteQueueDrain({
              timeoutMs: 30_000,
              pollMs: 10,
              reason: 'artifact write scheduling gap'
            });
            dispatchWrites();
            continue;
          }
          const now = Date.now();
          if (undispatchableSince == null) {
            undispatchableSince = now;
          }
          if ((now - undispatchableSince) < 250) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            continue;
          }
          const budgets = resolveLaneBudgets();
          const stalledPreview = [
            ...laneQueues.ultraLight,
            ...laneQueues.massive,
            ...laneQueues.light,
            ...laneQueues.heavy
          ]
            .slice(0, 6)
            .map((entry) => String(entry?.label || '(unnamed artifact)'))
            .join(', ');
          throw new Error(
            `[artifact-write] queued writes became undispatchable without in-flight work ` +
            `(pending=${pendingWrites}, ` +
            `laneActive={ultraLight=${laneActive.ultraLight}, massive=${laneActive.massive}, light=${laneActive.light}, heavy=${laneActive.heavy}}, ` +
            `laneBudget={ultraLight=${budgets.ultraLightConcurrency}, massive=${budgets.massiveConcurrency}, light=${budgets.lightConcurrency}, heavy=${budgets.heavyConcurrency}}, ` +
            `hugeFamilies=${hugeWriteState.families.size > 0 ? Array.from(hugeWriteState.families).sort().join('+') : 'none'}, ` +
            `hugeBytes=${hugeWriteState.bytes}` +
            `${stalledPreview ? `, sample=${stalledPreview}` : ''})`
          );
        }
        undispatchableSince = null;
        if (!inFlightWrites.size) break;
      }
      let settleWatchdogTimer = null;
      const settleCandidates = Array.from(inFlightWrites);
      if (adaptiveWriteConcurrencyEnabled && adaptiveWriteObserveIntervalMs > 0) {
        settleCandidates.push(
          new Promise((resolve) => {
            settleWatchdogTimer = setTimeout(
              () => resolve({ ok: true, tick: true }),
              adaptiveWriteObserveIntervalMs
            );
          })
        );
      }
      const settled = await Promise.race(settleCandidates)
        .finally(() => {
          if (settleWatchdogTimer) {
            clearTimeout(settleWatchdogTimer);
            settleWatchdogTimer = null;
          }
        });
      if (settled?.tick) {
        dispatchWrites();
        continue;
      }
      if (!settled?.ok) {
        fatalWriteError = settled?.error || new Error('artifact write failed');
        break;
      }
      undispatchableSince = null;
      dispatchWrites();
    }
    if (fatalWriteError) {
      throw fatalWriteError;
    }
    await waitForSchedulerWriteQueueDrain({
      timeoutMs: 30_000,
      pollMs: 10,
      reason: 'artifact write final drain'
    });
  } finally {
    writeHeartbeat.stop();
    activeWriteBytes.clear();
    hugeWriteState.families.clear();
    hugeWriteState.bytes = 0;
    updateWriteInFlightTelemetry();
  }
};
