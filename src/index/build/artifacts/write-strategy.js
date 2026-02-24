import { clampWriteConcurrency } from './lane-policy.js';

const LARGE_ARTIFACT_WRITE_BYTES = 256 * 1024 * 1024;
const HUGE_ARTIFACT_WRITE_BYTES = 768 * 1024 * 1024;
const ARTIFACT_QUEUE_DELAY_BUCKETS_MS = Object.freeze([
  0,
  1,
  2,
  4,
  8,
  16,
  32,
  64,
  128,
  256,
  512,
  1000,
  2000,
  5000,
  10000,
  30000,
  60000
]);
const ARTIFACT_LATENCY_CLASSES = Object.freeze([
  { maxMs: 64, name: 'instant' },
  { maxMs: 256, name: 'fast' },
  { maxMs: 1000, name: 'steady' },
  { maxMs: 4000, name: 'slow' }
]);
const ARTIFACT_SIZE_CLASSES = Object.freeze([
  { maxBytes: 64 * 1024, name: 'micro' },
  { maxBytes: 1024 * 1024, name: 'small' },
  { maxBytes: 16 * 1024 * 1024, name: 'medium' },
  { maxBytes: 128 * 1024 * 1024, name: 'large' }
]);
const VALIDATION_CRITICAL_ARTIFACT_PATTERNS = Object.freeze([
  /(^|\/)index_state\.json$/,
  /(^|\/)metrics\.json$/,
  /(^|\/)chunk_meta(?:\.|$)/,
  /(^|\/)file_meta(?:\.|$)/,
  /(^|\/)token_postings(?:\.|$)/,
  /(^|\/)field_postings(?:\.|$)/,
  /(^|\/)pieces\/manifest\.json$/
]);

/**
 * Resolve an upper percentile from sorted millisecond samples.
 *
 * @param {number[]} samples
 * @param {number} ratio
 * @returns {number}
 */
const resolvePercentileMs = (samples, ratio) => {
  if (!Array.isArray(samples) || !samples.length) return 0;
  if (!Number.isFinite(ratio)) return samples[0];
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const index = Math.min(samples.length - 1, Math.max(0, Math.ceil(clampedRatio * samples.length) - 1));
  return samples[index];
};

/**
 * Coerce optional numeric config to strictly positive number.
 *
 * @param {unknown} value
 * @param {number|null} [fallback=null]
 * @returns {number|null}
 */
