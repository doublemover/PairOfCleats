import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSubprocess } from '../../../src/shared/subprocess.js';
import { killProcessTree as killPidTree } from '../../../src/shared/kill-tree.js';
import { createProgressLineDecoder } from '../../../src/shared/cli/progress-stream.js';
import { parseProgressEventLine } from '../../../src/shared/cli/progress-events.js';
import { exitLikeCommandResult } from '../../shared/cli-utils.js';
import {
  BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION,
  computeBenchProgressConfidence,
  formatBenchProgressConfidence,
  buildBenchDiagnosticEventId,
  buildBenchDiagnosticSignature,
  normalizeBenchDiagnosticText
} from './logging.js';

const SCHEDULER_EVENT_WINDOW = 40;
const SCHEDULER_EVENT_MARKER = '[tree-sitter:schedule]';
const DIAGNOSTIC_STREAM_SUFFIX = '.diagnostics.jsonl';
const PROGRESS_CONFIDENCE_STREAM_SUFFIX = '.progress-confidence.jsonl';
const DIAGNOSTIC_REPEAT_COUNT = 5;
const DIAGNOSTIC_REPEAT_INTERVAL_MS = 30 * 1000;
const PROGRESS_CONFIDENCE_EMIT_INTERVAL_MS = 15 * 1000;
const PROGRESS_CONFIDENCE_EMIT_DELTA = 0.07;
const QUEUE_DELAY_HOTSPOT_MS = 250;
const QUEUE_DEPTH_HOTSPOT = 3;
const HEARTBEAT_STALL_THRESHOLD_MS = 30 * 1000;
const MAX_PROGRESS_SAMPLES = 240;

const PARSER_CRASH_PATTERNS = Object.freeze([
  /\bparser\b[\s\S]{0,80}\b(?:crash|crashed|fatal|abort|aborted)\b/i,
  /\btree-sitter\b[\s\S]{0,80}\b(?:crash|crashed|fatal|abort|aborted)\b/i,
  /\b(?:segmentation fault|sigsegv)\b[\s\S]{0,80}\b(?:parser|tree-sitter)\b/i
]);
const SCM_TIMEOUT_PATTERNS = Object.freeze([
  /\b(?:scm|git)\b[\s\S]{0,80}\b(?:timeout|timed out|deadline exceeded)\b/i,
  /\b(?:timeout|timed out|deadline exceeded)\b[\s\S]{0,80}\b(?:scm|git)\b/i
]);
const ARTIFACT_TAIL_STALL_PATTERNS = Object.freeze([
  /\bartifact(?:s)?\b[\s\S]{0,80}\b(?:tail|flush|write)\b[\s\S]{0,80}\b(?:stall|stalled|timeout|timed out|hung|blocked)\b/i,
  /\bartifact(?:s)?\b[\s\S]{0,80}\b(?:stall|stalled)\b[\s\S]{0,80}\b(?:tail|flush|write)\b/i
]);
const FALLBACK_NEGATIVE_PATTERN = /\b(?:no|without)\s+fallback\b|\bfallback\s+(?:disabled|off)\b/i;

const toText = (value) => String(value == null ? '' : value).trim();

const truncateForDisplay = (value, maxChars = 140) => {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  const limit = Number.isFinite(Number(maxChars)) && Number(maxChars) > 0
    ? Math.floor(Number(maxChars))
    : 140;
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
};

const normalizeSignatureMessage = (message) => (
  normalizeBenchDiagnosticText(String(message || '').replace(/\b\d+(\.\d+)?\b/g, '#'), { maxLength: 220 })
);

const resolveDiagnosticsStreamPath = (logEntry) => {
  const target = toText(logEntry);
  if (!target) return null;
  if (target.endsWith('.log')) return `${target.slice(0, -4)}${DIAGNOSTIC_STREAM_SUFFIX}`;
  return `${target}${DIAGNOSTIC_STREAM_SUFFIX}`;
};

const resolveProgressConfidenceStreamPath = (logEntry) => {
  const target = toText(logEntry);
  if (!target) return null;
  if (target.endsWith('.log')) return `${target.slice(0, -4)}${PROGRESS_CONFIDENCE_STREAM_SUFFIX}`;
  return `${target}${PROGRESS_CONFIDENCE_STREAM_SUFFIX}`;
};

const toFiniteNonNegative = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const appendSample = (target, value, maxSize = MAX_PROGRESS_SAMPLES) => {
  if (!Array.isArray(target)) return;
  const parsed = toFiniteNonNegative(value);
  if (!Number.isFinite(parsed)) return;
  target.push(parsed);
  if (target.length > maxSize) target.shift();
};

