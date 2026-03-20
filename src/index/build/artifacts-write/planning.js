import os from 'node:os';

import { resolveArtifactWriteConcurrency } from '../artifacts/write-concurrency.js';
import { createAdaptiveWriteConcurrencyController } from '../artifacts/write-strategy.js';
import { dispatchArtifactWrites } from '../artifacts/write-dispatch.js';

export const resolveQueuedWriteLanes = ({ writes, splitWriteLanes }) => {
  const {
    ultraLight: ultraLightWrites,
    massive: massiveWrites,
    light: lightWrites,
    heavy: heavyWrites
  } = splitWriteLanes(writes);
  return {
    laneQueues: {
      ultraLight: ultraLightWrites.slice(),
      massive: massiveWrites.slice(),
      light: lightWrites.slice(),
      heavy: heavyWrites.slice()
    },
    totalWrites: ultraLightWrites.length + massiveWrites.length + lightWrites.length + heavyWrites.length
  };
};

export const dispatchPlannedArtifactWrites = async ({
  laneQueues,
  totalWrites,
  logLine,
  artifactConfig,
  writeFsStrategy,
  adaptiveWriteConcurrencyEnabled,
  adaptiveWriteMinConcurrency,
  adaptiveWriteStartConcurrencyOverride,
  adaptiveWriteScaleUpBacklogPerSlot,
  adaptiveWriteScaleDownBacklogPerSlot,
  adaptiveWriteStallScaleDownSeconds,
  adaptiveWriteStallScaleUpGuardSeconds,
  adaptiveWriteScaleUpCooldownMs,
  adaptiveWriteScaleDownCooldownMs,
  adaptiveWriteObserveIntervalMs,
  adaptiveWriteQueuePendingThreshold,
  adaptiveWriteQueueOldestWaitMsThreshold,
  adaptiveWriteQueueWaitP95MsThreshold,
  writeTailWorkerEnabled,
  writeTailWorkerMaxPending,
  writeTailRescueEnabled,
  writeTailRescueMaxPending,
  writeTailRescueStallSeconds,
  writeTailRescueBoostIoTokens,
  writeTailRescueBoostMemTokens,
  workClassSmallConcurrencyOverride,
  workClassMediumConcurrencyOverride,
  workClassLargeConcurrencyOverride,
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
  logWriteProgress,
  writeHeartbeat,
  ultraLightWriteThresholdBytes,
  hostConcurrency = (typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : (Array.isArray(os.cpus()) ? os.cpus().length : 1))
} = {}) => {
  if (!totalWrites) {
    logLine('Writing index files (0 artifacts)...', { kind: 'status' });
    logLine('', { kind: 'status' });
    return;
  }

  const artifactLabel = totalWrites === 1 ? 'artifact' : 'artifacts';
  logLine(`Writing index files (${totalWrites} ${artifactLabel})...`, { kind: 'status' });
  const { cap: writeConcurrencyCap, override: writeConcurrencyOverride } = resolveArtifactWriteConcurrency({
    artifactConfig,
    totalWrites
  });
  const writeConcurrency = Math.max(1, Math.min(totalWrites, writeConcurrencyCap));
  const adaptiveWriteInitialConcurrency = adaptiveWriteConcurrencyEnabled
    ? (
      adaptiveWriteStartConcurrencyOverride
      || (writeConcurrencyOverride
        ? writeConcurrency
        : Math.max(adaptiveWriteMinConcurrency, Math.ceil(writeConcurrency * 0.6)))
    )
    : writeConcurrency;
  const writeConcurrencyController = createAdaptiveWriteConcurrencyController({
    maxConcurrency: writeConcurrency,
    minConcurrency: adaptiveWriteMinConcurrency,
    initialConcurrency: adaptiveWriteInitialConcurrency,
    scaleUpBacklogPerSlot: adaptiveWriteScaleUpBacklogPerSlot,
    scaleDownBacklogPerSlot: adaptiveWriteScaleDownBacklogPerSlot,
    stallScaleDownSeconds: adaptiveWriteStallScaleDownSeconds,
    stallScaleUpGuardSeconds: adaptiveWriteStallScaleUpGuardSeconds,
    scaleUpCooldownMs: adaptiveWriteScaleUpCooldownMs,
    scaleDownCooldownMs: adaptiveWriteScaleDownCooldownMs,
    writeQueuePendingThreshold: adaptiveWriteQueuePendingThreshold,
    writeQueueOldestWaitMsThreshold: adaptiveWriteQueueOldestWaitMsThreshold,
    writeQueueWaitP95MsThreshold: adaptiveWriteQueueWaitP95MsThreshold,
    onChange: ({
      reason,
      from,
      to,
      pendingWrites,
      longestStallSec,
      memoryPressure,
      gcPressure,
      rssUtilization,
      schedulerWritePending,
      schedulerWriteOldestWaitMs,
      schedulerWriteWaitP95Ms,
      stallAttribution
    }) => {
      const stallSuffix = longestStallSec > 0 ? `, stall=${longestStallSec}s` : '';
      const memorySuffix = (
        Number.isFinite(memoryPressure) || Number.isFinite(gcPressure) || Number.isFinite(rssUtilization)
      )
        ? `, mem=${Number.isFinite(memoryPressure) ? memoryPressure.toFixed(2) : 'n/a'},`
          + ` gc=${Number.isFinite(gcPressure) ? gcPressure.toFixed(2) : 'n/a'},`
          + ` rss=${Number.isFinite(rssUtilization) ? rssUtilization.toFixed(2) : 'n/a'}`
        : '';
      const schedulerSuffix = (
        Number.isFinite(schedulerWritePending)
        || Number.isFinite(schedulerWriteOldestWaitMs)
        || Number.isFinite(schedulerWriteWaitP95Ms)
      )
        ? `, writeQ={pending=${Number.isFinite(schedulerWritePending) ? schedulerWritePending : 'n/a'},`
          + ` oldest=${Number.isFinite(schedulerWriteOldestWaitMs) ? schedulerWriteOldestWaitMs : 'n/a'}ms,`
          + ` p95=${Number.isFinite(schedulerWriteWaitP95Ms) ? schedulerWriteWaitP95Ms : 'n/a'}ms}`
        : '';
      const stallAttributionSuffix = (
        reason === 'stall' || (typeof stallAttribution === 'string' && stallAttribution === 'non-write')
      )
        ? `, attribution=${stallAttribution || 'unknown'}`
        : '';
      logLine(
        `[perf] adaptive artifact write concurrency ${from} -> ${to} `
          + `(${reason}, pending=${pendingWrites}${stallSuffix}${memorySuffix}`
          + `${schedulerSuffix}${stallAttributionSuffix})`,
        { kind: 'status' }
      );
    }
  });

  await dispatchArtifactWrites({
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
  });
  logLine('', { kind: 'status' });
};