const resolveOptionalPositiveNumber = (value, fallback = null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

/**
 * Resolve observed artifact-write throughput from perf profile variants.
 *
 * @param {object} perfProfile
 * @returns {number|null}
 */
export const resolveArtifactWriteThroughputProfile = (perfProfile) => {
  const candidates = [
    perfProfile?.indexOptimizationProfile?.artifactWrite?.throughputBytesPerSec,
    perfProfile?.indexOptimizationProfile?.artifactWriteThroughputBytesPerSec,
    perfProfile?.artifactWrite?.throughputBytesPerSec,
    perfProfile?.artifactWriteThroughputBytesPerSec,
    perfProfile?.storage?.writeBytesPerSec
  ];
  for (const candidate of candidates) {
    const throughput = resolveOptionalPositiveNumber(candidate, null);
    if (throughput != null) return throughput;
  }
  return null;
};

/**
 * Normalize filesystem write strategy mode selector.
 *
 * @param {unknown} value
 * @returns {'auto'|'ntfs'|'generic'}
 */
const normalizeStrategyMode = (value) => {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : 'auto';
  if (mode === 'ntfs' || mode === 'generic' || mode === 'auto') return mode;
  return 'auto';
};

/**
 * Coerce optional value to non-negative finite number.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
const toNonNegativeNumberOrNull = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

const resolveArtifactWriteSizeClass = (metric = {}) => {
  const bytes = toNonNegativeNumberOrNull(metric?.bytes) ?? toNonNegativeNumberOrNull(metric?.estimatedBytes);
  if (bytes == null) return 'unknown';
  for (const threshold of ARTIFACT_SIZE_CLASSES) {
    if (bytes <= threshold.maxBytes) return threshold.name;
  }
  return 'huge';
};

/**
 * Build deterministic candidate comparator for tail-worker queue selection.
 *
 * @param {string[]} laneOrder
 * @returns {(left:object,right:object)=>number}
 */
const resolveTailWorkerComparator = (laneOrder) => {
  const order = Array.isArray(laneOrder) && laneOrder.length
    ? laneOrder
    : ['massive', 'heavy', 'light', 'ultraLight'];
  const rankByLane = new Map(order.map((laneName, index) => [laneName, index]));
  return (left, right) => {
    const leftEstimated = toNonNegativeNumberOrNull(left?.entry?.estimatedBytes);
    const rightEstimated = toNonNegativeNumberOrNull(right?.entry?.estimatedBytes);
    if (leftEstimated != null && rightEstimated != null && leftEstimated !== rightEstimated) {
      return rightEstimated - leftEstimated;
    }
    if (leftEstimated != null && rightEstimated == null) return -1;
    if (leftEstimated == null && rightEstimated != null) return 1;
    const leftPriority = Number.isFinite(Number(left?.entry?.priority))
      ? Number(left.entry.priority)
      : 0;
    const rightPriority = Number.isFinite(Number(right?.entry?.priority))
      ? Number(right.entry.priority)
      : 0;
    if (leftPriority !== rightPriority) return rightPriority - leftPriority;
    const leftLaneRank = rankByLane.has(left?.laneName) ? rankByLane.get(left.laneName) : Number.MAX_SAFE_INTEGER;
    const rightLaneRank = rankByLane.has(right?.laneName) ? rankByLane.get(right.laneName) : Number.MAX_SAFE_INTEGER;
    if (leftLaneRank !== rightLaneRank) return leftLaneRank - rightLaneRank;
    const leftSeq = Number.isFinite(Number(left?.entry?.seq)) ? Number(left.entry.seq) : Number.MAX_SAFE_INTEGER;
    const rightSeq = Number.isFinite(Number(right?.entry?.seq)) ? Number(right.entry.seq) : Number.MAX_SAFE_INTEGER;
    if (leftSeq !== rightSeq) return leftSeq - rightSeq;
    const leftLabel = typeof left?.entry?.label === 'string' ? left.entry.label : '';
    const rightLabel = typeof right?.entry?.label === 'string' ? right.entry.label : '';
    return leftLabel.localeCompare(rightLabel);
  };
};

/**
 * Determine whether a queue entry can be coalesced into micro-write batches.
 *
 * @param {object} entry
 * @param {number} maxEntryBytes
 * @returns {boolean}
 */
const isMicroCoalescibleWrite = (entry, maxEntryBytes) => {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.prefetched) return false;
  if (typeof entry.job !== 'function') return false;
  const estimatedBytes = toNonNegativeNumberOrNull(entry.estimatedBytes);
  if (estimatedBytes == null || estimatedBytes <= 0) return false;
  return estimatedBytes <= Math.max(1024, Math.floor(Number(maxEntryBytes) || 0));
};

/**
 * Adaptive write-concurrency controller for artifact writes.
 *
 * Concurrency scales up with backlog pressure and scales down when write stalls
 * are sustained, replacing fixed-cap behavior during long write tails.
 *
 * @param {object} input
 * @param {number} input.maxConcurrency
 * @param {number} [input.minConcurrency]
 * @param {number|null} [input.initialConcurrency]
 * @param {number} [input.scaleUpBacklogPerSlot]
 * @param {number} [input.scaleDownBacklogPerSlot]
 * @param {number} [input.stallScaleDownSeconds]
 * @param {number} [input.stallScaleUpGuardSeconds]
 * @param {number} [input.scaleUpCooldownMs]
 * @param {number} [input.scaleDownCooldownMs]
 * @param {number} [input.memoryPressureHighThreshold]
 * @param {number} [input.memoryPressureLowThreshold]
 * @param {number} [input.gcPressureHighThreshold]
 * @param {number} [input.gcPressureLowThreshold]
 * @param {number} [input.writeQueuePendingThreshold]
 * @param {number} [input.writeQueueOldestWaitMsThreshold]
 * @param {number} [input.writeQueueWaitP95MsThreshold]
 * @param {() => number} [input.now]
 * @param {(event:{reason:string,from:number,to:number,pendingWrites:number,activeWrites:number,longestStallSec:number,memoryPressure:number|null,gcPressure:number|null,rssUtilization:number|null,schedulerWritePending:number|null,schedulerWriteOldestWaitMs:number|null,schedulerWriteWaitP95Ms:number|null,stallAttribution:string}) => void} [input.onChange]
 * @returns {{observe:(snapshot?:{pendingWrites?:number,activeWrites?:number,longestStallSec?:number,memoryPressure?:number|null,gcPressure?:number|null,rssUtilization?:number|null,schedulerWritePending?:number|null,schedulerWriteOldestWaitMs?:number|null,schedulerWriteWaitP95Ms?:number|null})=>number,getCurrentConcurrency:()=>number,getLimits:()=>{min:number,max:number}}}
 */