const mean = (values) => {
  if (!Array.isArray(values) || !values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const stdDev = (values, avg = mean(values)) => {
  if (!Array.isArray(values) || values.length < 2 || !Number.isFinite(avg)) return null;
  const variance = values.reduce((sum, value) => {
    const delta = value - avg;
    return sum + (delta * delta);
  }, 0) / values.length;
  return Math.sqrt(Math.max(0, variance));
};

const percentile = (values, ratio) => {
  if (!Array.isArray(values) || !values.length) return null;
  const sorted = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (!sorted.length) return null;
  const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * clamped) - 1));
  return sorted[index];
};

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const formatCompactDuration = (value) => {
  if (!Number.isFinite(value)) return 'n/a';
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
};

const resolveQueueAgeMs = ({ message, event }) => {
  const eventCandidates = [
    event?.queueAgeMs,
    event?.queueDelayMs,
    event?.meta?.queueAgeMs,
    event?.meta?.queueDelayMs,
    event?.meta?.watchdog?.queueDelayMs
  ];
  for (const candidate of eventCandidates) {
    const parsed = toFiniteNonNegative(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  const text = String(message || '');
  if (!text) return null;
  const match = text.match(/\bqueue(?:\s|-)?(?:age|delay|wait|dwell)\b[^0-9]{0,24}(\d+(?:\.\d+)?)\s*ms\b/i);
  if (!match) return null;
  return toFiniteNonNegative(match[1]);
};

const resolveInFlightCount = ({ message, event }) => {
  const eventCandidates = [
    event?.inFlight,
    event?.inflight,
    event?.inFlightCount,
    event?.activeWorkers,
    event?.meta?.inFlight,
    event?.meta?.inFlightCount,
    event?.meta?.activeWorkers,
    event?.meta?.queueDepth
  ];
  for (const candidate of eventCandidates) {
    const parsed = toFiniteNonNegative(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  const text = String(message || '');
  if (!text) return null;
  const inFlightMatch = text.match(/\bin(?:\s|-)?flight\b[^0-9]{0,12}(\d+)\b/i);
  if (inFlightMatch) return toFiniteNonNegative(inFlightMatch[1]);
  const depthMatch = text.match(/\bqueue(?:\s|-)?depth\b[^0-9]{0,8}(\d+)\b/i);
  if (depthMatch) return toFiniteNonNegative(depthMatch[1]);
  return null;
};

const appendJsonLineQueued = (queueByPath, filePath, payload) => {
  if (!(queueByPath instanceof Map)) return;
  if (!filePath) return;
  const prior = queueByPath.get(filePath) || Promise.resolve();
  const next = prior
    .catch(() => {})
    .then(async () => {
      await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
      await fsPromises.appendFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
    })
    .catch(() => {});
  queueByPath.set(filePath, next);
};

const flushQueuedJsonLines = async (queueByPath) => {
  if (!(queueByPath instanceof Map) || queueByPath.size === 0) return;
  const pendingWrites = Array.from(queueByPath.values());
  const flushBatchSize = 32;
  for (let i = 0; i < pendingWrites.length; i += flushBatchSize) {
    const batch = pendingWrites.slice(i, i + flushBatchSize);
    await Promise.all(batch.map((pending) => pending.catch(() => {})));
  }
};

const matchesAnyPattern = (text, patterns) => patterns.some((pattern) => pattern.test(text));

const isQueueDelayHotspot = (message) => {
  const text = String(message || '');
  const normalized = text.toLowerCase();
  const hasQueueSignal = normalized.includes('queue') || normalized.includes(SCHEDULER_EVENT_MARKER);
  if (!hasQueueSignal) return false;
  if (normalized.includes('hotspot') || normalized.includes('backlog') || normalized.includes('stalled')) return true;
  const delayMatch = normalized.match(/\bqueue(?:\s|-)?delay\b[^0-9]{0,32}(\d+(?:\.\d+)?)\s*ms\b/i);
  if (delayMatch) {
    const delayMs = Number(delayMatch[1]);
    if (Number.isFinite(delayMs) && delayMs >= QUEUE_DELAY_HOTSPOT_MS) return true;
  }
  const depthMatch = normalized.match(/\bqueue(?:\s|-)?depth\b[^0-9]{0,8}(\d+)\b/i);
  if (depthMatch) {
    const depth = Number(depthMatch[1]);
    if (Number.isFinite(depth) && depth >= QUEUE_DEPTH_HOTSPOT) return true;
  }
  return normalized.includes('queue delay');
};

const resolveDiagnosticType = (message, event = null) => {
  const text = String(message || '');
  if (!text) return null;
  if (matchesAnyPattern(text, PARSER_CRASH_PATTERNS)) return 'parser_crash';
  if (matchesAnyPattern(text, SCM_TIMEOUT_PATTERNS)) return 'scm_timeout';
  if (matchesAnyPattern(text, ARTIFACT_TAIL_STALL_PATTERNS)) return 'artifact_tail_stall';
  if (isQueueDelayHotspot(text)) return 'queue_delay_hotspot';
  const hasFallbackMeta = event && typeof event === 'object' && (
    event?.meta?.fallback === true
    || normalizeBenchDiagnosticText(event?.meta?.decision || '').includes('fallback')
  );
  if ((/\bfallback\b/i.test(text) || hasFallbackMeta) && !FALLBACK_NEGATIVE_PATTERN.test(text)) {
    return 'fallback_used';
  }
  return null;
};

export const createProcessRunner = ({
  appendLog,
  writeLog,
  writeLogSync,
  logHistory,
  logPath,
  getLogPaths,
  onProgressEvent
}) => {
  let activeChild = null;
  let activeLabel = '';
  let exitLogged = false;
  const interactiveDiagnostics = new Map();
  const ACTIVE_CHILD_SHUTDOWN_WAIT_MS = 15000;

  const setActiveChild = (child, label) => {
    activeChild = child;
    activeLabel = label;
  };

  const clearActiveChild = (childOrPid = null) => {
    if (!activeChild) return;
    const targetPid = Number(
      typeof childOrPid === 'number'
        ? childOrPid
        : childOrPid?.pid
    );
    if (!Number.isFinite(targetPid) || Number(activeChild.pid) === targetPid || activeChild === childOrPid) {
      activeChild = null;
      activeLabel = '';
    }
  };

  const killProcessTree = (pid) => {
    if (!Number.isFinite(pid)) return;
    void killPidTree(pid, {
      killTree: true,
      detached: process.platform !== 'win32',
      graceMs: 0
    }).catch(() => {});
  };

  /**
   * Await active child process exit with a bounded wait window.
   *
   * @param {ChildProcess} child
   * @param {number} timeoutMs
   * @returns {Promise<{exited:boolean,timedOut:boolean,exitCode:number|null,signal:string|null}>}
   */
  const waitForChildExit = (child, timeoutMs) => {
    const safeTimeoutMs = Number.isFinite(Number(timeoutMs))
      ? Math.max(0, Math.floor(Number(timeoutMs)))
      : 0;
    if (!child || typeof child !== 'object' || typeof child.once !== 'function') {
      return Promise.resolve({
        exited: false,
        timedOut: false,
        exitCode: null,
        signal: null
      });
    }
    const currentExitCode = Number(child.exitCode);
    const currentSignal = typeof child.signalCode === 'string' && child.signalCode.trim()
      ? child.signalCode.trim()
      : null;
    if (Number.isFinite(currentExitCode) || currentSignal) {
      return Promise.resolve({
        exited: true,
        timedOut: false,
        exitCode: Number.isFinite(currentExitCode) ? currentExitCode : null,
        signal: currentSignal
      });
    }
    return new Promise((resolve) => {
      let settled = false;
      let timeout = null;
      const finalize = (payload) => {
        if (settled) return;
        settled = true;
        if (timeout) {
          try { clearTimeout(timeout); } catch {}
          timeout = null;
        }
        try {
          child.off?.('exit', onExit);
        } catch {}
        resolve(payload);
      };
      const onExit = (code, signal) => finalize({
        exited: true,
        timedOut: false,
        exitCode: Number.isFinite(Number(code)) ? Number(code) : null,
        signal: typeof signal === 'string' && signal.trim() ? signal.trim() : null
      });
      child.once('exit', onExit);
      if (safeTimeoutMs > 0) {
        timeout = setTimeout(() => finalize({
          exited: false,
          timedOut: true,
          exitCode: Number.isFinite(Number(child.exitCode)) ? Number(child.exitCode) : null,
          signal: typeof child.signalCode === 'string' && child.signalCode.trim()
            ? child.signalCode.trim()
            : null
        }), safeTimeoutMs);
        timeout.unref?.();
      }
    });
  };

  /**
   * Terminate the currently active child process and await exit.
   *
   * @param {{timeoutMs?:number}} [input]
   * @returns {Promise<{attempted:boolean,pid:number|null,label:string,timedOut:boolean,exited:boolean,exitCode:number|null,signal:string|null}>}
   */
  const terminateActiveChild = async ({ timeoutMs = ACTIVE_CHILD_SHUTDOWN_WAIT_MS } = {}) => {
    const child = activeChild;
    const pid = Number(child?.pid);
    const label = activeLabel || '';
    if (!Number.isFinite(pid)) {
      return {
        attempted: false,
        pid: null,
        label,
        timedOut: false,
        exited: false,
        exitCode: null,
        signal: null
      };
    }
    const waitPromise = waitForChildExit(child, timeoutMs);
    killProcessTree(pid);
    const outcome = await waitPromise;
    clearActiveChild(pid);
    return {
      attempted: true,
      pid,
      label,
      ...outcome
    };
  };

  const logExit = (reason, code) => {
    if (exitLogged) return;
    writeLogSync(`[exit] ${reason}${Number.isFinite(code) ? ` code=${code}` : ''}`);
    exitLogged = true;
  };

  const resolveLogPaths = () => {
    try {
      if (typeof getLogPaths === 'function') {
        const resolved = getLogPaths();
        if (Array.isArray(resolved)) return resolved.filter(Boolean);
        if (typeof resolved === 'string' && resolved) return [resolved];
      }
      if (typeof logPath === 'function') {
        const resolved = logPath();
        if (typeof resolved === 'string' && resolved) return [resolved];
      }
      if (typeof logPath === 'string' && logPath) return [logPath];
    } catch {}
    return [];
  };

  const emitLogPaths = (prefix = '[error]') => {
    const paths = resolveLogPaths();
    if (!paths.length) return;
    const names = paths.map((entry) => path.basename(String(entry || ''))).filter(Boolean);
    if (paths.length === 1) {
      const only = paths[0];
      const onlyName = names[0] || 'log';
      appendLog(`[logs] ${onlyName}`, 'info', { fileOnlyLine: `Log: ${only}` });
      writeLog(`${prefix} Log: ${only}`);
      return;
    }
    const joined = paths.join(' ');
    const nameSummary = names.length ? ` (${names.join(', ')})` : '';
    appendLog(`[logs] ${paths.length} files${nameSummary}`, 'info', {
      fileOnlyLine: `Logs: ${joined}`
    });
    writeLog(`${prefix} Logs: ${joined}`);
  };

  const runProcess = async (label, cmd, args, options = {}) => {
    const { continueOnError = false, ...spawnOptionsRest } = options;
    const spawnOptions = {
      ...spawnOptionsRest,
      stdio: ['ignore', 'pipe', 'pipe'],
      rejectOnNonZeroExit: false
    };
    const diagnosticStreams = Array.from(
      new Set(resolveLogPaths().map(resolveDiagnosticsStreamPath).filter(Boolean))
    );
    const progressConfidenceStreams = Array.from(
      new Set(resolveLogPaths().map(resolveProgressConfidenceStreamPath).filter(Boolean))
    );
    const schedulerEvents = [];
    const telemetryWriteQueues = new Map();
    let diagnosticEventCount = 0;
    const diagnosticCountByType = new Map();
    const diagnosticCountById = new Map();
    const heartbeatIntervalsMs = [];
    const queueAgeSamplesMs = [];
    const inFlightSamples = [];
    const progressConfidenceComponents = {
      heartbeatRegularityScore: null,
      queueAgeScore: null,
      inFlightSpreadScore: null,
      stallEventsScore: null
    };
    const progressConfidenceStats = {
      heartbeatCount: 0,
      queueSamples: 0,
      inFlightSamples: 0,
      stallEvents: 0,
      lastHeartbeatMs: null,
      confidenceEvents: 0,
      lastScore: null,
      lastBucket: 'unknown',
      lastEmitMs: 0
    };

    const buildDiagnosticsSummary = () => ({
      schemaVersion: BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION,
      streamPaths: diagnosticStreams,
      eventCount: diagnosticEventCount,
      uniqueEventCount: diagnosticCountById.size,
      countsByType: Object.fromEntries(
        Array.from(diagnosticCountByType.entries())
          .sort(([left], [right]) => String(left).localeCompare(String(right)))
      )
    });

    /**
     * Recompute normalized component scores feeding progress-confidence output.
     *
     * The component formulas intentionally penalize heartbeat jitter, queue-age
     * tails, in-flight spread, and repeated stall events to stabilize the
     * confidence signal across heterogeneous repositories.
     */
    const updateProgressConfidenceComponentScores = () => {
      const heartbeatMean = mean(heartbeatIntervalsMs);
      const heartbeatStd = stdDev(heartbeatIntervalsMs, heartbeatMean);
      if (Number.isFinite(heartbeatMean) && heartbeatMean > 0 && Number.isFinite(heartbeatStd)) {
        const jitter = heartbeatStd / heartbeatMean;
        const longGapCount = heartbeatIntervalsMs.filter((value) => value >= HEARTBEAT_STALL_THRESHOLD_MS).length;
        const longGapRatio = heartbeatIntervalsMs.length > 0 ? longGapCount / heartbeatIntervalsMs.length : 0;
        progressConfidenceComponents.heartbeatRegularityScore = clamp01(1 - (jitter / 1.1) - (longGapRatio * 0.4));
      } else {
        progressConfidenceComponents.heartbeatRegularityScore = null;
      }

      const queueP90 = percentile(queueAgeSamplesMs, 0.9);
      const queueMean = mean(queueAgeSamplesMs);
      const queueStd = stdDev(queueAgeSamplesMs, queueMean);
      if (Number.isFinite(queueP90) && Number.isFinite(queueMean) && Number.isFinite(queueStd)) {
        const queueJitter = queueMean > 0 ? (queueStd / queueMean) : 0;
        progressConfidenceComponents.queueAgeScore = clamp01(1 - (queueP90 / 2500) - (queueJitter * 0.2));
      } else if (Number.isFinite(queueP90)) {
        progressConfidenceComponents.queueAgeScore = clamp01(1 - (queueP90 / 2500));
      } else {
        progressConfidenceComponents.queueAgeScore = null;
      }

      const inFlightMean = mean(inFlightSamples);
      const inFlightStd = stdDev(inFlightSamples, inFlightMean);
      if (Number.isFinite(inFlightMean) && inFlightMean > 0 && inFlightSamples.length >= 2) {
        const min = Math.min(...inFlightSamples);
        const max = Math.max(...inFlightSamples);
        const spread = (max - min) / Math.max(1, inFlightMean);
        const jitterPenalty = Number.isFinite(inFlightStd) ? (inFlightStd / Math.max(1, inFlightMean)) : 0;
        progressConfidenceComponents.inFlightSpreadScore = clamp01(1 - (spread / 2) - (jitterPenalty * 0.25));
      } else {
        progressConfidenceComponents.inFlightSpreadScore = null;
      }

      const stallRate = progressConfidenceStats.heartbeatCount > 0
        ? progressConfidenceStats.stallEvents / Math.max(1, progressConfidenceStats.heartbeatCount)
        : (progressConfidenceStats.stallEvents > 0 ? 1 : 0);
      progressConfidenceComponents.stallEventsScore = clamp01(1 - (stallRate / 0.18));
    };

    const buildProgressConfidenceSnapshot = () => {
      updateProgressConfidenceComponentScores();
      const queueP90 = percentile(queueAgeSamplesMs, 0.9);
      const queueMean = mean(queueAgeSamplesMs);
      const inFlightMean = mean(inFlightSamples);
      const inFlightMin = inFlightSamples.length ? Math.min(...inFlightSamples) : null;
      const inFlightMax = inFlightSamples.length ? Math.max(...inFlightSamples) : null;
      const confidence = computeBenchProgressConfidence({
        heartbeatRegularityScore: progressConfidenceComponents.heartbeatRegularityScore,
        queueAgeScore: progressConfidenceComponents.queueAgeScore,
        inFlightSpreadScore: progressConfidenceComponents.inFlightSpreadScore,
        stallEventsScore: progressConfidenceComponents.stallEventsScore,
        heartbeatSamples: heartbeatIntervalsMs.length,
        queueSamples: queueAgeSamplesMs.length,
        inFlightSamples: inFlightSamples.length,
        stallSamples: progressConfidenceStats.heartbeatCount
      });
      return {
        ...confidence,
        streamPaths: progressConfidenceStreams,
        heartbeat: {
          count: progressConfidenceStats.heartbeatCount,
          meanIntervalMs: mean(heartbeatIntervalsMs),
          p95IntervalMs: percentile(heartbeatIntervalsMs, 0.95)
        },
        queueAge: {
          count: queueAgeSamplesMs.length,
          meanMs: queueMean,
          p90Ms: queueP90
        },
        inFlight: {
          count: inFlightSamples.length,
          mean: inFlightMean,
          min: inFlightMin,
          max: inFlightMax
        },
        stallEvents: progressConfidenceStats.stallEvents,
        confidenceEvents: progressConfidenceStats.confidenceEvents
      };
    };

    const buildProgressConfidenceSummary = () => {
      const snapshot = buildProgressConfidenceSnapshot();
      return {
        ...snapshot,
        generatedAt: new Date().toISOString()
      };
    };

    const emitProgressConfidenceSample = ({
      reason = 'periodic',
      source = 'stream',
      force = false,
      interactive = true
    } = {}) => {
      const now = Date.now();
      const snapshot = buildProgressConfidenceSnapshot();
      const score = Number(snapshot?.score);
      const priorScore = Number(progressConfidenceStats.lastScore);
      const changed = Number.isFinite(score)
        && (!Number.isFinite(priorScore) || Math.abs(score - priorScore) >= PROGRESS_CONFIDENCE_EMIT_DELTA);
      const bucketChanged = snapshot?.bucket && snapshot.bucket !== progressConfidenceStats.lastBucket;
      const periodic = now - progressConfidenceStats.lastEmitMs >= PROGRESS_CONFIDENCE_EMIT_INTERVAL_MS;
      if (!force && !periodic && !changed && !bucketChanged) return;

      progressConfidenceStats.lastEmitMs = now;
      progressConfidenceStats.lastScore = Number.isFinite(score) ? score : null;
      progressConfidenceStats.lastBucket = snapshot?.bucket || 'unknown';
      progressConfidenceStats.confidenceEvents += 1;

      const payload = {
        schemaVersion: snapshot.schemaVersion,
        ts: new Date().toISOString(),
        label,
        command: toText(cmd) || null,
        source: toText(source) || 'stream',
        reason: toText(reason) || 'periodic',
        score: snapshot.score,
        bucket: snapshot.bucket,
        text: snapshot.text,
        components: snapshot.components,
        samples: snapshot.samples,
        heartbeat: snapshot.heartbeat,
        queueAge: snapshot.queueAge,
        inFlight: snapshot.inFlight,
        stallEvents: snapshot.stallEvents
      };
      for (const filePath of progressConfidenceStreams) {
        appendJsonLineQueued(telemetryWriteQueues, filePath, payload);
      }

      if (!interactive) return;
      const level = snapshot.bucket === 'low' ? 'warn' : 'info';
      const confidenceText = formatBenchProgressConfidence(snapshot.score);
      const inFlightSpread = Number.isFinite(snapshot.inFlight?.max) && Number.isFinite(snapshot.inFlight?.min)
        ? (snapshot.inFlight.max - snapshot.inFlight.min)
        : null;
      appendLog(
        `[progress] confidence ${confidenceText} | ` +
        `hb ${formatCompactDuration(snapshot.heartbeat?.meanIntervalMs)} (p95 ${formatCompactDuration(snapshot.heartbeat?.p95IntervalMs)}) | ` +
        `queue p90 ${formatCompactDuration(snapshot.queueAge?.p90Ms)} | ` +
        `in-flight spread ${Number.isFinite(inFlightSpread) ? inFlightSpread.toFixed(1) : 'n/a'} | ` +
        `stalls ${snapshot.stallEvents}`,
        level
      );
    };

    const observeProgressTelemetry = ({ message = '', event = null, source = 'stream' } = {}) => {
      const now = Date.now();
      const eventName = String(event?.event || '').toLowerCase();
      const hasHeartbeatSignal = eventName.startsWith('task:')
        && (eventName === 'task:start' || eventName === 'task:progress' || eventName === 'task:end');
      if (hasHeartbeatSignal) {
        if (Number.isFinite(progressConfidenceStats.lastHeartbeatMs)) {
          const intervalMs = Math.max(0, now - progressConfidenceStats.lastHeartbeatMs);
          appendSample(heartbeatIntervalsMs, intervalMs);
          if (intervalMs >= HEARTBEAT_STALL_THRESHOLD_MS) {
            progressConfidenceStats.stallEvents += 1;
          }
        }
        progressConfidenceStats.lastHeartbeatMs = now;
        progressConfidenceStats.heartbeatCount += 1;
      }

      const queueAgeMs = resolveQueueAgeMs({ message, event });
      if (Number.isFinite(queueAgeMs)) {
        appendSample(queueAgeSamplesMs, queueAgeMs);
        progressConfidenceStats.queueSamples = queueAgeSamplesMs.length;
      }
      const inFlight = resolveInFlightCount({ message, event });
      if (Number.isFinite(inFlight)) {
        appendSample(inFlightSamples, inFlight);
        progressConfidenceStats.inFlightSamples = inFlightSamples.length;
      }

      emitProgressConfidenceSample({
        reason: hasHeartbeatSignal ? eventName : 'line',
        source,
        interactive: hasHeartbeatSignal
      });
    };

    const noteStallEvent = ({ source = 'stream', reason = 'stall-event' } = {}) => {
      progressConfidenceStats.stallEvents += 1;
      emitProgressConfidenceSample({
        reason,
        source,
        force: true,
        interactive: true
      });
    };

    const maybeEmitInteractiveDiagnostic = ({ eventType, eventId, message }) => {
      const key = String(eventId || '');
      if (!key) return;
      const now = Date.now();
      const prior = interactiveDiagnostics.get(key) || { count: 0, lastEmitMs: 0 };
      const next = {
        count: prior.count + 1,
        lastEmitMs: prior.lastEmitMs
      };
      const shouldEmit = next.count === 1
        || (next.count % DIAGNOSTIC_REPEAT_COUNT === 0)
        || (now - next.lastEmitMs >= DIAGNOSTIC_REPEAT_INTERVAL_MS);
      if (!shouldEmit) {
        interactiveDiagnostics.set(key, next);
        return;
      }
      const repeat = next.count > 1 ? ` x${next.count}` : '';
      const excerpt = truncateForDisplay(message, 110);
      appendLog(`[diagnostics] ${eventType}${repeat} ${eventId} ${excerpt}`, 'warn');
      next.lastEmitMs = now;
      interactiveDiagnostics.set(key, next);
    };

    const emitDiagnostic = ({
      eventType,
      message,
      source = 'stream',
      level = null,
      stage = null,
      taskId = null
    }) => {
      if (!eventType || !message) return;
      const signature = buildBenchDiagnosticSignature({
        eventType,
        stage,
        taskId,
        source,
        message: normalizeSignatureMessage(message)
      });
      const eventId = buildBenchDiagnosticEventId({ eventType, signature });
      const occurrence = (diagnosticCountById.get(eventId) || 0) + 1;
      diagnosticCountById.set(eventId, occurrence);
      diagnosticCountByType.set(eventType, (diagnosticCountByType.get(eventType) || 0) + 1);
      diagnosticEventCount += 1;
      const payload = {
        schemaVersion: BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION,
        ts: new Date().toISOString(),
        eventType,
        eventId,
        occurrence,
        signature,
        label,
        command: toText(cmd) || null,
        source: toText(source) || 'stream',
        message: truncateForDisplay(message, 400),
        level: toText(level) || null,
        stage: toText(stage) || null,
        taskId: toText(taskId) || null
      };
      for (const filePath of diagnosticStreams) {
        appendJsonLineQueued(telemetryWriteQueues, filePath, payload);
      }
      maybeEmitInteractiveDiagnostic({ eventType, eventId, message: payload.message });
      if (eventType === 'queue_delay_hotspot' || eventType === 'artifact_tail_stall') {
        noteStallEvent({
          source: payload.source,
          reason: eventType
        });
      }
    };

    const inspectDiagnostic = ({ line, event, source }) => {
      const text = event && typeof event.message === 'string' && event.message.trim()
        ? event.message
        : line;
      const eventType = resolveDiagnosticType(text, event);
      if (!eventType) return;
      emitDiagnostic({
        eventType,
        message: text,
        source: event ? 'progress-event' : source,
        level: event?.level || null,
        stage: event?.stage || null,
        taskId: event?.taskId || null
      });
    };

    const pushSchedulerEvent = ({ message = '', source = 'stream', level = null, stage = null, taskId = null } = {}) => {
      const resolvedMessage = String(message || '').trim();
      if (!resolvedMessage || !resolvedMessage.includes(SCHEDULER_EVENT_MARKER)) return;
      schedulerEvents.push({
        ts: new Date().toISOString(),
        source,
        message: resolvedMessage,
        ...(typeof level === 'string' && level ? { level } : {}),
        ...(typeof stage === 'string' && stage ? { stage } : {}),
        ...(typeof taskId === 'string' && taskId ? { taskId } : {})
      });
      if (schedulerEvents.length > SCHEDULER_EVENT_WINDOW) schedulerEvents.shift();
    };
    const getSchedulerEvents = () => schedulerEvents.slice();
    setActiveChild({ pid: null }, label);
    writeLog(`[start] ${label}`);
    const handleLine = ({ line, event = null, source = 'stream' }) => {
      const textLine = String(line || '');
      const parsedEvent = event || (textLine ? parseProgressEventLine(textLine, { strict: true }) : null);
      inspectDiagnostic({ line: textLine, event: parsedEvent, source });
      if (parsedEvent) {
        pushSchedulerEvent({
          source: 'progress-event',
          message: parsedEvent?.message || '',
          level: parsedEvent?.level || null,
          stage: parsedEvent?.stage || null,
          taskId: parsedEvent?.taskId || null
        });
      } else {
        pushSchedulerEvent({
          source,
          message: textLine
        });
      }
      observeProgressTelemetry({
        message: parsedEvent?.message || textLine,
        event: parsedEvent,
        source: parsedEvent ? 'progress-event' : source
      });
      if (parsedEvent && typeof onProgressEvent === 'function') {
        onProgressEvent(parsedEvent);
        return;
      }
      appendLog(textLine);
    };
    const stdoutDecoder = createProgressLineDecoder({
      strict: true,
      onLine: ({ line, event }) => handleLine({ line, event, source: 'stdout' }),
      onOverflow: () => writeLog('[warn] truncated oversized stdout progress line')
    });
    const stderrDecoder = createProgressLineDecoder({
      strict: true,
      onLine: ({ line, event }) => handleLine({ line, event, source: 'stderr' }),
      onOverflow: () => writeLog('[warn] truncated oversized stderr progress line')
    });
    try {
      const result = await spawnSubprocess(cmd, args, {
        ...spawnOptions,
        onSpawn: (child) => setActiveChild(child, label),
        onStdout: (chunk) => stdoutDecoder.push(chunk),
        onStderr: (chunk) => stderrDecoder.push(chunk)
      });
      stdoutDecoder.flush();
      stderrDecoder.flush();
      const code = result.exitCode;
      const signal = typeof result.signal === 'string' && result.signal.trim().length > 0
        ? result.signal.trim()
        : null;
      writeLog(`[finish] ${label} code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      clearActiveChild(result.pid);
      emitProgressConfidenceSample({
        reason: 'process-exit',
        source: 'exit',
        force: true,
        interactive: false
      });
      if (code === 0) {
        await flushQueuedJsonLines(telemetryWriteQueues);
        return {
          ok: true,
          schedulerEvents: getSchedulerEvents(),
          diagnostics: buildDiagnosticsSummary(),
          progressConfidence: buildProgressConfidenceSummary()
        };
      }
      appendLog(`[run] failed: ${label}`);
      writeLog(`[error] run failed: ${label}`);
      emitLogPaths('[error]');
      if (logHistory.length) {
        appendLog('[run] tail:');
        logHistory.slice(-10).forEach((line) => appendLog(`- ${line}`));
        logHistory.slice(-10).forEach((line) => writeLog(`[error] ${line}`));   
      }
      if (logHistory.some((line) => line.toLowerCase().includes('filename too long'))) {
        appendLog('[hint] Windows long paths: set `git config --global core.longpaths true` or use a shorter --root.');
        writeLog('[hint] Enable Windows long paths and set `git config --global core.longpaths true` or use a shorter --root path.');
      }
      if (!continueOnError) {
        await flushQueuedJsonLines(telemetryWriteQueues);
        logExit('failure', code ?? 1);
        exitLikeCommandResult({ status: code, signal });
      }
      await flushQueuedJsonLines(telemetryWriteQueues);
      return {
        ok: false,
        code: code ?? 1,
        signal,
        schedulerEvents: getSchedulerEvents(),
        diagnostics: buildDiagnosticsSummary(),
        progressConfidence: buildProgressConfidenceSummary()
      };
    } catch (err) {
      stdoutDecoder.flush();
      stderrDecoder.flush();
      const message = err?.message || err;
      const failureStatus = Number.isInteger(err?.result?.exitCode)
        ? Number(err.result.exitCode)
        : (Number.isInteger(err?.exitCode) ? Number(err.exitCode) : null);
      const failureSignal = typeof err?.result?.signal === 'string' && err.result.signal.trim().length > 0
        ? err.result.signal.trim()
        : null;
      writeLog(`[error] ${label} spawn failed: ${message}`);
      clearActiveChild(err?.result?.pid ?? null);
      appendLog(`[run] failed: ${label}`);
      if (err?.code === 'SUBPROCESS_TIMEOUT') {
        appendLog(`[run] timeout: ${label} (${message})`, 'warn');
      }
      emitLogPaths('[error]');
      if (logHistory.length) {
        appendLog('[run] tail:');
        logHistory.slice(-10).forEach((line) => appendLog(`- ${line}`));
        logHistory.slice(-10).forEach((line) => writeLog(`[error] ${line}`));   
      }
      if (!continueOnError) {
        await flushQueuedJsonLines(telemetryWriteQueues);
        logExit('failure', failureStatus ?? 1);
        exitLikeCommandResult({ status: failureStatus, signal: failureSignal });
      }
      emitProgressConfidenceSample({
        reason: 'spawn-error',
        source: 'error',
        force: true,
        interactive: false
      });
      await flushQueuedJsonLines(telemetryWriteQueues);
      return {
        ok: false,
        code: failureStatus ?? 1,
        signal: failureSignal,
        schedulerEvents: getSchedulerEvents(),
        diagnostics: buildDiagnosticsSummary(),
        progressConfidence: buildProgressConfidenceSummary()
      };
    }
  };

  return {
    runProcess,
    killProcessTree,
    terminateActiveChild,
    logExit,
    getActiveChild: () => activeChild,
    getActiveLabel: () => activeLabel
  };
};
