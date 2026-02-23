import { resolveArtifactWriteConcurrency } from './write-concurrency.js';
import { splitScheduledArtifactWriteLanes } from './write-lane-planning.js';
import { createAdaptiveWriteConcurrencyController } from './write-strategy.js';
import { drainArtifactWriteQueues } from './write-execution.js';

/**
 * Resolve initial adaptive write concurrency before controller clamping.
 *
 * Contract:
 * - explicit `adaptiveWriteStartConcurrencyOverride` always wins
 * - explicit `writeConcurrency` override starts at full cap
 * - default starts near 60% of cap but never below `adaptiveWriteMinConcurrency`
 *
 * @param {object} input
 * @param {boolean} input.adaptiveWriteConcurrencyEnabled
 * @param {number} input.writeConcurrency
 * @param {number} input.adaptiveWriteMinConcurrency
 * @param {number|null} [input.adaptiveWriteStartConcurrencyOverride]
 * @param {boolean} [input.writeConcurrencyOverride]
 * @returns {number}
 */
export const resolveAdaptiveWriteInitialConcurrency = ({
  adaptiveWriteConcurrencyEnabled,
  writeConcurrency,
  adaptiveWriteMinConcurrency,
  adaptiveWriteStartConcurrencyOverride = null,
  writeConcurrencyOverride = false
}) => {
  const writeCap = Math.max(1, Math.floor(Number(writeConcurrency) || 1));
  const adaptiveMin = Math.max(1, Math.floor(Number(adaptiveWriteMinConcurrency) || 1));
  if (!adaptiveWriteConcurrencyEnabled) return writeCap;
  return (
    adaptiveWriteStartConcurrencyOverride
    || (writeConcurrencyOverride
      ? writeCap
      : Math.max(adaptiveMin, Math.ceil(writeCap * 0.6)))
  );
};

/**
 * Count all queued writes across dispatch lanes.
 *
 * @param {{ultraLight:object[],massive:object[],light:object[],heavy:object[]}} laneWrites
 * @returns {number}
 */
const countLaneWrites = (laneWrites) => (
  laneWrites.ultraLight.length
  + laneWrites.massive.length
  + laneWrites.light.length
  + laneWrites.heavy.length
);

/**
 * Dispatch scheduled artifact writes with deterministic lane ordering.
 *
 * Determinism contract:
 * - lane queues inherit stable scheduling order from `splitScheduledArtifactWriteLanes`
 *   (weight first, enqueue `seq` tie-break)
 * - dispatch drains each lane FIFO via `drainArtifactWriteQueues`
 *
 * Concurrency contract:
 * - global `writeConcurrency` never exceeds `totalWrites` or resolved cap
 * - adaptive controller starts from `resolveAdaptiveWriteInitialConcurrency`
 *   and may only adjust within controller min/max bounds
 *
 * @param {object} input
 * @param {object[]} input.writes
 * @param {object} input.artifactConfig
 * @param {number} input.heavyWriteThresholdBytes
 * @param {number} input.ultraLightWriteThresholdBytes
 * @param {number} input.massiveWriteThresholdBytes
 * @param {RegExp[]} input.forcedHeavyWritePatterns
 * @param {RegExp[]} input.forcedUltraLightWritePatterns
 * @param {RegExp[]} input.forcedMassiveWritePatterns
 * @param {boolean} input.adaptiveWriteConcurrencyEnabled
 * @param {number} input.adaptiveWriteMinConcurrency
 * @param {number|null} [input.adaptiveWriteStartConcurrencyOverride]
 * @param {number} input.adaptiveWriteScaleUpBacklogPerSlot
 * @param {number} input.adaptiveWriteScaleDownBacklogPerSlot
 * @param {number} input.adaptiveWriteStallScaleDownSeconds
 * @param {number} input.adaptiveWriteStallScaleUpGuardSeconds
 * @param {number} input.adaptiveWriteScaleUpCooldownMs
 * @param {number} input.adaptiveWriteScaleDownCooldownMs
 * @param {object|null} [input.scheduler]
 * @param {string} input.outDir
 * @param {object} input.writeFsStrategy
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
 * @param {(input:object)=>{ultraLight:object[],massive:object[],light:object[],heavy:object[]}} [input.splitLanes]
 * @param {(input:object)=>{cap:number,override:boolean}} [input.resolveWriteConcurrency]
 * @param {(input:object)=>{observe:(snapshot?:object)=>number,getCurrentConcurrency:()=>number}} [input.createWriteConcurrencyController]
 * @param {(input:object)=>Promise<void>} [input.drainWrites]
 * @returns {Promise<{totalWrites:number,writeConcurrency:number,laneWrites:{ultraLight:object[],massive:object[],light:object[],heavy:object[]}}>}
 */
