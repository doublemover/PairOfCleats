import {
  summarizeArtifactLatencyClasses,
  summarizeQueueDelayHistogram
} from './write-strategy.js';

/**
 * Resolve readable stall-threshold level label for telemetry.
 *
 * @param {number} thresholdSec
 * @param {number} index
 * @returns {string}
 */
export const stallThresholdLevelName = (thresholdSec, index) => {
  if (thresholdSec >= 60) return 'severe';
  if (thresholdSec >= 30) return 'critical';
  if (thresholdSec >= 10) return 'warning';
  return `level-${index + 1}`;
};

/**
 * Record one artifact write metric row and update queue-delay histograms.
 *
 * @param {{
 *   label:string,
 *   metric:object,
 *   artifactMetrics:Map<string, object>,
 *   artifactQueueDelaySamples:Map<string, number[]>
 * }} input
 * @returns {void}
 */
export const recordArtifactMetricRow = ({
  label,
  metric,
  artifactMetrics,
  artifactQueueDelaySamples
}) => {
  if (!label) return;
  const existing = artifactMetrics.get(label) || { path: label };
  const nextMetric = { ...existing, ...metric };
  const queueDelayMs = Number(metric?.queueDelayMs);
  if (Number.isFinite(queueDelayMs) && queueDelayMs >= 0) {
    const samples = artifactQueueDelaySamples.get(label) || [];
    samples.push(Math.round(queueDelayMs));
    artifactQueueDelaySamples.set(label, samples);
    const queueDelayHistogram = summarizeQueueDelayHistogram(samples);
    if (queueDelayHistogram) {
      nextMetric.queueDelayHistogram = queueDelayHistogram;
      nextMetric.queueDelayP50Ms = queueDelayHistogram.p50Ms;
      nextMetric.queueDelayP95Ms = queueDelayHistogram.p95Ms;
    }
  }
  artifactMetrics.set(label, nextMetric);
};

/**
 * Create heartbeat/stall controller for in-flight artifact writes.
 *
 * @param {{
 *   writeProgressHeartbeatMs:number,
 *   activeWrites:Map<string, number>,
 *   activeWriteBytes:Map<string, number>,
 *   getCompletedWrites:()=>number,
 *   getTotalWrites:()=>number,
 *   normalizedWriteStallThresholds:number[],
 *   stageCheckpoints?:{record?:(entry:object)=>void}|null,
 *   logLine:(message:string,options?:object)=>void,
 *   formatBytes:(bytes:number)=>string
 * }} input
 * @returns {{start:()=>void,stop:()=>void,clearLabelAlerts:(label:string)=>void}}
 */
export const createWriteHeartbeatController = ({
  writeProgressHeartbeatMs,
  activeWrites,
  activeWriteBytes,
  getCompletedWrites,
  getTotalWrites,
  normalizedWriteStallThresholds,
  stageCheckpoints = null,
  logLine,
  formatBytes
}) => {
  let writeHeartbeatTimer = null;
  const writeStallAlerts = new Map();

  const start = () => {
    if (writeProgressHeartbeatMs <= 0 || writeHeartbeatTimer) return;
    writeHeartbeatTimer = setInterval(() => {
      if (!activeWrites.size || getCompletedWrites() >= getTotalWrites()) return;
      const now = Date.now();
      const inflight = Array.from(activeWrites.entries())
        .map(([label, startedAt]) => ({
          label,
          elapsedSec: Math.max(1, Math.round((now - startedAt) / 1000)),
          estimatedBytes: Number(activeWriteBytes.get(label)) || null
        }))
        .sort((a, b) => b.elapsedSec - a.elapsedSec);
      for (const { label, elapsedSec, estimatedBytes } of inflight) {
        const alerts = writeStallAlerts.get(label) || new Set();
        for (let thresholdIndex = 0; thresholdIndex < normalizedWriteStallThresholds.length; thresholdIndex += 1) {
          const thresholdSec = normalizedWriteStallThresholds[thresholdIndex];
          if (alerts.has(thresholdSec) || elapsedSec < thresholdSec) continue;
          alerts.add(thresholdSec);
          writeStallAlerts.set(label, alerts);
          const levelName = stallThresholdLevelName(thresholdSec, thresholdIndex);
          logLine(
            `[perf] artifact write stall ${levelName}: ${label} in-flight for ${elapsedSec}s ` +
            `(threshold=${thresholdSec}s)`,
            { kind: thresholdSec >= 30 ? 'error' : 'warning' }
          );
          if (stageCheckpoints?.record) {
            stageCheckpoints.record({
              stage: 'artifacts',
              step: `write-stall-${thresholdSec}s`,
              label,
              extra: {
                elapsedSec,
                thresholdSec,
                level: levelName,
                estimatedBytes
              }
            });
          }
        }
      }
      const preview = inflight.slice(0, 3)
        .map(({ label, elapsedSec, estimatedBytes }) => (
          `${label} (${elapsedSec}s${Number.isFinite(estimatedBytes) ? `, ~${formatBytes(estimatedBytes)}` : ''})`
        ))
        .join(', ');
      const suffix = inflight.length > 3 ? ` (+${inflight.length - 3} more)` : '';
      logLine(
        `Writing index files ${getCompletedWrites()}/${getTotalWrites()} | in-flight: ${preview}${suffix}`,
        { kind: 'status' }
      );
    }, writeProgressHeartbeatMs);
    if (typeof writeHeartbeatTimer?.unref === 'function') {
      writeHeartbeatTimer.unref();
    }
  };

  const stop = () => {
    if (!writeHeartbeatTimer) return;
    clearInterval(writeHeartbeatTimer);
    writeHeartbeatTimer = null;
  };

  const clearLabelAlerts = (label) => {
    if (!label) return;
    writeStallAlerts.delete(label);
  };

  return {
    start,
    stop,
    clearLabelAlerts
  };
};