export const createAdaptiveWriteConcurrencyController = (input = {}) => {
  const maxConcurrency = clampWriteConcurrency(input.maxConcurrency, 1);
  const minConcurrency = Math.min(
    maxConcurrency,
    clampWriteConcurrency(input.minConcurrency, 1)
  );
  const initialFallback = Math.max(
    minConcurrency,
    Math.min(maxConcurrency, Math.ceil(maxConcurrency * 0.6))
  );
  let currentConcurrency = clampWriteConcurrency(input.initialConcurrency, initialFallback);
  currentConcurrency = Math.max(minConcurrency, Math.min(maxConcurrency, currentConcurrency));
  const scaleUpBacklogPerSlot = Number.isFinite(Number(input.scaleUpBacklogPerSlot))
    ? Math.max(1, Number(input.scaleUpBacklogPerSlot))
    : 1.75;
  const scaleDownBacklogPerSlot = Number.isFinite(Number(input.scaleDownBacklogPerSlot))
    ? Math.max(0, Number(input.scaleDownBacklogPerSlot))
    : 0.5;
  const stallScaleDownSeconds = Number.isFinite(Number(input.stallScaleDownSeconds))
    ? Math.max(1, Math.floor(Number(input.stallScaleDownSeconds)))
    : 20;
  const stallScaleUpGuardSeconds = Number.isFinite(Number(input.stallScaleUpGuardSeconds))
    ? Math.max(1, Math.floor(Number(input.stallScaleUpGuardSeconds)))
    : 8;
  const scaleUpCooldownMs = Number.isFinite(Number(input.scaleUpCooldownMs))
    ? Math.max(0, Math.floor(Number(input.scaleUpCooldownMs)))
    : 400;
  const scaleDownCooldownMs = Number.isFinite(Number(input.scaleDownCooldownMs))
    ? Math.max(0, Math.floor(Number(input.scaleDownCooldownMs)))
    : 1200;
  const memoryPressureHighThreshold = Number.isFinite(Number(input.memoryPressureHighThreshold))
    ? Math.max(0, Math.min(1, Number(input.memoryPressureHighThreshold)))
    : 0.9;
  const memoryPressureLowThreshold = Number.isFinite(Number(input.memoryPressureLowThreshold))
    ? Math.max(0, Math.min(memoryPressureHighThreshold, Number(input.memoryPressureLowThreshold)))
    : 0.62;
  const gcPressureHighThreshold = Number.isFinite(Number(input.gcPressureHighThreshold))
    ? Math.max(0, Math.min(1, Number(input.gcPressureHighThreshold)))
    : 0.4;
  const gcPressureLowThreshold = Number.isFinite(Number(input.gcPressureLowThreshold))
    ? Math.max(0, Math.min(gcPressureHighThreshold, Number(input.gcPressureLowThreshold)))
    : 0.2;
  const writeQueuePendingThreshold = Number.isFinite(Number(input.writeQueuePendingThreshold))
    ? Math.max(1, Math.floor(Number(input.writeQueuePendingThreshold)))
    : 1;
  const writeQueueOldestWaitMsThreshold = Number.isFinite(Number(input.writeQueueOldestWaitMsThreshold))
    ? Math.max(1, Math.floor(Number(input.writeQueueOldestWaitMsThreshold)))
    : 1200;
  const writeQueueWaitP95MsThreshold = Number.isFinite(Number(input.writeQueueWaitP95MsThreshold))
    ? Math.max(1, Math.floor(Number(input.writeQueueWaitP95MsThreshold)))
    : 750;
  const now = typeof input.now === 'function' ? input.now : () => Date.now();
  const onChange = typeof input.onChange === 'function' ? input.onChange : null;

  let lastScaleUpAt = Number.NEGATIVE_INFINITY;
  let lastScaleDownAt = Number.NEGATIVE_INFINITY;

  const emitChange = (reason, from, to, snapshot) => {
    if (!onChange || from === to) return;
    onChange({
      reason,
      from,
      to,
      pendingWrites: snapshot.pendingWrites,
      activeWrites: snapshot.activeWrites,
      longestStallSec: snapshot.longestStallSec,
      memoryPressure: snapshot.memoryPressure,
      gcPressure: snapshot.gcPressure,
      rssUtilization: snapshot.rssUtilization,
      schedulerWritePending: snapshot.schedulerWritePending,
      schedulerWriteOldestWaitMs: snapshot.schedulerWriteOldestWaitMs,
      schedulerWriteWaitP95Ms: snapshot.schedulerWriteWaitP95Ms,
      stallAttribution: snapshot.stallAttribution
    });
  };

  const observe = (snapshot = {}) => {
    const pendingWrites = Math.max(0, Math.floor(Number(snapshot.pendingWrites) || 0));
    const activeWrites = Math.max(0, Math.floor(Number(snapshot.activeWrites) || 0));
    const longestStallSec = Number.isFinite(Number(snapshot.longestStallSec))
      ? Math.max(0, Number(snapshot.longestStallSec))
      : 0;
    const memoryPressure = Number.isFinite(Number(snapshot.memoryPressure))
      ? Math.max(0, Math.min(1, Number(snapshot.memoryPressure)))
      : null;
    const gcPressure = Number.isFinite(Number(snapshot.gcPressure))
      ? Math.max(0, Math.min(1, Number(snapshot.gcPressure)))
      : null;
    const rssUtilization = Number.isFinite(Number(snapshot.rssUtilization))
      ? Math.max(0, Math.min(1, Number(snapshot.rssUtilization)))
      : null;
    const schedulerWritePending = Number.isFinite(Number(snapshot.schedulerWritePending))
      ? Math.max(0, Math.floor(Number(snapshot.schedulerWritePending)))
      : null;
    const schedulerWriteOldestWaitMs = Number.isFinite(Number(snapshot.schedulerWriteOldestWaitMs))
      ? Math.max(0, Math.floor(Number(snapshot.schedulerWriteOldestWaitMs)))
      : null;
    const schedulerWriteWaitP95Ms = Number.isFinite(Number(snapshot.schedulerWriteWaitP95Ms))
      ? Math.max(0, Math.floor(Number(snapshot.schedulerWriteWaitP95Ms)))
      : null;
    const hasSchedulerWriteSignals = (
      schedulerWritePending != null
      || schedulerWriteOldestWaitMs != null
      || schedulerWriteWaitP95Ms != null
    );
    const attributedToWriteQueue = hasSchedulerWriteSignals
      ? (
        (schedulerWritePending != null && schedulerWritePending >= writeQueuePendingThreshold)
        && (
          (schedulerWriteOldestWaitMs != null && schedulerWriteOldestWaitMs >= writeQueueOldestWaitMsThreshold)
          || (schedulerWriteWaitP95Ms != null && schedulerWriteWaitP95Ms >= writeQueueWaitP95MsThreshold)
        )
      )
      : (
        pendingWrites > 0
        && activeWrites >= Math.max(1, currentConcurrency - 1)
      );
    const stallAttribution = (
      longestStallSec <= 0
        ? 'none'
        : (
          attributedToWriteQueue
            ? 'write-queue'
            : (hasSchedulerWriteSignals ? 'non-write' : 'unknown')
        )
    );
    const nowValue = now();
    const timestamp = Number.isFinite(Number(nowValue)) ? Number(nowValue) : Date.now();
    const backlogPerSlot = pendingWrites / Math.max(1, currentConcurrency);
    const from = currentConcurrency;
    const highMemoryPressure = (
      (memoryPressure != null && memoryPressure >= memoryPressureHighThreshold)
      || (gcPressure != null && gcPressure >= gcPressureHighThreshold)
      || (rssUtilization != null && rssUtilization >= memoryPressureHighThreshold)
    );
    const lowMemoryPressure = (
      (memoryPressure == null || memoryPressure <= memoryPressureLowThreshold)
      && (gcPressure == null || gcPressure <= gcPressureLowThreshold)
      && (rssUtilization == null || rssUtilization <= memoryPressureLowThreshold)
    );

    const canScaleDown = currentConcurrency > minConcurrency
      && (timestamp - lastScaleDownAt) >= scaleDownCooldownMs;
    if (canScaleDown && highMemoryPressure) {
      currentConcurrency -= 1;
      lastScaleDownAt = timestamp;
      emitChange('memory-pressure', from, currentConcurrency, {
        pendingWrites,
        activeWrites,
        longestStallSec,
        memoryPressure,
        gcPressure,
        rssUtilization,
        schedulerWritePending,
        schedulerWriteOldestWaitMs,
        schedulerWriteWaitP95Ms,
        stallAttribution
      });
      return currentConcurrency;
    }
    if (
      canScaleDown
      && pendingWrites > 0
      && longestStallSec >= stallScaleDownSeconds
      && attributedToWriteQueue
    ) {
      const severeQueueStall = (
        schedulerWritePending != null
        && schedulerWriteOldestWaitMs != null
        && schedulerWritePending >= Math.max(writeQueuePendingThreshold + 1, Math.ceil(currentConcurrency * 0.75))
        && schedulerWriteOldestWaitMs >= Math.max(4000, writeQueueOldestWaitMsThreshold * 2)
      );
      const scaleDownStep = severeQueueStall ? 2 : 1;
      currentConcurrency = Math.max(minConcurrency, currentConcurrency - scaleDownStep);
      lastScaleDownAt = timestamp;
      emitChange('stall', from, currentConcurrency, {
        pendingWrites,
        activeWrites,
        longestStallSec,
        memoryPressure,
        gcPressure,
        rssUtilization,
        schedulerWritePending,
        schedulerWriteOldestWaitMs,
        schedulerWriteWaitP95Ms,
        stallAttribution
      });
      return currentConcurrency;
    }
    if (
      canScaleDown
      && pendingWrites <= 1
      && activeWrites < currentConcurrency
      && backlogPerSlot <= scaleDownBacklogPerSlot
    ) {
      currentConcurrency -= 1;
      lastScaleDownAt = timestamp;
      emitChange('drain', from, currentConcurrency, {
        pendingWrites,
        activeWrites,
        longestStallSec,
        memoryPressure,
        gcPressure,
        rssUtilization,
        schedulerWritePending,
        schedulerWriteOldestWaitMs,
        schedulerWriteWaitP95Ms,
        stallAttribution
      });
      return currentConcurrency;
    }

    const canScaleUp = currentConcurrency < maxConcurrency
      && (timestamp - lastScaleUpAt) >= scaleUpCooldownMs;
    if (
      canScaleUp
      && pendingWrites > 0
      && backlogPerSlot >= scaleUpBacklogPerSlot
      && longestStallSec <= stallScaleUpGuardSeconds
    ) {
      currentConcurrency += 1;
      lastScaleUpAt = timestamp;
      emitChange('backlog', from, currentConcurrency, {
        pendingWrites,
        activeWrites,
        longestStallSec,
        memoryPressure,
        gcPressure,
        rssUtilization,
        schedulerWritePending,
        schedulerWriteOldestWaitMs,
        schedulerWriteWaitP95Ms,
        stallAttribution
      });
    } else if (
      canScaleUp
      && pendingWrites > 0
      && lowMemoryPressure
      && backlogPerSlot >= Math.max(0.75, scaleUpBacklogPerSlot * 0.6)
      && longestStallSec <= Math.max(1, stallScaleUpGuardSeconds * 0.75)
    ) {
      currentConcurrency += 1;
      lastScaleUpAt = timestamp;
      emitChange('memory-headroom', from, currentConcurrency, {
        pendingWrites,
        activeWrites,
        longestStallSec,
        memoryPressure,
        gcPressure,
        rssUtilization,
        schedulerWritePending,
        schedulerWriteOldestWaitMs,
        schedulerWriteWaitP95Ms,
        stallAttribution
      });
    }
    return currentConcurrency;
  };

  return {
    observe,
    getCurrentConcurrency: () => currentConcurrency,
    getLimits: () => ({ min: minConcurrency, max: maxConcurrency })
  };
};

