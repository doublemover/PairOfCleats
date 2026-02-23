import {
  captureProcessSnapshot,
  snapshotTrackedSubprocesses
} from '../../../../../shared/subprocess.js';

const STALL_DIAGNOSTIC_QUEUE_NAMES = Object.freeze(['stage1.cpu', 'stage1.io', 'stage1.postings']);

/**
 * Normalize optional duration-like values to non-negative millisecond numbers.
 *
 * @param {unknown} value
 * @returns {number}
 */
const clampDurationMs = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

/**
 * Convert epoch milliseconds to ISO string when valid.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
const toIsoTimestamp = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? new Date(parsed).toISOString() : null;
};

/**
 * Normalize one in-flight file row for stall diagnostic snapshots.
 *
 * @param {object} entry
 * @param {number} [nowMs]
 * @returns {object|null}
 */
const toStage1StallFileSummary = (entry, nowMs = Date.now()) => {
  if (!entry || typeof entry !== 'object') return null;
  const startedAt = Number(entry.startedAt) || nowMs;
  return {
    orderIndex: Number.isFinite(entry.orderIndex) ? entry.orderIndex : null,
    file: entry.file || null,
    shardId: entry.shardId || null,
    fileIndex: Number.isFinite(entry.fileIndex) ? entry.fileIndex : null,
    ownershipId: typeof entry.ownershipId === 'string' ? entry.ownershipId : null,
    elapsedMs: Math.max(0, nowMs - startedAt)
  };
};

/**
 * Collect and rank the most stalled in-flight files for watchdog reporting.
 *
 * Uses a bounded top-N selection pass to avoid full-array sorting on every
 * snapshot heartbeat. This reduces allocation and sort cost when many files are
 * in flight while preserving deterministic output order for equal durations.
 *
 * @param {Map<string,object>} inFlightFiles
 * @param {{limit?:number,nowMs?:number}} [options]
 * @returns {object[]}
 */
export const collectStage1StalledFiles = (
  inFlightFiles,
  { limit = 6, nowMs = Date.now() } = {}
) => {
  const maxResults = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : 0;
  if (!maxResults || typeof inFlightFiles?.values !== 'function') return [];

  /** @type {object[]} */
  const topByElapsedAsc = [];
  for (const value of inFlightFiles.values()) {
    const summary = toStage1StallFileSummary(value, nowMs);
    if (!summary) continue;
    if (topByElapsedAsc.length < maxResults) {
      topByElapsedAsc.push(summary);
      topByElapsedAsc.sort((left, right) => (left.elapsedMs || 0) - (right.elapsedMs || 0));
      continue;
    }
    const smallest = topByElapsedAsc[0];
    if ((summary.elapsedMs || 0) <= (smallest?.elapsedMs || 0)) continue;
    topByElapsedAsc[0] = summary;
    topByElapsedAsc.sort((left, right) => (left.elapsedMs || 0) - (right.elapsedMs || 0));
  }

  return topByElapsedAsc
    .slice()
    .sort((left, right) => {
      const elapsedDelta = (right.elapsedMs || 0) - (left.elapsedMs || 0);
      if (elapsedDelta !== 0) return elapsedDelta;
      const leftOrder = Number.isFinite(left.orderIndex) ? left.orderIndex : Number.MAX_SAFE_INTEGER;
      const rightOrder = Number.isFinite(right.orderIndex) ? right.orderIndex : Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    });
};

/**
 * Reduce raw queue-delay accumulators to stable summary metrics.
 *
 * @param {object} queueDelaySummary
 * @returns {{count:number,avgMs:number,maxMs:number}}
 */
export const summarizeStage1QueueDelay = (queueDelaySummary) => ({
  count: Math.max(0, Math.floor(Number(queueDelaySummary?.count) || 0)),
  avgMs: Number(queueDelaySummary?.count) > 0
    ? clampDurationMs(queueDelaySummary?.totalMs) / Number(queueDelaySummary.count)
    : 0,
  maxMs: clampDurationMs(queueDelaySummary?.maxMs)
});

/**
 * Format stalled-file summary rows for compact watchdog log lines.
 *
 * @param {object[]} [stalledFiles]
 * @returns {string}
 */
