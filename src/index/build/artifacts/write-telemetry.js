import { summarizeQueueDelayHistogram } from './write-strategy.js';
import { resolveArtifactWritePhaseClass } from './write-strategy.js';

const toPosix = (value) => String(value || '').replace(/\\/g, '/');
const LARGE_STALL_THRESHOLD_BYTES = 128 * 1024 * 1024;
const HUGE_STALL_THRESHOLD_BYTES = 768 * 1024 * 1024;
const ARTIFACT_PHASE_TIMING_KEYS = Object.freeze([
  'computeMs',
  'serializationMs',
  'compressionMs',
  'flushMs',
  'fsyncMs',
  'publishMs',
  'manifestWaitMs',
  'backpressureWaitMs',
  'diskMs'
]);

const toNonNegativeNumberOrNull = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

export const resolveActiveWritePhaseLabel = (label, phaseHint = null) => {
  const hinted = typeof phaseHint === 'string' ? phaseHint.trim() : '';
  if (hinted) return hinted;
  const normalized = toPosix(label).toLowerCase();
  if (!normalized) return 'write:artifact';
  if (normalized.startsWith('closeout/')) return `closeout:${normalized.slice('closeout/'.length)}`;
  if (normalized.includes('pieces/manifest.json') || normalized.endsWith('manifest.json')) return 'write:manifest';
  if (normalized.endsWith('.meta.json')) return 'write:meta';
  if (normalized.includes('binary-columnar')) return 'write:binary-columnar';
  if (normalized.endsWith('.bin') || normalized.endsWith('.varint')) return 'write:binary';
  if (normalized.includes('.shards/') || normalized.includes('.parts/')) return 'write:sharded-part';
  if (normalized.includes('chunk_meta')) return 'write:chunk-meta';
  if (normalized.includes('repo_map')) return 'write:repo-map';
  if (normalized.includes('field_postings')) return 'write:field-postings';
  if (normalized.includes('token_postings')) return 'write:token-postings';
  if (normalized.includes('file_meta')) return 'write:file-meta';
  if (normalized.includes('file_relations')) return 'write:file-relations';
  if (normalized.includes('call_sites')) return 'write:call-sites';
  if (normalized.includes('dense_vectors')) return 'write:embeddings';
  if (normalized.includes('minhash')) return 'write:minhash';
  if (normalized.includes('filter_index')) return 'write:filter-index';
  if (normalized.includes('index_state')) return 'write:index-state';
  if (normalized.includes('determinism_report')) return 'write:determinism';
  if (normalized.includes('metrics')) return 'write:metrics';
  return 'write:artifact';
};

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

export const resolveArtifactWriteStallThresholds = ({
  normalizedWriteStallThresholds,
  estimatedBytes
}) => {
  const thresholds = Array.isArray(normalizedWriteStallThresholds)
    ? normalizedWriteStallThresholds
    : [];
  const bytes = Number.isFinite(Number(estimatedBytes))
    ? Math.max(0, Number(estimatedBytes))
    : 0;
  const scale = bytes >= HUGE_STALL_THRESHOLD_BYTES
    ? 2
    : bytes >= LARGE_STALL_THRESHOLD_BYTES
      ? 1.5
      : 1;
  return thresholds.map((thresholdSec) => Math.max(1, Math.ceil(Number(thresholdSec) * scale)));
};