/**
 * Estimate scheduler memory-token cost for a single artifact write.
 *
 * Small/medium writes are primarily IO-bound and should not be throttled by
 * memory tokens. Very large writes still consume explicit memory budget.
 *
 * @param {number|null|undefined} estimatedBytes
 * @returns {number}
 */
export const resolveArtifactWriteMemTokens = (estimatedBytes) => {
  const bytes = Number(estimatedBytes);
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  if (bytes >= HUGE_ARTIFACT_WRITE_BYTES) return 2;
  if (bytes >= LARGE_ARTIFACT_WRITE_BYTES) return 1;
  return 0;
};

/**
 * Summarize queue-delay samples into stable histogram and percentiles.
 *
 * @param {Array<number>} samples
 * @returns {object|null}
 */
export const summarizeQueueDelayHistogram = (samples) => {
  if (!Array.isArray(samples) || !samples.length) return null;
  const normalized = samples
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry >= 0)
    .map((entry) => Math.round(entry))
    .sort((a, b) => a - b);
  if (!normalized.length) return null;
  const bucketCounts = new Array(ARTIFACT_QUEUE_DELAY_BUCKETS_MS.length).fill(0);
  let overflowCount = 0;
  for (const value of normalized) {
    let bucketIndex = -1;
    for (let index = 0; index < ARTIFACT_QUEUE_DELAY_BUCKETS_MS.length; index += 1) {
      if (value <= ARTIFACT_QUEUE_DELAY_BUCKETS_MS[index]) {
        bucketIndex = index;
        break;
      }
    }
    if (bucketIndex >= 0) bucketCounts[bucketIndex] += 1;
    else overflowCount += 1;
  }
  const buckets = [];
  for (let index = 0; index < ARTIFACT_QUEUE_DELAY_BUCKETS_MS.length; index += 1) {
    const count = bucketCounts[index];
    if (!count) continue;
    buckets.push({
      leMs: ARTIFACT_QUEUE_DELAY_BUCKETS_MS[index],
      count
    });
  }
  return {
    unit: 'ms',
    sampleCount: normalized.length,
    minMs: normalized[0],
    maxMs: normalized[normalized.length - 1],
    p50Ms: resolvePercentileMs(normalized, 0.5),
    p95Ms: resolvePercentileMs(normalized, 0.95),
    buckets,
    overflowCount
  };
};