export const formatStage1StalledFileText = (stalledFiles = []) => (
  stalledFiles
    .map((entry) => `${entry.file || 'unknown'}#${entry.orderIndex ?? '?'}@${Math.round((entry.elapsedMs || 0) / 1000)}s`)
    .join(', ')
);

/**
 * Capture scheduler state relevant to stage1 stall diagnosis.
 *
 * @param {object} runtime
 * @returns {object|null}
 */
export const buildStage1SchedulerStallSnapshot = (runtime) => {
  if (typeof runtime?.scheduler?.stats !== 'function') return null;
  const stats = runtime.scheduler.stats();
  if (!stats || typeof stats !== 'object') return null;

  const queues = stats?.queues && typeof stats.queues === 'object' ? stats.queues : {};
  const summarizeQueue = (queueName) => {
    const queue = queues?.[queueName];
    if (!queue || typeof queue !== 'object') return null;
    return {
      name: queueName,
      surface: queue.surface || null,
      pending: Number(queue.pending) || 0,
      running: Number(queue.running) || 0,
      pendingBytes: Number(queue.pendingBytes) || 0,
      inFlightBytes: Number(queue.inFlightBytes) || 0,
      oldestWaitMs: Number(queue.oldestWaitMs) || 0
    };
  };

  const highlightedQueues = STALL_DIAGNOSTIC_QUEUE_NAMES
    .map((queueName) => summarizeQueue(queueName))
    .filter(Boolean);

  const topPendingQueues = Object.entries(queues)
    .map(([name, queue]) => ({
      name,
      surface: queue?.surface || null,
      pending: Number(queue?.pending) || 0,
      running: Number(queue?.running) || 0,
      oldestWaitMs: Number(queue?.oldestWaitMs) || 0
    }))
    .filter((entry) => entry.pending > 0 || entry.running > 0)
    .sort((left, right) => {
      if (right.pending !== left.pending) return right.pending - left.pending;
      if (right.running !== left.running) return right.running - left.running;
      return right.oldestWaitMs - left.oldestWaitMs;
    })
    .slice(0, 8);

  const parseSurface = stats?.adaptive?.surfaces?.parse && typeof stats.adaptive.surfaces.parse === 'object'
    ? {
      minConcurrency: Number(stats.adaptive.surfaces.parse.minConcurrency) || 0,
      maxConcurrency: Number(stats.adaptive.surfaces.parse.maxConcurrency) || 0,
      currentConcurrency: Number(stats.adaptive.surfaces.parse.currentConcurrency) || 0,
      running: Number(stats.adaptive.surfaces.parse.snapshot?.running) || 0,
      pending: Number(stats.adaptive.surfaces.parse.snapshot?.pending) || 0
    }
    : null;

  return {
    activity: {
      pending: Number(stats?.activity?.pending) || 0,
      running: Number(stats?.activity?.running) || 0
    },
    utilization: {
      cpu: Number(stats?.utilization?.cpu) || 0,
      io: Number(stats?.utilization?.io) || 0,
      mem: Number(stats?.utilization?.mem) || 0
    },
    parseSurface,
    highlightedQueues,
    topPendingQueues
  };
};

/**
 * Render compact queue/parse capacity text for stall warning lines.
 *
 * @param {object|null} snapshot
 * @returns {string|null}
 */
export const formatStage1SchedulerStallSummary = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const parse = snapshot.parseSurface && typeof snapshot.parseSurface === 'object'
    ? snapshot.parseSurface
    : null;
  const queueByName = new Map(
    (Array.isArray(snapshot.highlightedQueues) ? snapshot.highlightedQueues : [])
      .map((entry) => [entry.name, entry])
  );
  const formatQueue = (name) => {
    const queue = queueByName.get(name);
    if (!queue) return `${name}=n/a`;
    return `${name}=r${queue.running}/p${queue.pending}/wait${Math.round((queue.oldestWaitMs || 0) / 1000)}s`;
  };
  return [
    parse
      ? `parse=r${parse.running}/p${parse.pending}/cap${parse.currentConcurrency}`
      : 'parse=n/a',
    formatQueue('stage1.cpu'),
    formatQueue('stage1.io'),
    formatQueue('stage1.postings')
  ].join(' ');
};