export const dispatchScheduledArtifactWrites = async ({
  writes,
  artifactConfig,
  heavyWriteThresholdBytes,
  ultraLightWriteThresholdBytes,
  massiveWriteThresholdBytes,
  forcedHeavyWritePatterns,
  forcedUltraLightWritePatterns,
  forcedMassiveWritePatterns,
  adaptiveWriteConcurrencyEnabled,
  adaptiveWriteMinConcurrency,
  adaptiveWriteStartConcurrencyOverride = null,
  adaptiveWriteScaleUpBacklogPerSlot,
  adaptiveWriteScaleDownBacklogPerSlot,
  adaptiveWriteStallScaleDownSeconds,
  adaptiveWriteStallScaleUpGuardSeconds,
  adaptiveWriteScaleUpCooldownMs,
  adaptiveWriteScaleDownCooldownMs,
  scheduler = null,
  outDir,
  writeFsStrategy,
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
  logLine,
  splitLanes = splitScheduledArtifactWriteLanes,
  resolveWriteConcurrency = resolveArtifactWriteConcurrency,
  createWriteConcurrencyController = createAdaptiveWriteConcurrencyController,
  drainWrites = drainArtifactWriteQueues
}) => {
  const laneWrites = splitLanes({
    entries: writes,
    heavyWriteThresholdBytes,
    ultraLightWriteThresholdBytes,
    massiveWriteThresholdBytes,
    forcedHeavyWritePatterns,
    forcedUltraLightWritePatterns,
    forcedMassiveWritePatterns
  });
  const totalWrites = countLaneWrites(laneWrites);
  if (!totalWrites) {
    logLine('Writing index files (0 artifacts)...', { kind: 'status' });
    logLine('', { kind: 'status' });
    return {
      totalWrites: 0,
      writeConcurrency: 0,
      laneWrites
    };
  }
  const artifactLabel = totalWrites === 1 ? 'artifact' : 'artifacts';
  logLine(`Writing index files (${totalWrites} ${artifactLabel})...`, { kind: 'status' });
  const { cap: writeConcurrencyCap, override: writeConcurrencyOverride } = resolveWriteConcurrency({
    artifactConfig,
    totalWrites
  });
  const writeConcurrency = Math.max(1, Math.min(totalWrites, writeConcurrencyCap));
  const adaptiveWriteInitialConcurrency = resolveAdaptiveWriteInitialConcurrency({
    adaptiveWriteConcurrencyEnabled,
    writeConcurrency,
    adaptiveWriteMinConcurrency,
    adaptiveWriteStartConcurrencyOverride,
    writeConcurrencyOverride
  });
  const writeConcurrencyController = createWriteConcurrencyController({
    maxConcurrency: writeConcurrency,
    minConcurrency: adaptiveWriteMinConcurrency,
    initialConcurrency: adaptiveWriteInitialConcurrency,
    scaleUpBacklogPerSlot: adaptiveWriteScaleUpBacklogPerSlot,
    scaleDownBacklogPerSlot: adaptiveWriteScaleDownBacklogPerSlot,
    stallScaleDownSeconds: adaptiveWriteStallScaleDownSeconds,
    stallScaleUpGuardSeconds: adaptiveWriteStallScaleUpGuardSeconds,
    scaleUpCooldownMs: adaptiveWriteScaleUpCooldownMs,
    scaleDownCooldownMs: adaptiveWriteScaleDownCooldownMs,
    onChange: ({
      reason,
      from,
      to,
      pendingWrites,
      longestStallSec,
      memoryPressure,
      gcPressure,
      rssUtilization
    }) => {
      const stallSuffix = longestStallSec > 0 ? `, stall=${longestStallSec}s` : '';
      const memorySuffix = (
        Number.isFinite(memoryPressure) || Number.isFinite(gcPressure) || Number.isFinite(rssUtilization)
      )
        ? `, mem=${Number.isFinite(memoryPressure) ? memoryPressure.toFixed(2) : 'n/a'},` +
          ` gc=${Number.isFinite(gcPressure) ? gcPressure.toFixed(2) : 'n/a'},` +
          ` rss=${Number.isFinite(rssUtilization) ? rssUtilization.toFixed(2) : 'n/a'}`
        : '';
      logLine(
        `[perf] adaptive artifact write concurrency ${from} -> ${to} ` +
        `(${reason}, pending=${pendingWrites}${stallSuffix}${memorySuffix})`,
        { kind: 'status' }
      );
    }
  });
  await drainWrites({
    scheduler,
    outDir,
    laneWrites: {
      ultraLight: laneWrites.ultraLight,
      massive: laneWrites.massive,
      light: laneWrites.light,
      heavy: laneWrites.heavy
    },
    writeFsStrategy,
    ultraLightWriteThresholdBytes,
    writeConcurrency,
    adaptiveWriteConcurrencyEnabled,
    writeConcurrencyController,
    workClassSmallConcurrencyOverride,
    workClassMediumConcurrencyOverride,
    workClassLargeConcurrencyOverride,
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
  });
  logLine('', { kind: 'status' });
  return {
    totalWrites,
    writeConcurrency,
    laneWrites
  };
};