/**
 * Check whether an artifact label is critical for index-validation reliability.
 *
 * @param {string} label
 * @returns {boolean}
 */
export const isValidationCriticalArtifact = (label) => (
  typeof label === 'string' && VALIDATION_CRITICAL_ARTIFACT_PATTERNS.some((pattern) => pattern.test(label))
);

/**
 * Resolve filesystem strategy toggles for artifact writes.
 *
 * @param {{artifactConfig?:object,platform?:string}} [input]
 * @returns {{mode:'ntfs'|'generic',detectedNtfs:boolean,microCoalescing:boolean,tailWorker:boolean,presizeJsonl:boolean,microBatchMaxCount:number,microBatchMaxBytes:number}}
 */
export const resolveArtifactWriteFsStrategy = (input = {}) => {
  const artifactConfig = input?.artifactConfig && typeof input.artifactConfig === 'object'
    ? input.artifactConfig
    : {};
  const platform = typeof input?.platform === 'string'
    ? input.platform
    : process.platform;
  const detectedNtfs = platform === 'win32';
  const explicitMode = normalizeStrategyMode(artifactConfig.writeFsStrategy);
  const legacyNtfsStrategy = artifactConfig.writeNtfsStrategy;
  let mode = explicitMode === 'auto'
    ? (detectedNtfs ? 'ntfs' : 'generic')
    : explicitMode;
  if (legacyNtfsStrategy === true) mode = 'ntfs';
  if (legacyNtfsStrategy === false) mode = 'generic';
  const ntfsMode = mode === 'ntfs';
  const microBatchMaxCount = Number.isFinite(Number(artifactConfig.writeMicroCoalesceMaxBatchCount))
    ? Math.max(2, Math.floor(Number(artifactConfig.writeMicroCoalesceMaxBatchCount)))
    : (ntfsMode ? 12 : 8);
  const microBatchMaxBytes = Number.isFinite(Number(artifactConfig.writeMicroCoalesceMaxBatchBytes))
    ? Math.max(16 * 1024, Math.floor(Number(artifactConfig.writeMicroCoalesceMaxBatchBytes)))
    : (ntfsMode ? 512 * 1024 : 256 * 1024);
  return {
    mode,
    detectedNtfs,
    microCoalescing: artifactConfig.writeMicroCoalesce !== false,
    tailWorker: artifactConfig.writeTailWorker !== false,
    presizeJsonl: artifactConfig.writeJsonlPresize !== false,
    microBatchMaxCount,
    microBatchMaxBytes
  };
};

