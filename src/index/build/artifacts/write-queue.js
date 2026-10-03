import { SCHEDULER_QUEUE_NAMES } from '../runtime/scheduler.js';
import { resolveEagerWriteSchedulerTokens } from './write-scheduler-tokens.js';
import {
  isValidationCriticalArtifact,
  shouldEagerStartArtifactWrite
} from './write-strategy.js';
import { resolveActiveWritePhaseLabel } from './write-telemetry.js';

/**
 * Resolve deterministic write ordering weight for batch scheduling.
 *
 * @param {object} entry
 * @returns {number}
 */
export const resolveWriteWeight = (entry) => {
  if (!entry || typeof entry !== 'object') return 0;
  let weight = Number.isFinite(entry.priority) ? entry.priority : 0;
  if (isValidationCriticalArtifact(entry.label)) {
    weight += 500;
  }
  if (weight > 0 && Number.isFinite(entry.estimatedBytes) && entry.estimatedBytes > 0) {
    weight += Math.log2(entry.estimatedBytes + 1);
  }
  return weight;
};

const normalizeLaneHint = (value) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (
    normalized === 'ultraLight'
    || normalized === 'light'
    || normalized === 'heavy'
    || normalized === 'massive'
  ) {
    return normalized;
  }
  return null;
};

const resolveEntryLaneHint = (entry) => {
  const explicitLane = normalizeLaneHint(entry?.laneHint);
  if (explicitLane) return explicitLane;
  return normalizeLaneHint(entry?.familyCapability?.laneHint);
};

/**
 * Return write entries ordered by scheduler weight then sequence.
 *
 * @param {object[]} entries
 * @returns {object[]}
 */
export const scheduleWrites = (entries) => (
  Array.isArray(entries)
    ? entries.slice().sort((a, b) => {
      const delta = resolveWriteWeight(b) - resolveWriteWeight(a);
      if (delta !== 0) return delta;
      const aSeq = Number.isFinite(a?.seq) ? a.seq : 0;
      const bSeq = Number.isFinite(b?.seq) ? b.seq : 0;
      return aSeq - bSeq;
    })
    : []
);

/**
 * Partition writes into lane classes used by the adaptive dispatcher.
 *
 * @param {object[]} entries
 * @param {{
 *   forcedMassiveWritePatterns?:RegExp[],
 *   forcedHeavyWritePatterns?:RegExp[],
 *   forcedUltraLightWritePatterns?:RegExp[],
 *   massiveWriteThresholdBytes?:number,
 *   heavyWriteThresholdBytes?:number,
 *   ultraLightWriteThresholdBytes?:number
 * }} [options]
 * @returns {{ultraLight:object[],massive:object[],light:object[],heavy:object[]}}
 */
export const splitWriteLanes = (entries, options = {}) => {
  const ordered = scheduleWrites(entries);
  const forcedMassiveWritePatterns = Array.isArray(options.forcedMassiveWritePatterns)
    ? options.forcedMassiveWritePatterns
    : [];
  const forcedHeavyWritePatterns = Array.isArray(options.forcedHeavyWritePatterns)
    ? options.forcedHeavyWritePatterns
    : [];
  const forcedUltraLightWritePatterns = Array.isArray(options.forcedUltraLightWritePatterns)
    ? options.forcedUltraLightWritePatterns
    : [];
  const massiveWriteThresholdBytes = Number.isFinite(Number(options.massiveWriteThresholdBytes))
    ? Number(options.massiveWriteThresholdBytes)
    : (128 * 1024 * 1024);
  const heavyWriteThresholdBytes = Number.isFinite(Number(options.heavyWriteThresholdBytes))
    ? Number(options.heavyWriteThresholdBytes)
    : (16 * 1024 * 1024);
  const ultraLightWriteThresholdBytes = Number.isFinite(Number(options.ultraLightWriteThresholdBytes))
    ? Number(options.ultraLightWriteThresholdBytes)
    : (64 * 1024);
  const lanes = {
    ultraLight: [],
    light: [],
    heavy: [],
    massive: []
  };
  for (const entry of ordered) {
    const estimated = Number(entry?.estimatedBytes);
    const label = typeof entry?.label === 'string' ? entry.label : '';
    const preferredLane = resolveEntryLaneHint(entry);
    const isForcedMassive = forcedMassiveWritePatterns.some((pattern) => pattern.test(label));
    const isForcedHeavy = forcedHeavyWritePatterns.some((pattern) => pattern.test(label));
    const isForcedUltraLight = forcedUltraLightWritePatterns.some((pattern) => pattern.test(label));
    const isMassiveBySize = Number.isFinite(estimated) && estimated >= massiveWriteThresholdBytes;
    const isHeavyBySize = Number.isFinite(estimated) && estimated >= heavyWriteThresholdBytes;
    const isUltraLightBySize = Number.isFinite(estimated)
      && estimated > 0
      && estimated <= ultraLightWriteThresholdBytes;
    if (preferredLane === 'massive' || isForcedMassive || isMassiveBySize) {
      lanes.massive.push(entry);
    } else if (preferredLane === 'heavy' || isForcedHeavy || isHeavyBySize) {
      lanes.heavy.push(entry);
    } else if (preferredLane === 'ultraLight' || isForcedUltraLight || isUltraLightBySize) {
      lanes.ultraLight.push(entry);
    } else {
      lanes.light.push(entry);
    }
  }
  return lanes;
};