/**
 * Build the full stage1 processing stall payload used by watchdog logs and
 * adaptive soft-kick/abort diagnostics.
 *
 * @param {{
 *   reason?:string,
 *   idleMs?:number|null,
 *   includeStack?:boolean,
 *   nowMs?:number,
 *   lastProgressAt?:number,
 *   progress?:object|null,
 *   processStart?:number,
 *   inFlightFiles?:Map<string,object>,
 *   getOrderedPendingCount?:Function,
 *   orderedAppender?:object|null,
 *   postingsQueue?:object|null,
 *   queueDelaySummary?:object|null,
 *   stage1OwnershipPrefix?:string,
 *   runtime?:object|null
 * }} [input]
 * @returns {object}
 */
export const buildStage1ProcessingStallSnapshot = ({
  reason = 'stall_snapshot',
  idleMs = null,
  includeStack = false,
  nowMs = Date.now(),
  lastProgressAt = 0,
  progress = null,
  processStart = 0,
  inFlightFiles,
  getOrderedPendingCount = () => 0,
  orderedAppender = null,
  postingsQueue = null,
  queueDelaySummary = null,
  stage1OwnershipPrefix = '',
  runtime = null
} = {}) => {
  const resolvedIdleMs = Number.isFinite(Number(idleMs))
    ? clampDurationMs(idleMs)
    : Math.max(0, nowMs - (Number(lastProgressAt) || nowMs));
  const orderedPending = getOrderedPendingCount();
  const orderedSnapshot = typeof orderedAppender?.snapshot === 'function'
    ? orderedAppender.snapshot()
    : null;
  const postingsSnapshot = typeof postingsQueue?.stats === 'function'
    ? postingsQueue.stats()
    : null;
  const stalledFiles = collectStage1StalledFiles(inFlightFiles, { limit: 6, nowMs });
  const trackedSubprocesses = snapshotTrackedSubprocesses({
    ownershipPrefix: stage1OwnershipPrefix,
    limit: 8
  });
  const schedulerSnapshot = buildStage1SchedulerStallSnapshot(runtime);
  return {
    reason,
    generatedAt: new Date(nowMs).toISOString(),
    source: 'stage1-watchdog',
    idleMs: resolvedIdleMs,
    progressDone: progress?.count || 0,
    progressTotal: progress?.total || 0,
    progressElapsedMs: Math.max(0, nowMs - processStart),
    lastProgressAt: toIsoTimestamp(lastProgressAt),
    inFlight: inFlightFiles?.size || 0,
    orderedPending,
    orderedSnapshot,
    postingsSnapshot,
    queueDelayMs: summarizeStage1QueueDelay(queueDelaySummary),
    stalledFiles,
    trackedSubprocesses,
    scheduler: schedulerSnapshot,
    process: captureProcessSnapshot({
      includeStack,
      frameLimit: includeStack ? 16 : 8,
      handleTypeLimit: 8
    })
  };
};

/**
 * Summarize soft-kick cleanup outcomes for watchdog diagnostics.
 *
 * @param {Array<{timedOut?:boolean,error?:unknown}>} [cleanupResults]
 * @returns {{attempted:number,failures:number,terminatedPids:number[],ownershipIds:string[],cleanupResults:object[]}}
 */
export const summarizeStage1SoftKickCleanup = (cleanupResults = []) => {
  const summaries = (Array.isArray(cleanupResults) ? cleanupResults : [])
    .filter((entry) => entry && typeof entry === 'object');
  const attempted = summaries.reduce((sum, entry) => sum + (Number(entry.attempted) || 0), 0);
  const failures = summaries.reduce((sum, entry) => sum + (Number(entry.failures) || 0), 0);
  const terminatedPids = Array.from(new Set(
    summaries.flatMap((entry) => (
      Array.isArray(entry.terminatedPids)
        ? entry.terminatedPids.filter((pid) => Number.isFinite(pid))
        : []
    ))
  )).sort((a, b) => a - b);
  const ownershipIds = Array.from(new Set(
    summaries.flatMap((entry) => (
      Array.isArray(entry.terminatedOwnershipIds)
        ? entry.terminatedOwnershipIds.filter((value) => typeof value === 'string' && value)
        : []
    ))
  )).sort((left, right) => left.localeCompare(right));
  return {
    attempted,
    failures,
    terminatedPids,
    ownershipIds,
    cleanupResults: summaries
  };
};