/**
 * Classify per-artifact write latency into stable buckets for telemetry.
 *
 * @param {{queueDelayMs?:number,durationMs?:number,bytes?:number,estimatedBytes?:number}} metric
 * @returns {string}
 */
export const resolveArtifactWriteLatencyClass = (metric = {}) => {
  const queueDelayMs = Math.max(0, Number(metric?.queueDelayMs) || 0);
  const durationMs = Math.max(0, Number(metric?.durationMs) || 0);
  const totalMs = queueDelayMs + durationMs;
  const sizeClass = resolveArtifactWriteSizeClass(metric);
  if (queueDelayMs >= 2000 || totalMs > 4000) return `${sizeClass}:tail`;
  for (const threshold of ARTIFACT_LATENCY_CLASSES) {
    if (totalMs <= threshold.maxMs) return `${sizeClass}:${threshold.name}`;
  }
  return `${sizeClass}:tail`;
};

/**
 * Build class-count summary for artifact write latency telemetry.
 *
 * @param {Array<object>} metrics
 * @returns {{total:number,classes:Array<{name:string,count:number}>}|null}
 */
export const summarizeArtifactLatencyClasses = (metrics) => {
  if (!Array.isArray(metrics) || !metrics.length) return null;
  const counts = {};
  for (const metric of metrics) {
    const latencyClass = resolveArtifactWriteLatencyClass(metric);
    counts[latencyClass] = (counts[latencyClass] || 0) + 1;
  }
  const classes = Object.keys(counts)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, count: counts[name] }));
  return {
    total: metrics.length,
    classes
  };
};