/**
 * Build the stateful write-enqueue planner used by artifact publication.
 *
 * @param {object} input
 * @returns {{enqueueWrite:(label:string,job:Function,meta?:object)=>void,splitWriteLanes:(entries?:object[])=>object}}
 */
export const createQueuedArtifactWritePlanner = (input = {}) => {
  const writes = Array.isArray(input.writes) ? input.writes : [];
  const forcedMassiveWritePatterns = Array.isArray(input.forcedMassiveWritePatterns)
    ? input.forcedMassiveWritePatterns
    : [];
  const forcedHeavyWritePatterns = Array.isArray(input.forcedHeavyWritePatterns)
    ? input.forcedHeavyWritePatterns
    : [];
  const forcedUltraLightWritePatterns = Array.isArray(input.forcedUltraLightWritePatterns)
    ? input.forcedUltraLightWritePatterns
    : [];
  const massiveWriteThresholdBytes = Number.isFinite(Number(input.massiveWriteThresholdBytes))
    ? Number(input.massiveWriteThresholdBytes)
    : (128 * 1024 * 1024);
  const heavyWriteThresholdBytes = Number.isFinite(Number(input.heavyWriteThresholdBytes))
    ? Number(input.heavyWriteThresholdBytes)
    : (16 * 1024 * 1024);
  const ultraLightWriteThresholdBytes = Number.isFinite(Number(input.ultraLightWriteThresholdBytes))
    ? Number(input.ultraLightWriteThresholdBytes)
    : (64 * 1024);
  const scheduler = input.scheduler;
  const effectiveAbortSignal = input.effectiveAbortSignal ?? null;
  const hugeWriteInFlightBudgetBytes = Number.isFinite(Number(input.hugeWriteInFlightBudgetBytes))
    ? Number(input.hugeWriteInFlightBudgetBytes)
    : null;
  const massiveWriteIoTokens = Number.isFinite(Number(input.massiveWriteIoTokens))
    ? Number(input.massiveWriteIoTokens)
    : 0;
  const massiveWriteMemTokens = Number.isFinite(Number(input.massiveWriteMemTokens))
    ? Number(input.massiveWriteMemTokens)
    : 0;
  const resolveArtifactWriteMemTokens = typeof input.resolveArtifactWriteMemTokens === 'function'
    ? input.resolveArtifactWriteMemTokens
    : () => 0;
  const updateActiveWriteMeta = typeof input.updateActiveWriteMeta === 'function'
    ? input.updateActiveWriteMeta
    : () => {};
  const addPieceFile = typeof input.addPieceFile === 'function'
    ? input.addPieceFile
    : () => {};
  let enqueueSeq = 0;

  const enqueueWrite = (label, job, meta = {}) => {
    const parsedPriority = Number(meta?.priority);
    const priority = Number.isFinite(parsedPriority) ? parsedPriority : 0;
    const parsedEstimatedBytes = Number(meta?.estimatedBytes);
    const estimatedBytes = Number.isFinite(parsedEstimatedBytes) && parsedEstimatedBytes >= 0
      ? parsedEstimatedBytes
      : null;
    const laneHint = typeof meta?.laneHint === 'string' ? meta.laneHint : null;
    const phaseHint = typeof meta?.phaseHint === 'string' ? meta.phaseHint : null;
    const family = typeof meta?.family === 'string' && meta.family.trim()
      ? meta.family.trim()
      : null;
    const familyCapability = meta?.familyCapability && typeof meta.familyCapability === 'object'
      ? meta.familyCapability
      : null;
    const progressUnit = typeof meta?.progressUnit === 'string' && meta.progressUnit.trim()
      ? meta.progressUnit.trim()
      : null;
    const estimatedItems = Number.isFinite(Number(meta?.estimatedItems))
      ? Math.max(0, Math.floor(Number(meta.estimatedItems)))
      : null;
    const exclusivePublisherFamily = typeof meta?.exclusivePublisherFamily === 'string'
      && meta.exclusivePublisherFamily.trim()
      ? meta.exclusivePublisherFamily.trim()
      : null;
    const publishedPieces = Array.isArray(meta?.publishedPieces)
      ? meta.publishedPieces
        .filter((piece) => piece && typeof piece === 'object')
        .map((piece) => ({
          entry: piece.entry || null,
          filePath: piece.filePath || null
        }))
      : [];
    const onSuccess = typeof meta?.onSuccess === 'function' ? meta.onSuccess : null;
    const eagerStart = shouldEagerStartArtifactWrite({
      entry: {
        label,
        estimatedBytes,
        lane: laneHint,
        eagerStart: meta?.eagerStart === true
      },
      maxBytesInFlight: hugeWriteInFlightBudgetBytes
    });
    const trackedJob = typeof job === 'function'
      ? async () => {
        const setPhase = (phase) => {
          updateActiveWriteMeta(label, {
            phase: resolveActiveWritePhaseLabel(label, phase),
            lane: laneHint || null,
            family,
            progressUnit,
            estimatedItems,
            exclusivePublisherFamily
          });
        };
        updateActiveWriteMeta(label, {
          phase: resolveActiveWritePhaseLabel(label, phaseHint),
          lane: laneHint || null,
          family,
          progressUnit,
          estimatedItems,
          exclusivePublisherFamily
        });
        const result = await job({
          setPhase,
          label,
          estimatedBytes
        });
        if (typeof onSuccess === 'function') {
          await onSuccess(result);
        }
        for (const piece of publishedPieces) {
          if (!piece?.entry || !piece?.filePath) continue;
          addPieceFile(piece.entry, piece.filePath);
        }
        return result;
      }
      : job;
    let prefetched = null;
    let prefetchStartedAt = null;
    if (eagerStart && typeof trackedJob === 'function') {
      prefetchStartedAt = Date.now();
      const tokens = resolveEagerWriteSchedulerTokens({
        estimatedBytes,
        laneHint,
        massiveWriteIoTokens,
        massiveWriteMemTokens,
        resolveArtifactWriteMemTokens
      });
      const schedulerTokens = {
        ...tokens,
        signal: effectiveAbortSignal
      };
      prefetched = scheduler?.schedule
        ? scheduler.schedule(SCHEDULER_QUEUE_NAMES.stage2Write, schedulerTokens, trackedJob)
        : trackedJob();
      Promise.resolve(prefetched).catch(() => {});
    }
    writes.push({
      label,
      priority,
      estimatedBytes,
      laneHint,
      family,
      familyCapability,
      progressUnit,
      estimatedItems,
      exclusivePublisherFamily,
      eagerStart,
      prefetched,
      prefetchStartedAt,
      seq: enqueueSeq,
      enqueuedAt: Date.now(),
      job: trackedJob
    });
    enqueueSeq += 1;
  };

  return {
    enqueueWrite,
    splitWriteLanes: (entries = writes) => splitWriteLanes(entries, {
      forcedMassiveWritePatterns,
      forcedHeavyWritePatterns,
      forcedUltraLightWritePatterns,
      massiveWriteThresholdBytes,
      heavyWriteThresholdBytes,
      ultraLightWriteThresholdBytes
    })
  };
};