/**
 * Stable sort comparator for artifact metric rows.
 *
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
const compareArtifactMetricPaths = (a, b) => {
  const aPath = String(a?.path || '');
  const bPath = String(b?.path || '');
  return aPath.localeCompare(bPath);
};

/**
 * Stable sort comparator for pieces-manifest rows.
 *
 * Write completion order is intentionally ignored here: path/type/name sorting
 * keeps manifest ordering deterministic across different concurrency settings.
 *
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
const comparePieceEntriesForManifest = (a, b) => {
  const pathA = String(a?.path || '');
  const pathB = String(b?.path || '');
  if (pathA !== pathB) return pathA.localeCompare(pathB);
  const typeA = String(a?.type || '');
  const typeB = String(b?.type || '');
  if (typeA !== typeB) return typeA.localeCompare(typeB);
  const nameA = String(a?.name || '');
  const nameB = String(b?.name || '');
  return nameA.localeCompare(nameB);
};

/**
 * Finalize artifact telemetry and piece metadata after write settlement.
 *
 * Two-pass merge preserves deterministic behavior under concurrent writes:
 * 1. Piece rows seed metric rows with static contract fields.
 * 2. Metric rows backfill bytes/checksums into piece rows when writes resolve.
 * Final ordering is then normalized via stable comparators.
 *
 * @param {{
 *   pieceEntries:Array<object>,
 *   artifactMetrics:Map<string,object>,
 *   timing?:object|null,
 *   cleanupActions?:Array<object>,
 *   writeFsStrategy?:object|null,
 *   profileId?:string|null
 * }} input
 * @returns {void}
 */
export const finalizeArtifactWriteTelemetry = ({
  pieceEntries,
  artifactMetrics,
  timing = null,
  cleanupActions = [],
  writeFsStrategy = null,
  profileId = null
}) => {
  if (!Array.isArray(pieceEntries) || !(artifactMetrics instanceof Map)) return;
  for (const entry of pieceEntries) {
    if (!entry?.path) continue;
    const metric = artifactMetrics.get(entry.path) || { path: entry.path };
    if (Number.isFinite(entry.count)) metric.count = entry.count;
    if (Number.isFinite(entry.dims)) metric.dims = entry.dims;
    if (entry.compression) metric.compression = entry.compression;
    if (Number.isFinite(entry.bytes) && entry.bytes >= 0) metric.bytes = entry.bytes;
    if (typeof entry.checksum === 'string' && entry.checksum.includes(':')) {
      const [checksumAlgo, checksum] = entry.checksum.split(':');
      if (checksumAlgo && checksum) {
        metric.checksumAlgo = checksumAlgo;
        metric.checksum = checksum;
      }
    }
    artifactMetrics.set(entry.path, metric);
  }
  for (const entry of pieceEntries) {
    if (!entry?.path) continue;
    const metric = artifactMetrics.get(entry.path);
    if (!metric || typeof metric !== 'object') continue;
    if (!Number.isFinite(entry.bytes) && Number.isFinite(metric.bytes)) {
      entry.bytes = metric.bytes;
    }
    if (
      typeof entry.checksum !== 'string'
      && typeof metric.checksumAlgo === 'string'
      && typeof metric.checksum === 'string'
      && metric.checksumAlgo
      && metric.checksum
    ) {
      entry.checksum = `${metric.checksumAlgo}:${metric.checksum}`;
    }
  }
  if (timing && typeof timing === 'object') {
    const sortedArtifacts = Array.from(artifactMetrics.values()).sort(compareArtifactMetricPaths);
    timing.cleanup = {
      profileId,
      actions: cleanupActions,
      writeFsStrategy,
      artifactLatencyClasses: summarizeArtifactLatencyClasses(sortedArtifacts)
    };
    timing.artifacts = sortedArtifacts;
  }
  pieceEntries.sort(comparePieceEntriesForManifest);
};