/**
 * Select a single pending write for the dedicated tail worker.
 *
 * Selection is deterministic: higher predicted write cost first, then priority,
 * then lane rank and enqueue sequence.
 *
 * @param {{ultraLight?:Array<object>,massive?:Array<object>,light?:Array<object>,heavy?:Array<object}} laneQueues
 * @param {{laneOrder?:Array<string>}} [options]
 * @returns {{laneName:string,entry:object}|null}
 */
export const selectTailWorkerWriteEntry = (laneQueues, options = {}) => {
  const laneOrder = Array.isArray(options?.laneOrder) && options.laneOrder.length
    ? options.laneOrder
    : ['massive', 'heavy', 'light', 'ultraLight'];
  const compare = resolveTailWorkerComparator(laneOrder);
  let best = null;
  for (const laneName of laneOrder) {
    const queue = Array.isArray(laneQueues?.[laneName]) ? laneQueues[laneName] : null;
    if (!queue || !queue.length) continue;
    for (let index = 0; index < queue.length; index += 1) {
      const candidate = { laneName, index, entry: queue[index] };
      if (!best || compare(candidate, best) < 0) {
        best = candidate;
      }
    }
  }
  if (!best) return null;
  const queue = laneQueues[best.laneName];
  const removed = queue.splice(best.index, 1);
  const entry = removed[0];
  if (!entry) return null;
  return {
    laneName: best.laneName,
    entry
  };
};