export const normalizeArtifactPhaseTimings = (phaseTimings = null, fallback = {}) => {
  const input = phaseTimings && typeof phaseTimings === 'object' ? phaseTimings : {};
  const normalized = {
    computeMs: toNonNegativeNumberOrNull(input.computeMs ?? input.materializeMs),
    serializationMs: toNonNegativeNumberOrNull(input.serializationMs),
    compressionMs: toNonNegativeNumberOrNull(input.compressionMs),
    flushMs: toNonNegativeNumberOrNull(input.flushMs),
    fsyncMs: toNonNegativeNumberOrNull(input.fsyncMs),
    publishMs: toNonNegativeNumberOrNull(input.publishMs),
    manifestWaitMs: toNonNegativeNumberOrNull(input.manifestWaitMs),
    backpressureWaitMs: toNonNegativeNumberOrNull(input.backpressureWaitMs),
    diskMs: toNonNegativeNumberOrNull(input.diskMs)
  };
  const fallbackSerializationMs = toNonNegativeNumberOrNull(fallback?.serializationMs);
  if (normalized.serializationMs == null && fallbackSerializationMs != null) {
    normalized.serializationMs = fallbackSerializationMs;
  }
  const derivedDiskMs = [normalized.flushMs, normalized.fsyncMs, normalized.publishMs]
    .filter((value) => value != null)
    .reduce((total, value) => total + value, 0);
  const fallbackDiskMs = toNonNegativeNumberOrNull(fallback?.diskMs);
  if (normalized.diskMs == null) {
    if (derivedDiskMs > 0) {
      normalized.diskMs = derivedDiskMs;
    } else if (fallbackDiskMs != null) {
      normalized.diskMs = fallbackDiskMs;
    }
  } else if (derivedDiskMs > 0) {
    normalized.diskMs = Math.max(normalized.diskMs, derivedDiskMs);
  }
  if (normalized.diskMs == null && normalized.serializationMs != null && fallback?.durationMs != null) {
    const durationMs = toNonNegativeNumberOrNull(fallback.durationMs);
    if (durationMs != null) {
      normalized.diskMs = Math.max(0, durationMs - normalized.serializationMs);
    }
  }
  const hasAnyTiming = ARTIFACT_PHASE_TIMING_KEYS.some((key) => normalized[key] != null);
  return hasAnyTiming ? normalized : null;
};