/**
 * Select a deterministic micro-write batch from a queue head.
 *
 * @param {Array<object>} queue
 * @param {{maxEntries?:number,maxBytes?:number,maxEntryBytes?:number}} [options]
 * @returns {{entries:Array<object>,estimatedBytes:number}}
 */
export const selectMicroWriteBatch = (queue, options = {}) => {
  const entries = [];
  if (!Array.isArray(queue) || !queue.length) {
    return { entries, estimatedBytes: 0 };
  }
  const maxEntries = Number.isFinite(Number(options?.maxEntries))
    ? Math.max(1, Math.floor(Number(options.maxEntries)))
    : 8;
  const maxBytes = Number.isFinite(Number(options?.maxBytes))
    ? Math.max(0, Math.floor(Number(options.maxBytes)))
    : (256 * 1024);
  const maxEntryBytes = Number.isFinite(Number(options?.maxEntryBytes))
    ? Math.max(1024, Math.floor(Number(options.maxEntryBytes)))
    : (64 * 1024);
  const first = queue.shift();
  if (!first) {
    return { entries, estimatedBytes: 0 };
  }
  const firstEstimatedBytes = toNonNegativeNumberOrNull(first.estimatedBytes) ?? 0;
  entries.push(first);
  if (
    maxEntries <= 1
    || maxBytes <= 0
    || !isMicroCoalescibleWrite(first, maxEntryBytes)
    || firstEstimatedBytes > maxBytes
  ) {
    return { entries, estimatedBytes: firstEstimatedBytes };
  }
  let totalEstimatedBytes = firstEstimatedBytes;
  while (queue.length > 0 && entries.length < maxEntries) {
    const candidate = queue[0];
    if (!isMicroCoalescibleWrite(candidate, maxEntryBytes)) break;
    const estimated = toNonNegativeNumberOrNull(candidate.estimatedBytes) ?? 0;
    if (estimated <= 0 || (totalEstimatedBytes + estimated) > maxBytes) break;
    entries.push(queue.shift());
    totalEstimatedBytes += estimated;
  }
  return { entries, estimatedBytes: totalEstimatedBytes };
};

/**
 * Compute a bounded adaptive shard count from payload size and throughput.
 *
 * @param {object} input
 * @param {number} input.estimatedBytes
 * @param {number} input.rowCount
 * @param {number|null} [input.throughputBytesPerSec]
 * @param {number} input.minShards
 * @param {number} input.maxShards
 * @param {number} input.defaultShards
 * @param {number} input.targetShardBytes
 * @param {number} [input.targetShardSeconds]
 * @returns {number}
 */
export const resolveAdaptiveShardCount = ({
  estimatedBytes,
  rowCount,
  throughputBytesPerSec = null,
  minShards,
  maxShards,
  defaultShards,
  targetShardBytes,
  targetShardSeconds = 6
}) => {
  const totalBytes = Math.max(0, Math.floor(Number(estimatedBytes) || 0));
  const rows = Math.max(0, Math.floor(Number(rowCount) || 0));
  const min = Math.max(1, Math.floor(Number(minShards) || 1));
  const max = Math.max(min, Math.floor(Number(maxShards) || min));
  const fallback = Math.max(min, Math.min(max, Math.floor(Number(defaultShards) || min)));
  if (totalBytes <= 0 || rows <= 0) return fallback;
  const byteTarget = resolveOptionalPositiveNumber(targetShardBytes, null)
    || Math.max(1024 * 1024, Math.ceil(totalBytes / fallback));
  const throughput = resolveOptionalPositiveNumber(throughputBytesPerSec, null);
  const throughputTarget = throughput
    ? Math.max(
      1024 * 1024,
      Math.floor(throughput * Math.max(1, Number(targetShardSeconds) || 1))
    )
    : null;
  const effectiveTarget = throughputTarget
    ? Math.min(byteTarget, throughputTarget)
    : byteTarget;
  let count = Math.ceil(totalBytes / Math.max(1, effectiveTarget));
  count = Math.max(count, Math.ceil(rows / 2000));
  return Math.max(min, Math.min(max, count));
};