export const resolveActiveWriteStallOwner = (entries = []) => {
  const list = Array.isArray(entries) ? entries : [];
  const preferredPhaseClasses = ['closeout', 'publish', 'materialize', 'execute'];
  for (const phaseClass of preferredPhaseClasses) {
    const match = list.find((entry) => entry?.phaseClass === phaseClass && typeof entry?.phase === 'string');
    if (!match) continue;
    if (typeof match.family === 'string' && match.family) {
      return `${match.family}:${match.phase}`;
    }
    return match.phase;
  }
  return null;
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
  const normalizedPhaseTimings = normalizeArtifactPhaseTimings(metric?.phaseTimings, {
    durationMs: metric?.durationMs,
    serializationMs: metric?.serializationMs,
    diskMs: metric?.diskMs
  });
  if (normalizedPhaseTimings) {
    nextMetric.phaseTimings = normalizedPhaseTimings;
    for (const key of ARTIFACT_PHASE_TIMING_KEYS) {
      nextMetric[key] = normalizedPhaseTimings[key];
    }
  }
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
 * Build a stable snapshot of active artifact writes with phase/lane context.
 *
 * @param {{
 *   activeWrites:Map<string, number>,
 *   activeWriteBytes:Map<string, number>,
 *   activeWriteMeta?:Map<string, object>|null,
 *   limit?:number,
 *   now?:number,
 *   formatBytes?:(bytes:number)=>string
 * }} input
 * @returns {{
 *   inflight:Array<{label:string,elapsedSec:number,estimatedBytes:number|null,phase:string,lane:string|null,family:string|null,progressUnit:string|null,estimatedItems:number|null}>,
 *   previewText:string,
 *   phaseSummaryText:string,
 *   familySummaryText:string,
 *   phaseByLabel:Map<string,string>,
  *   stallOwner:string|null
 * }}
 */
export const buildActiveWriteTelemetrySnapshot = ({
  activeWrites,
  activeWriteBytes,
  activeWriteMeta = null,
  limit = 3,
  now = Date.now(),
  formatBytes = (bytes) => `${bytes} B`
}) => {
  const entries = Array.from(activeWrites?.entries?.() || [])
    .map(([label, startedAt]) => {
      const meta = activeWriteMeta instanceof Map ? activeWriteMeta.get(label) : null;
      const phase = resolveActiveWritePhaseLabel(label, meta?.phase);
      return {
        label,
        elapsedSec: Math.max(1, Math.round((now - (Number(startedAt) || now)) / 1000)),
        estimatedBytes: Number(activeWriteBytes?.get?.(label)) || null,
        phase,
        phaseClass: resolveArtifactWritePhaseClass(phase),
        family: typeof meta?.family === 'string' && meta.family.trim()
          ? meta.family.trim()
          : null,
        lane: typeof meta?.lane === 'string' && meta.lane.trim()
          ? meta.lane.trim()
          : null,
        progressUnit: typeof meta?.progressUnit === 'string' && meta.progressUnit.trim()
          ? meta.progressUnit.trim()
          : null,
        estimatedItems: Number.isFinite(Number(meta?.estimatedItems))
          ? Math.max(0, Math.floor(Number(meta.estimatedItems)))
          : null
      };
    })
    .sort((left, right) => (
      right.elapsedSec - left.elapsedSec
      || left.label.localeCompare(right.label)
    ));
  const phaseCounts = new Map();
  const familyCounts = new Map();
  for (const entry of entries) {
    phaseCounts.set(entry.phase, (phaseCounts.get(entry.phase) || 0) + 1);
    if (entry.family) {
      familyCounts.set(entry.family, (familyCounts.get(entry.family) || 0) + 1);
    }
  }
  const phaseByLabel = new Map(entries.map((entry) => [entry.label, entry.phase]));
  const previewText = entries
    .slice(0, Math.max(1, Math.floor(Number(limit) || 3)))
    .map(({ label, elapsedSec, estimatedBytes, phase, lane, family, progressUnit, estimatedItems }) => (
      `${label} [${family ? `${family}|` : ''}${phase}${lane ? `:${lane}` : ''}]`
      + ` (${elapsedSec}s`
      + `${Number.isFinite(estimatedBytes) ? `, ~${formatBytes(estimatedBytes)}` : ''}`
      + `${Number.isFinite(estimatedItems) && progressUnit ? `, ~${estimatedItems} ${progressUnit}` : ''}`
      + `)`
    ))
    .join(', ');
  const phaseSummaryText = Array.from(phaseCounts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([phase, count]) => `${phase}=${count}`)
    .join(', ');
  const familySummaryText = Array.from(familyCounts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([family, count]) => `${family}=${count}`)
    .join(', ');
  return {
    inflight: entries,
    previewText,
    phaseSummaryText,
    familySummaryText,
    phaseByLabel,
    stallOwner: resolveActiveWriteStallOwner(entries)
  };
};

/**
 * Create heartbeat/stall controller for in-flight artifact writes.
 *
 * @param {{
 *   writeProgressHeartbeatMs:number,
 *   activeWrites:Map<string, number>,
  *   activeWriteBytes:Map<string, number>,
 *   activeWriteMeta?:Map<string, object>|null,
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
  activeWriteMeta = null,
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
      const snapshot = buildActiveWriteTelemetrySnapshot({
        activeWrites,
        activeWriteBytes,
        activeWriteMeta,
        limit: 3,
        formatBytes
      });
      const inflight = snapshot.inflight;
      for (const { label, elapsedSec, estimatedBytes } of inflight) {
        const alerts = writeStallAlerts.get(label) || new Set();
        const resolvedThresholds = resolveArtifactWriteStallThresholds({
          normalizedWriteStallThresholds,
          estimatedBytes
        });
        for (let thresholdIndex = 0; thresholdIndex < resolvedThresholds.length; thresholdIndex += 1) {
          const thresholdSec = resolvedThresholds[thresholdIndex];
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
                estimatedBytes,
                phase: snapshot.phaseByLabel.get(label) || resolveActiveWritePhaseLabel(label)
              }
            });
          }
        }
      }
      const suffix = inflight.length > 3 ? ` (+${inflight.length - 3} more)` : '';
      logLine(
        `Writing index files ${getCompletedWrites()}/${getTotalWrites()} | in-flight: ${snapshot.previewText}${suffix}`,
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
