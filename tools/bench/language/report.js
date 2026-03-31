import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../../src/shared/progress.js';
import { mergeReuseSummaries, summarizeReuseObservations } from '../../../src/shared/reuse-diagnostics.js';
import {
  STAGE_TIMING_SCHEMA_VERSION,
  THROUGHPUT_LEDGER_DIFF_SCHEMA_VERSION,
  THROUGHPUT_LEDGER_SCHEMA_VERSION,
  buildThroughputLedgerForTask,
  buildStageTimingProfileForTask,
  computeThroughputLedgerRegression,
  computeLowHitSeverity,
  createEmptyStageTimingProfile,
  finalizeStageTimingProfile,
  isValidThroughputLedger,
  mergeStageTimingProfile
} from './metrics.js';
import {
  BENCH_DIAGNOSTIC_EVENT_TYPES,
  BENCH_DIAGNOSTIC_MATERIAL_PARITY_EVENT_TYPES,
  BENCH_DIAGNOSTIC_PARITY_EVENT_TYPES,
  BENCH_DIAGNOSTIC_SEVERITY_LEVELS,
  BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION,
  BENCH_PROGRESS_CONFIDENCE_SCHEMA_VERSION,
  buildBenchDiagnosticEventId,
  buildBenchDiagnosticSignature,
  createBenchDiagnosticClassifier,
  parseBenchReuseObservation,
  normalizeBenchDiagnosticSeverity,
  normalizeBenchDiagnosticText,
  resolveBenchDiagnosticSeverity
} from './logging.js';
import { evaluateBenchVerdict, loadBenchPolicy } from './verdict.js';
import {
  buildBenchMethodologyTaskId,
  buildBenchMetricTags
} from './policy.js';
import {
  buildBenchOwnershipSummary,
  buildBenchReuseSummary
} from './ownership.js';
import {
  buildBenchRuntimeBlockerConfirmationSummary,
  loadBenchRuntimeCanaryManifest,
  validateBenchRuntimeCanaryManifest
} from './canaries.js';

const resolveCrashRetention = (entry) => {
  const direct = entry?.crashRetention && typeof entry.crashRetention === 'object'
    ? entry.crashRetention
    : null;
  if (direct) return direct;
  const nested = entry?.diagnostics?.crashRetention && typeof entry.diagnostics.crashRetention === 'object'
    ? entry.diagnostics.crashRetention
    : null;
  return nested;
};

const buildCrashRetentionSummary = (results) => {
  const retained = [];
  for (const entry of Array.isArray(results) ? results : []) {
    const crashRetention = resolveCrashRetention(entry);
    if (!crashRetention?.bundlePath) continue;
    retained.push({
      language: entry.language,
      tier: entry.tier,
      repo: entry.repo,
      bundlePath: crashRetention.bundlePath,
      markerPath: crashRetention.markerPath || null,
      diagnosticsDir: crashRetention.diagnosticsDir || null,
      checksum: crashRetention.checksum || null
    });
  }
  return {
    retainedCount: retained.length,
    retained
  };
};

const DIAGNOSTIC_STREAM_FILE_SUFFIX = '.diagnostics.jsonl';
const PROGRESS_CONFIDENCE_STREAM_FILE_SUFFIX = '.progress-confidence.jsonl';
const LOG_FILE_SUFFIX = '.log';
const PREFLIGHT_LOG_SCHEMA_VERSION = 1;
const PREFLIGHT_EVENT_TYPE_SET = new Set([
  'start',
  'cache_hit',
  'ok',
  'degraded',
  'blocked',
  'timeout',
  'failed',
  'queued',
  'dequeued',
  'teardown_timeout',
  'teardown_abort',
  'teardown_force_cleanup',
  'teardown_failed'
]);
const PREFLIGHT_EVENT_STATE_BY_EVENT = Object.freeze({
  ok: 'ready',
  degraded: 'degraded',
  blocked: 'blocked',
  timeout: 'degraded',
  failed: 'failed',
  cache_hit: 'ready'
});
const PREFLIGHT_TOP_SLOW_LIMIT = 20;

const loadJsonFile = async (filePath) => {
  try {
    if (!filePath) return null;
    return JSON.parse(await fsPromises.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const forEachNonEmptyLine = (raw, onLine) => {
  if (typeof raw !== 'string' || !raw) return;
  if (typeof onLine !== 'function') return;
  let start = 0;
  const length = raw.length;
  while (start <= length) {
    let end = raw.indexOf('\n', start);
    if (end === -1) end = length;
    let line = raw.slice(start, end);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    const trimmed = line.trim();
    if (trimmed) onLine(trimmed);
    if (end >= length) break;
    start = end + 1;
  }
};

const pushTopNOrdered = (rows, entry, limit, compare) => {
  if (!Array.isArray(rows) || typeof compare !== 'function') return;
  const cap = Number.isFinite(Number(limit)) ? Math.max(1, Math.floor(Number(limit))) : 1;
  let insertAt = rows.length;
  while (insertAt > 0 && compare(entry, rows[insertAt - 1]) < 0) {
    insertAt -= 1;
  }
  if (rows.length < cap) {
    rows.splice(insertAt, 0, entry);
    return;
  }
  if (insertAt >= cap) return;
  rows.splice(insertAt, 0, entry);
  rows.length = cap;
};

const mapWithConcurrency = async (values, worker, { concurrency = 8 } = {}) => {
  const input = Array.isArray(values) ? values : [];
  if (!input.length) return [];
  if (typeof worker !== 'function') return input.slice();
  const limit = Number.isFinite(Number(concurrency))
    ? Math.max(1, Math.floor(Number(concurrency)))
    : 1;
  const out = new Array(input.length);
  let cursor = 0;
  const nextIndex = () => {
    if (cursor >= input.length) return null;
    const index = cursor;
    cursor += 1;
    return index;
  };
  const workers = new Array(Math.min(limit, input.length)).fill(null).map(async () => {
    while (true) {
      const index = nextIndex();
      if (index == null) return;
      out[index] = await worker(input[index], index);
    }
  });
  await Promise.all(workers);
  return out;
};

const resolveRunLogPrefix = (runSuffix) => {
  const normalized = String(runSuffix || '').trim();
  if (!normalized) return null;
  return normalized.startsWith('run-')
    ? `${normalized}-`
    : `run-${normalized}-`;
};

const isMasterBenchStreamFile = (filePath) => /^run-.*-all\.[^.]+(?:\..+)?$/i.test(path.basename(String(filePath || '')));

const resolveBenchStreamScope = (filePath) => {
  const name = path.basename(String(filePath || ''));
  return name.replace(/^run-.*?-/, '').replace(/\.[^.]+(?:\..+)?$/i, '') || name;
};

const filterCanonicalBenchStreamFiles = (files) => {
  const list = Array.isArray(files) ? files.slice() : [];
  return list;
};

const listBenchStreamFiles = async (resultsRoot, suffix, { runSuffix = null } = {}) => {
  if (!resultsRoot) return [];
  const root = path.join(resultsRoot, 'logs', 'bench-language');
  const files = [];
  const queue = [root];
  const normalizedSuffix = String(suffix || '');
  const runPrefix = resolveRunLogPrefix(runSuffix);
  while (queue.length) {
    const current = queue.pop();
    let entries = [];
    try {
      entries = await fsPromises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(resolved);
        continue;
      }
      if (!entry.isFile()) continue;
      if (normalizedSuffix && !entry.name.endsWith(normalizedSuffix)) continue;
      if (runPrefix && !entry.name.startsWith(runPrefix)) continue;
      files.push(resolved);
    }
  }
  return filterCanonicalBenchStreamFiles(files)
    .sort((left, right) => left.localeCompare(right));
};

const buildSyntheticEventKey = (parts) => JSON.stringify(Array.isArray(parts) ? parts : []);

const bumpMapCount = (map, key, count = 1) => {
  if (!(map instanceof Map) || !key) return;
  map.set(key, (map.get(key) || 0) + count);
};

const sortMapObject = (map) => Object.fromEntries(
  Array.from((map instanceof Map ? map : new Map()).entries())
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
);

const sumMapObjectValues = (map) => (
  Array.from((map instanceof Map ? map : new Map()).values())
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0)
);

const formatCompactDuration = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '0ms';
  if (numeric < 1000) return `${Math.round(numeric)}ms`;
  if (numeric < 60_000) return `${(numeric / 1000).toFixed(1)}s`;
  const minutes = Math.floor(numeric / 60_000);
  const seconds = ((numeric % 60_000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
};

const listDiagnosticsStreamFiles = async (resultsRoot, options = {}) => (
  listBenchStreamFiles(resultsRoot, DIAGNOSTIC_STREAM_FILE_SUFFIX, options)
);

const parseDiagnosticEventLine = (line) => {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const eventType = typeof parsed.eventType === 'string' ? parsed.eventType.trim() : '';
  const signature = typeof parsed.signature === 'string'
    ? parsed.signature
    : buildBenchDiagnosticSignature({
      eventType,
      stage: parsed.stage || '',
      taskId: parsed.taskId || '',
      source: parsed.source || '',
      providerId: parsed.providerId || '',
      workspacePartition: parsed.workspacePartition || '',
      requestMethod: parsed.requestMethod || '',
      failureClass: parsed.failureClass || '',
      preflightId: parsed.preflightId || '',
      preflightClass: parsed.preflightClass || '',
      preflightState: parsed.preflightState || '',
      message: normalizeBenchDiagnosticText(parsed.message || '', { maxLength: 220 })
    });
  const eventId = typeof parsed.eventId === 'string' && parsed.eventId.trim()
    ? parsed.eventId.trim()
    : buildBenchDiagnosticEventId({ eventType, signature });
  const message = typeof parsed.message === 'string' ? parsed.message : '';
  const label = typeof parsed.label === 'string' && parsed.label.trim()
    ? parsed.label.trim()
    : null;
  const severity = normalizeBenchDiagnosticSeverity(
    parsed.severity,
    resolveBenchDiagnosticSeverity({
      eventType,
      failureClass: parsed.failureClass || null,
      preflightState: parsed.preflightState || null
    })
  );
  return {
    eventType,
    eventId,
    signature,
    message,
    label,
    severity,
    providerId: typeof parsed.providerId === 'string' && parsed.providerId.trim()
      ? parsed.providerId.trim()
      : null,
    workspacePartition: typeof parsed.workspacePartition === 'string' && parsed.workspacePartition.trim()
      ? parsed.workspacePartition.trim()
      : null,
    requestMethod: typeof parsed.requestMethod === 'string' && parsed.requestMethod.trim()
      ? parsed.requestMethod.trim()
      : null,
    failureClass: typeof parsed.failureClass === 'string' && parsed.failureClass.trim()
      ? parsed.failureClass.trim()
      : null,
    preflightId: typeof parsed.preflightId === 'string' && parsed.preflightId.trim()
      ? parsed.preflightId.trim()
      : null,
    preflightClass: typeof parsed.preflightClass === 'string' && parsed.preflightClass.trim()
      ? parsed.preflightClass.trim()
      : null,
    preflightState: typeof parsed.preflightState === 'string' && parsed.preflightState.trim()
      ? parsed.preflightState.trim()
      : null,
    reuseSurface: typeof parsed.reuseSurface === 'string' && parsed.reuseSurface.trim()
      ? parsed.reuseSurface.trim()
      : null,
    reuseSource: typeof parsed.reuseSource === 'string' && parsed.reuseSource.trim()
      ? parsed.reuseSource.trim()
      : null,
    qualityImpact: typeof parsed.qualityImpact === 'string' && parsed.qualityImpact.trim()
      ? parsed.qualityImpact.trim()
      : null,
    timeCostMs: Number.isFinite(Number(parsed.timeCostMs))
      ? Math.max(0, Math.floor(Number(parsed.timeCostMs)))
      : null,
    requestedCount: Number.isFinite(Number(parsed.requestedCount))
      ? Math.max(0, Math.floor(Number(parsed.requestedCount)))
      : null,
    reusedCount: Number.isFinite(Number(parsed.reusedCount))
      ? Math.max(0, Math.floor(Number(parsed.reusedCount)))
      : null,
    fetchedCount: Number.isFinite(Number(parsed.fetchedCount))
      ? Math.max(0, Math.floor(Number(parsed.fetchedCount)))
      : null,
    chunkCount: Number.isFinite(Number(parsed.chunkCount))
      ? Math.max(0, Math.floor(Number(parsed.chunkCount)))
      : null,
    timeoutKind: typeof parsed.timeoutKind === 'string' && parsed.timeoutKind.trim()
      ? parsed.timeoutKind.trim()
      : null,
    phase: typeof parsed.phase === 'string' && parsed.phase.trim()
      ? parsed.phase.trim()
      : null,
    resourceClass: typeof parsed.resourceClass === 'string' && parsed.resourceClass.trim()
      ? parsed.resourceClass.trim()
      : null,
    failureMode: typeof parsed.failureMode === 'string' && parsed.failureMode.trim()
      ? parsed.failureMode.trim()
      : null,
    decisionReason: typeof parsed.decisionReason === 'string' && parsed.decisionReason.trim()
      ? parsed.decisionReason.trim()
      : null,
    outcome: typeof parsed.outcome === 'string' && parsed.outcome.trim()
      ? parsed.outcome.trim()
      : null,
    effectiveBudgetMs: Number.isFinite(Number(parsed.effectiveBudgetMs))
      ? Math.max(0, Math.floor(Number(parsed.effectiveBudgetMs)))
      : null,
    skippedWork: Array.isArray(parsed.skippedWork)
      ? parsed.skippedWork
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(Boolean)
      : null,
    partialSuccess: typeof parsed.partialSuccess === 'boolean'
      ? parsed.partialSuccess
      : null
  };
};

const buildPreflightEventKey = (event) => {
  if (!event || typeof event !== 'object') return null;
  return JSON.stringify([
    event.event || null,
    event.providerId || null,
    event.preflightId || null,
    event.preflightClass || null,
    event.state || null,
    Number.isFinite(event.durationMs) ? event.durationMs : null,
    event.timedOut === true
  ]);
};

const buildPreflightSummaryKey = (scope, summary) => {
  if (!summary || typeof summary !== 'object') return null;
  return JSON.stringify([
    scope || null,
    Number.isFinite(summary.total) ? summary.total : null,
    Number.isFinite(summary.cached) ? summary.cached : null,
    Number.isFinite(summary.timedOut) ? summary.timedOut : null,
    Number.isFinite(summary.failed) ? summary.failed : null,
    Number.isFinite(summary.queuePeak) ? summary.queuePeak : null,
    summary.teardownTimedOut === true,
    summary.countsByState || null,
    summary.countsByClass || null,
    summary.countsByPolicy || null
  ]);
};

const buildPreflightSlowestKey = (scope, entry) => {
  if (!entry || typeof entry !== 'object') return null;
  return JSON.stringify([
    scope || null,
    entry.providerId || null,
    entry.preflightId || null,
    entry.preflightClass || null,
    entry.state || null,
    entry.event || null,
    Number.isFinite(entry.durationMs) ? entry.durationMs : null
  ]);
};

const buildProgressConfidenceEventKey = (scope, event) => {
  if (!event || typeof event !== 'object') return null;
  return JSON.stringify([
    event.label || scope || null,
    event.ts || null,
    event.bucket || null,
    Number.isFinite(event.score) ? Number(event.score) : null,
    event.reason || null
  ]);
};

const buildDiagnosticsStreamSummary = async (resultsRoot, options = {}) => {
  const files = await listDiagnosticsStreamFiles(resultsRoot, options);
  const orderedFiles = files
    .slice()
    .sort((left, right) => Number(isMasterBenchStreamFile(left)) - Number(isMasterBenchStreamFile(right))
      || left.localeCompare(right));
  const countsByType = new Map();
  const countsBySeverity = new Map();
  const countsByFailureClass = new Map();
  const countsByReuseSurface = new Map();
  const countsByReuseSource = new Map();
  const countsByQualityImpact = new Map();
  const uniqueEventIds = new Set();
  const repoEventIds = new Set();
  const repoTypePresence = new Set();
  const knownTypes = new Set(BENCH_DIAGNOSTIC_EVENT_TYPES);
  const perFile = [];
  let rawEventCount = 0;
  let malformedLines = 0;
  let totalTimeCostMs = 0;
  let totalRequestedCount = 0;
  let totalReusedCount = 0;
  let totalFetchedCount = 0;
  let totalChunkCount = 0;

  for (const filePath of orderedFiles) {
    let raw = '';
    try {
      raw = await fsPromises.readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    const fileCounts = new Map();
    const fileSeverityCounts = new Map();
    let fileEventCount = 0;
    forEachNonEmptyLine(raw, (line) => {
      const parsed = parseDiagnosticEventLine(line);
      if (!parsed) {
        malformedLines += 1;
        return;
      }
      if (!parsed.eventType) return;
      rawEventCount += 1;
      fileEventCount += 1;
      const scope = parsed.label || resolveBenchStreamScope(filePath);
      const masterFile = isMasterBenchStreamFile(filePath);
      const eventKey = buildSyntheticEventKey([masterFile ? 'master' : scope, parsed.eventId]);
      if (masterFile && repoEventIds.has(parsed.eventId)) return;
      if (uniqueEventIds.has(eventKey)) return;
      uniqueEventIds.add(eventKey);
      if (!masterFile) repoEventIds.add(parsed.eventId);
      repoTypePresence.add(buildSyntheticEventKey([scope, parsed.eventType]));
      countsByType.set(parsed.eventType, (countsByType.get(parsed.eventType) || 0) + 1);
      countsBySeverity.set(parsed.severity, (countsBySeverity.get(parsed.severity) || 0) + 1);
      if (parsed.failureClass) {
        countsByFailureClass.set(parsed.failureClass, (countsByFailureClass.get(parsed.failureClass) || 0) + 1);
      }
      if (parsed.reuseSurface) {
        countsByReuseSurface.set(parsed.reuseSurface, (countsByReuseSurface.get(parsed.reuseSurface) || 0) + 1);
      }
      if (parsed.reuseSource) {
        countsByReuseSource.set(parsed.reuseSource, (countsByReuseSource.get(parsed.reuseSource) || 0) + 1);
      }
      if (parsed.qualityImpact) {
        countsByQualityImpact.set(parsed.qualityImpact, (countsByQualityImpact.get(parsed.qualityImpact) || 0) + 1);
      }
      totalTimeCostMs += Number(parsed.timeCostMs) || 0;
      totalRequestedCount += Number(parsed.requestedCount) || 0;
      totalReusedCount += Number(parsed.reusedCount) || 0;
      totalFetchedCount += Number(parsed.fetchedCount) || 0;
      totalChunkCount += Number(parsed.chunkCount) || 0;
      fileCounts.set(parsed.eventType, (fileCounts.get(parsed.eventType) || 0) + 1);
      fileSeverityCounts.set(parsed.severity, (fileSeverityCounts.get(parsed.severity) || 0) + 1);
    });
    perFile.push({
      path: filePath,
      eventCount: fileEventCount,
      countsByType: Object.fromEntries(
        Array.from(fileCounts.entries()).sort(([left], [right]) => left.localeCompare(right))
      ),
      countsBySeverity: Object.fromEntries(
        BENCH_DIAGNOSTIC_SEVERITY_LEVELS.map((severity) => [severity, fileSeverityCounts.get(severity) || 0])
      )
    });
  }

  const required = Object.fromEntries(
    BENCH_DIAGNOSTIC_EVENT_TYPES.map((type) => [type, countsByType.get(type) || 0])
  );
  const repoCountsByType = new Map();
  for (const presenceKey of repoTypePresence) {
    const parsed = JSON.parse(String(presenceKey || '[]'));
    const eventType = String(parsed?.[1] || '').trim();
    if (!eventType) continue;
    repoCountsByType.set(eventType, (repoCountsByType.get(eventType) || 0) + 1);
  }
  let unknownTypeCount = 0;
  for (const [type, count] of countsByType.entries()) {
    if (knownTypes.has(type)) continue;
    unknownTypeCount += count;
  }

  return {
    schemaVersion: BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION,
    fileCount: files.length,
    files: perFile,
    eventCount: uniqueEventIds.size,
    rawEventCount,
    duplicateEventCount: Math.max(0, rawEventCount - uniqueEventIds.size),
    uniqueEventCount: uniqueEventIds.size,
    countScopes: {
      countsByType: 'event_presence',
      repoCountsByType: 'repo_presence'
    },
    countsByType: Object.fromEntries(
      Array.from(countsByType.entries()).sort(([left], [right]) => left.localeCompare(right))
    ),
    repoCountsByType: Object.fromEntries(
      Array.from(repoCountsByType.entries()).sort(([left], [right]) => left.localeCompare(right))
    ),
    countsBySeverity: Object.fromEntries(
      BENCH_DIAGNOSTIC_SEVERITY_LEVELS.map((severity) => [severity, countsBySeverity.get(severity) || 0])
    ),
    countsByFailureClass: sortMapObject(countsByFailureClass),
    countsByReuseSurface: sortMapObject(countsByReuseSurface),
    countsByReuseSource: sortMapObject(countsByReuseSource),
    countsByQualityImpact: sortMapObject(countsByQualityImpact),
    cost: {
      timeCostMs: totalTimeCostMs,
      requestedCount: totalRequestedCount,
      reusedCount: totalReusedCount,
      fetchedCount: totalFetchedCount,
      chunkCount: totalChunkCount
    },
    required,
    unknownTypeCount,
    malformedLines
  };
};

const buildDiagnosticsParitySummary = async (resultsRoot, diagnosticsStream, options = {}) => {
  const files = await listBenchStreamFiles(resultsRoot, LOG_FILE_SUFFIX, options);
  const orderedFiles = files
    .slice()
    .sort((left, right) => Number(isMasterBenchStreamFile(left)) - Number(isMasterBenchStreamFile(right))
      || left.localeCompare(right));
  const parityTypes = new Set(BENCH_DIAGNOSTIC_PARITY_EVENT_TYPES);
  const materialTypes = new Set(BENCH_DIAGNOSTIC_MATERIAL_PARITY_EVENT_TYPES);
  const fallbackNegativePattern = /\b(?:no|without)\s+fallback\b|\bfallback\s+(?:disabled|off)\b/i;
  const countsFromLogs = new Map();
  const repoCountsFromLogs = new Map();
  const uniqueEventKeys = new Set();
  const repoEventKeys = new Set();
  const repoTypePresence = new Set();
  let rawEventCount = 0;

  for (const filePath of orderedFiles) {
    let raw = '';
    try {
      raw = await fsPromises.readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    const classifier = createBenchDiagnosticClassifier();
    forEachNonEmptyLine(raw, (line) => {
      const scope = resolveBenchStreamScope(filePath);
      const masterFile = isMasterBenchStreamFile(filePath);
      const signals = classifier.classify({ line, source: 'log' })
        .filter((signal) => parityTypes.has(signal?.eventType));
      if (
        parityTypes.has('fallback_used')
        && /\bfallback\b/i.test(line)
        && !parseBenchReuseObservation(line)
        && !fallbackNegativePattern.test(line)
      ) {
        signals.push({
          eventType: 'fallback_used',
          message: line,
          source: 'log'
        });
      }
      for (const signal of signals) {
        rawEventCount += 1;
        const signature = buildBenchDiagnosticSignature({
          eventType: signal.eventType,
          stage: signal.stage || '',
          taskId: signal.taskId || '',
          source: signal.source || 'log',
          providerId: signal.providerId || '',
          workspacePartition: signal.workspacePartition || '',
          requestMethod: signal.requestMethod || '',
          failureClass: signal.failureClass || '',
          preflightId: signal.preflightId || '',
          preflightClass: signal.preflightClass || '',
          preflightState: signal.preflightState || '',
          reuseSurface: signal.reuseSurface || '',
          reuseSource: signal.reuseSource || '',
          qualityImpact: signal.qualityImpact || '',
          message: normalizeBenchDiagnosticText(signal.message || '', { maxLength: 220 })
        });
        const eventId = buildBenchDiagnosticEventId({
          eventType: signal.eventType,
          signature
        });
        const scopedKey = buildSyntheticEventKey([
          masterFile ? 'master' : scope,
          eventId
        ]);
        if (masterFile && repoEventKeys.has(eventId)) continue;
        if (uniqueEventKeys.has(scopedKey)) continue;
        uniqueEventKeys.add(scopedKey);
        if (!masterFile) repoEventKeys.add(eventId);
        countsFromLogs.set(signal.eventType, (countsFromLogs.get(signal.eventType) || 0) + 1);
        repoTypePresence.add(buildSyntheticEventKey([scope, signal.eventType]));
      }
    });
  }
  for (const presenceKey of repoTypePresence) {
    const parsed = JSON.parse(String(presenceKey || '[]'));
    const eventType = String(parsed?.[1] || '').trim();
    if (!eventType) continue;
    repoCountsFromLogs.set(eventType, (repoCountsFromLogs.get(eventType) || 0) + 1);
  }

  const streamCounts = diagnosticsStream?.countsByType && typeof diagnosticsStream.countsByType === 'object'
    ? diagnosticsStream.countsByType
    : {};
  const streamRepoCounts = diagnosticsStream?.repoCountsByType && typeof diagnosticsStream.repoCountsByType === 'object'
    ? diagnosticsStream.repoCountsByType
    : {};
  const mismatches = BENCH_DIAGNOSTIC_PARITY_EVENT_TYPES.map((eventType) => {
    const logCount = countsFromLogs.get(eventType) || 0;
    const streamCount = Number(streamCounts[eventType]) || 0;
    return {
      eventType,
      aggregateLogCount: logCount,
      diagnosticsStreamCount: streamCount,
      delta: streamCount - logCount,
      material: materialTypes.has(eventType)
    };
  }).filter((entry) => entry.aggregateLogCount !== entry.diagnosticsStreamCount);
  const repoMismatches = BENCH_DIAGNOSTIC_PARITY_EVENT_TYPES.map((eventType) => {
    const logCount = repoCountsFromLogs.get(eventType) || 0;
    const streamCount = Number(streamRepoCounts[eventType]) || 0;
    return {
      eventType,
      aggregateLogRepoCount: logCount,
      diagnosticsStreamRepoCount: streamCount,
      delta: streamCount - logCount,
      material: materialTypes.has(eventType)
    };
  }).filter((entry) => entry.aggregateLogRepoCount !== entry.diagnosticsStreamRepoCount);

  const materialMismatchCount = mismatches.filter((entry) => entry.material).length;
  const materialRepoMismatchCount = repoMismatches.filter((entry) => entry.material).length;
  const totalMaterialMismatchCount = materialMismatchCount + materialRepoMismatchCount;
  const totalMismatchCount = mismatches.length + repoMismatches.length;

  return {
    schemaVersion: 1,
    trackedTypes: BENCH_DIAGNOSTIC_PARITY_EVENT_TYPES.slice(),
    materialTypes: BENCH_DIAGNOSTIC_MATERIAL_PARITY_EVENT_TYPES.slice(),
    countScopes: {
      countsFromLogs: 'event_presence',
      countsFromDiagnosticsStream: 'event_presence',
      repoCountsFromLogs: 'repo_presence',
      repoCountsFromDiagnosticsStream: 'repo_presence'
    },
    rawAggregateLogEventCount: rawEventCount,
    aggregateLogEventCount: uniqueEventKeys.size,
    countsFromLogs: Object.fromEntries(
      BENCH_DIAGNOSTIC_PARITY_EVENT_TYPES.map((eventType) => [eventType, countsFromLogs.get(eventType) || 0])
    ),
    countsFromDiagnosticsStream: Object.fromEntries(
      BENCH_DIAGNOSTIC_PARITY_EVENT_TYPES.map((eventType) => [eventType, Number(streamCounts[eventType]) || 0])
    ),
    repoCountsFromLogs: Object.fromEntries(
      BENCH_DIAGNOSTIC_PARITY_EVENT_TYPES.map((eventType) => [eventType, repoCountsFromLogs.get(eventType) || 0])
    ),
    repoCountsFromDiagnosticsStream: Object.fromEntries(
      BENCH_DIAGNOSTIC_PARITY_EVENT_TYPES.map((eventType) => [eventType, Number(streamRepoCounts[eventType]) || 0])
    ),
    mismatchCount: totalMismatchCount,
    materialMismatchCount: totalMaterialMismatchCount,
    eventMismatchCount: mismatches.length,
    repoMismatchCount: repoMismatches.length,
    status: totalMaterialMismatchCount > 0 ? 'error' : (totalMismatchCount > 0 ? 'warn' : 'ok'),
    mismatches,
    repoMismatches
  };
};

const resolveTaskReuseSummary = (payload) => {
  const candidates = [
    payload?.artifacts?.scanProfile?.reuse,
    payload?.scanProfile?.reuse,
    payload?.artifacts?.metrics?.reuse,
    payload?.metrics?.reuse
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object') return candidate;
  }
  return null;
};

const buildBenchReuseDiagnosticsSummary = async (tasks, resultsRoot, options = {}) => {
  let taskReuseSummary = null;
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const reuse = resolveTaskReuseSummary(task?.payload || null);
    if (!reuse) continue;
    taskReuseSummary = mergeReuseSummaries(taskReuseSummary, reuse);
  }
  if (taskReuseSummary?.observationCount > 0) return taskReuseSummary;
  const files = await listBenchStreamFiles(resultsRoot, LOG_FILE_SUFFIX, options);
  const observations = [];
  for (const filePath of files) {
    let raw = '';
    try {
      raw = await fsPromises.readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    forEachNonEmptyLine(raw, (line) => {
      const parsed = parseBenchReuseObservation(line);
      if (!parsed) return;
      observations.push(parsed);
    });
  }
  const countsByCause = new Map();
  const countsBySurface = new Map();
  const countsBySurfaceAndSource = new Map();
  const countsByQualityImpact = new Map();
  const scmSnapshotSources = new Map();
  const providerResultSources = new Map();
  let timeCostMs = 0;
  let requestedCount = 0;
  let reusedCount = 0;
  let fetchedCount = 0;
  let chunkCount = 0;

  for (const entry of observations) {
    if (entry.causeClass) bumpMapCount(countsByCause, entry.causeClass);
    if (entry.reuseSurface) bumpMapCount(countsBySurface, entry.reuseSurface);
    if (entry.reuseSurface && entry.reuseSource) {
      bumpMapCount(countsBySurfaceAndSource, `${entry.reuseSurface}:${entry.reuseSource}`);
    }
    if (entry.qualityImpact) bumpMapCount(countsByQualityImpact, entry.qualityImpact);
    if (entry.kind === 'scm_snapshot' && entry.reuseSource) {
      bumpMapCount(scmSnapshotSources, entry.reuseSource);
    }
    if (entry.kind === 'provider_result' && entry.reuseSource) {
      bumpMapCount(providerResultSources, entry.reuseSource);
    }
    timeCostMs += Number(entry.timeCostMs) || 0;
    requestedCount += Number(entry.requestedCount) || 0;
    reusedCount += Number(entry.reusedCount) || 0;
    fetchedCount += Number(entry.fetchedCount) || 0;
    chunkCount += Number(entry.chunkCount) || 0;
  }

  return {
    ...summarizeReuseObservations(observations),
    schemaVersion: 1,
    observations
  };
};

const EXTRACTED_PROSE_QUALITY_BUDGET_SCHEMA_VERSION = 1;

const resolveTaskLowYieldBailout = (payload) => {
  const candidates = [
    payload?.artifacts?.scanProfile?.modes?.['extracted-prose']?.quality?.lowYieldBailout,
    payload?.scanProfile?.modes?.['extracted-prose']?.quality?.lowYieldBailout,
    payload?.artifacts?.extractionReport?.quality?.lowYieldBailout,
    payload?.extractionReport?.quality?.lowYieldBailout,
    payload?.artifacts?.state?.extractedProseLowYieldBailout,
    payload?.state?.extractedProseLowYieldBailout
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object') return candidate;
  }
  return null;
};

const buildBenchQualityBudgetSummary = (tasks) => {
  const validTasks = Array.isArray(tasks) ? tasks : [];
  const countsByRepoYieldClass = new Map();
  const countsByOpportunityClass = new Map();
  const countsByRecallClass = new Map();
  const countsByRecallConfidence = new Map();
  const countsByQualityImpact = new Map();
  let observedTaskCount = 0;
  let reducedRecallCount = 0;
  let skippedFiles = 0;
  let estimatedSuppressedFiles = 0;
  let weightedRecallLossTotal = 0;
  let weightedRecallLossWeight = 0;

  for (const task of validTasks) {
    const lowYield = resolveTaskLowYieldBailout(task?.payload || null);
    if (!lowYield || typeof lowYield !== 'object') continue;
    observedTaskCount += 1;
    if (lowYield.repoYieldClass) bumpMapCount(countsByRepoYieldClass, lowYield.repoYieldClass);
    if (lowYield.opportunityCost?.class) bumpMapCount(countsByOpportunityClass, lowYield.opportunityCost.class);
    if (lowYield.recallCost?.class) bumpMapCount(countsByRecallClass, lowYield.recallCost.class);
    if (lowYield.recallCost?.estimatedRecallLossConfidence) {
      bumpMapCount(countsByRecallConfidence, lowYield.recallCost.estimatedRecallLossConfidence);
    }
    if (lowYield.recallCost?.qualityImpact) {
      bumpMapCount(countsByQualityImpact, lowYield.recallCost.qualityImpact);
    }
    if (lowYield.triggered === true) reducedRecallCount += 1;
    skippedFiles += Number(lowYield.opportunityCost?.skippedFiles ?? lowYield.skippedFiles) || 0;
    estimatedSuppressedFiles += Number(
      lowYield.opportunityCost?.estimatedSuppressedFiles ?? lowYield.estimatedSuppressedFiles
    ) || 0;
    const repoEntries = Number(lowYield?.repoFingerprint?.totalEntries);
    const recallLossRatio = Number(
      lowYield.recallCost?.estimatedRecallLossRatio ?? lowYield.estimatedRecallLossRatio
    );
    if (Number.isFinite(repoEntries) && repoEntries > 0 && Number.isFinite(recallLossRatio) && recallLossRatio > 0) {
      weightedRecallLossTotal += recallLossRatio * repoEntries;
      weightedRecallLossWeight += repoEntries;
    }
  }

  return {
    schemaVersion: EXTRACTED_PROSE_QUALITY_BUDGET_SCHEMA_VERSION,
    taskCount: validTasks.length,
    observedTaskCount,
    reducedRecallCount,
    skippedFiles,
    estimatedSuppressedFiles,
    weightedRecallLossRatio: weightedRecallLossWeight > 0 ? weightedRecallLossTotal / weightedRecallLossWeight : 0,
    countsByRepoYieldClass: sortMapObject(countsByRepoYieldClass),
    countsByOpportunityClass: sortMapObject(countsByOpportunityClass),
    countsByRecallClass: sortMapObject(countsByRecallClass),
    countsByRecallConfidence: sortMapObject(countsByRecallConfidence),
    countsByQualityImpact: sortMapObject(countsByQualityImpact)
  };
};

const parseProgressConfidenceLine = (line) => {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const scoreRaw = Number(parsed.score);
  const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(1, scoreRaw)) : null;
  const bucket = typeof parsed.bucket === 'string' && parsed.bucket.trim()
    ? parsed.bucket.trim().toLowerCase()
    : 'unknown';
  const label = typeof parsed.label === 'string' && parsed.label.trim()
    ? parsed.label.trim()
    : 'run';
  return {
    score,
    bucket,
    label,
    reason: typeof parsed.reason === 'string' ? parsed.reason.trim() : null,
    ts: typeof parsed.ts === 'string' ? parsed.ts : null
  };
};

const parsePreflightLogLine = (line) => {
  const trimmed = String(line || '').trim();
  if (!trimmed || !trimmed.includes('preflight:')) return null;
  const providerMatch = /\[tooling\]\s+preflight:(?<event>[a-z_]+)\s+provider=(?<provider>[^\s]+)\s+id=(?<id>[^\s]+)(?<rest>.*)$/iu.exec(trimmed);
  const aggregateMatch = providerMatch
    ? null
    : /\[tooling\]\s+preflight:(?<event>[a-z_]+)(?<rest>.*)$/iu.exec(trimmed);
  const match = providerMatch || aggregateMatch;
  if (!match) return null;
  const event = String(match.groups?.event || '').trim().toLowerCase();
  if (!event || !PREFLIGHT_EVENT_TYPE_SET.has(event)) return null;
  const providerId = String(match.groups?.provider || '').trim() || null;
  const preflightId = String(match.groups?.id || '').trim() || null;
  const rest = String(match.groups?.rest || '');
  const values = Object.create(null);
  for (const entry of rest.split(/\s+/u)) {
    const idx = entry.indexOf('=');
    if (idx <= 0 || idx >= entry.length - 1) continue;
    const key = entry.slice(0, idx).trim().toLowerCase();
    const value = entry.slice(idx + 1).trim();
    if (!key || !value) continue;
    values[key] = value;
  }
  const durationRaw = Number(values.durationms);
  const durationMs = Number.isFinite(durationRaw) ? Math.max(0, durationRaw) : null;
  const preflightClass = String(values.class || '').trim().toLowerCase() || 'unknown';
  const state = String(values.state || PREFLIGHT_EVENT_STATE_BY_EVENT[event] || '').trim().toLowerCase() || null;
  const timedOut = values.timeout === '1' || event === 'timeout' || event === 'teardown_timeout';
  return {
    event,
    providerId,
    preflightId,
    preflightClass,
    state,
    durationMs,
    timedOut
  };
};

const parseCommaCountMap = (value) => {
  const out = Object.create(null);
  const raw = String(value || '').trim();
  if (!raw) return out;
  for (const entry of raw.split(',')) {
    const trimmed = String(entry || '').trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0 || idx >= trimmed.length - 1) continue;
    const name = trimmed.slice(0, idx).trim().toLowerCase();
    const countRaw = Number(trimmed.slice(idx + 1).trim());
    if (!name || !Number.isFinite(countRaw)) continue;
    out[name] = (out[name] || 0) + Math.max(0, Math.floor(countRaw));
  }
  return out;
};

const parsePreflightSummaryLine = (line) => {
  const trimmed = String(line || '').trim();
  if (!trimmed || !trimmed.includes('[tooling] preflight summary')) return null;
  const match = /\[tooling\]\s+preflight summary\s+(?<rest>.+)$/iu.exec(trimmed);
  if (!match) return null;
  const rest = String(match.groups?.rest || '');
  const values = Object.create(null);
  for (const entry of rest.split(/\s+/u)) {
    const idx = entry.indexOf('=');
    if (idx <= 0 || idx >= entry.length - 1) continue;
    const key = entry.slice(0, idx).trim().toLowerCase();
    const value = entry.slice(idx + 1).trim();
    if (!key || !value) continue;
    values[key] = value;
  }
  return {
    total: Number.isFinite(Number(values.total)) ? Math.max(0, Number(values.total)) : null,
    cached: Number.isFinite(Number(values.cached)) ? Math.max(0, Number(values.cached)) : null,
    timedOut: Number.isFinite(Number(values.timedout)) ? Math.max(0, Number(values.timedout)) : null,
    failed: Number.isFinite(Number(values.failed)) ? Math.max(0, Number(values.failed)) : null,
    queuePeak: Number.isFinite(Number(values.queuepeak)) ? Math.max(0, Number(values.queuepeak)) : null,
    teardownTimedOut: Number(values.teardowntimedout) === 1,
    countsByState: parseCommaCountMap(values.states),
    countsByClass: parseCommaCountMap(values.classes),
    countsByPolicy: parseCommaCountMap(values.policies)
  };
};

const parsePreflightSlowestLine = (line) => {
  const trimmed = String(line || '').trim();
  if (!trimmed || !trimmed.includes('[tooling] preflight slowest')) return [];
  const match = /\[tooling\]\s+preflight slowest\s+(?<rest>.+)$/iu.exec(trimmed);
  if (!match) return [];
  const rest = String(match.groups?.rest || '').trim();
  if (!rest) return [];
  const out = [];
  for (const chunk of rest.split(',')) {
    const entry = String(chunk || '').trim();
    if (!entry) continue;
    const parsed = /^(?<provider>[^/]+)\/(?<id>[^:]+):(?<duration>\d+)ms$/u.exec(entry);
    if (!parsed) continue;
    const providerId = String(parsed.groups?.provider || '').trim();
    const preflightId = String(parsed.groups?.id || '').trim();
    const durationMsRaw = Number(parsed.groups?.duration);
    if (!providerId || !preflightId || !Number.isFinite(durationMsRaw)) continue;
    out.push({
      providerId,
      preflightId,
      preflightClass: 'unknown',
      state: null,
      event: 'summary_slowest',
      durationMs: Math.max(0, durationMsRaw)
    });
  }
  return out;
};

const pushTopSlowPreflights = (rows, entry) => {
  pushTopNOrdered(
    rows,
    entry,
    PREFLIGHT_TOP_SLOW_LIMIT,
    (left, right) => (
      Number(right.durationMs) - Number(left.durationMs)
    ) || String(left.providerId || '').localeCompare(String(right.providerId || ''))
  );
};

const buildPreflightLogSummary = async (resultsRoot, options = {}) => {
  const files = await listBenchStreamFiles(resultsRoot, LOG_FILE_SUFFIX, options);
  const orderedFiles = files
    .slice()
    .sort((left, right) => Number(isMasterBenchStreamFile(left)) - Number(isMasterBenchStreamFile(right))
      || left.localeCompare(right));
  const countsByEvent = new Map();
  const countsByState = new Map();
  const countsByClass = new Map();
  const countsByProvider = new Map();
  const topSlow = [];
  const summaryCountsByClass = new Map();
  const summaryCountsByState = new Map();
  const summaryCountsByPolicy = new Map();
  const summaryTopSlow = [];
  let summaryLineCount = 0;
  let summaryMaxQueuePeak = 0;
  let summaryTeardownTimedOutCount = 0;
  let rawEventCount = 0;
  let timeoutEvents = 0;
  const uniqueEventKeys = new Set();
  const repoEventKeys = new Set();
  const repoSummaryKeys = new Set();
  const repoSummarySlowKeys = new Set();
  const uniqueSummaryKeys = new Set();
  const uniqueSummarySlowKeys = new Set();
  for (const filePath of orderedFiles) {
    let raw = '';
    try {
      raw = await fsPromises.readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    forEachNonEmptyLine(raw, (line) => {
      const masterFile = isMasterBenchStreamFile(filePath);
      const scope = resolveBenchStreamScope(filePath);
      const summary = parsePreflightSummaryLine(line);
      if (summary) {
        const rawSummaryKey = buildPreflightSummaryKey(null, summary);
        if (masterFile && rawSummaryKey && repoSummaryKeys.has(rawSummaryKey)) {
          return;
        }
        const summaryKey = buildPreflightSummaryKey(scope, summary);
        if (!summaryKey || !uniqueSummaryKeys.has(summaryKey)) {
          if (summaryKey) uniqueSummaryKeys.add(summaryKey);
          if (!masterFile && rawSummaryKey) repoSummaryKeys.add(rawSummaryKey);
          summaryLineCount += 1;
          if (Number.isFinite(summary.queuePeak)) {
            summaryMaxQueuePeak = Math.max(summaryMaxQueuePeak, summary.queuePeak);
          }
          if (summary.teardownTimedOut === true) summaryTeardownTimedOutCount += 1;
          for (const [name, count] of Object.entries(summary.countsByClass || {})) {
            summaryCountsByClass.set(name, (summaryCountsByClass.get(name) || 0) + count);
          }
          for (const [name, count] of Object.entries(summary.countsByState || {})) {
            summaryCountsByState.set(name, (summaryCountsByState.get(name) || 0) + count);
          }
          for (const [name, count] of Object.entries(summary.countsByPolicy || {})) {
            summaryCountsByPolicy.set(name, (summaryCountsByPolicy.get(name) || 0) + count);
          }
        }
      }
      const summarySlowEntries = parsePreflightSlowestLine(line);
      for (const entry of summarySlowEntries) {
        const rawSummarySlowKey = buildPreflightSlowestKey(null, entry);
        if (masterFile && rawSummarySlowKey && repoSummarySlowKeys.has(rawSummarySlowKey)) continue;
        const summarySlowKey = buildPreflightSlowestKey(scope, entry);
        if (summarySlowKey && uniqueSummarySlowKeys.has(summarySlowKey)) continue;
        if (summarySlowKey) uniqueSummarySlowKeys.add(summarySlowKey);
        if (!masterFile && rawSummarySlowKey) repoSummarySlowKeys.add(rawSummarySlowKey);
        pushTopSlowPreflights(summaryTopSlow, entry);
      }
      const event = parsePreflightLogLine(line);
      if (!event) return;
      rawEventCount += 1;
      const rawKey = buildPreflightEventKey(event);
      const scopedKey = buildSyntheticEventKey([
        masterFile ? 'master' : scope,
        rawKey
      ]);
      if (masterFile && rawKey && repoEventKeys.has(rawKey)) return;
      if (scopedKey && uniqueEventKeys.has(scopedKey)) return;
      if (scopedKey) uniqueEventKeys.add(scopedKey);
      if (!masterFile && rawKey) repoEventKeys.add(rawKey);
      countsByEvent.set(event.event, (countsByEvent.get(event.event) || 0) + 1);
      countsByClass.set(event.preflightClass, (countsByClass.get(event.preflightClass) || 0) + 1);
      if (event.state) {
        countsByState.set(event.state, (countsByState.get(event.state) || 0) + 1);
      }
      if (event.timedOut) timeoutEvents += 1;
      if (event.providerId) {
        countsByProvider.set(event.providerId, (countsByProvider.get(event.providerId) || 0) + 1);
      }
      if (Number.isFinite(event.durationMs)) {
        pushTopSlowPreflights(topSlow, {
          providerId: event.providerId,
          preflightId: event.preflightId,
          preflightClass: event.preflightClass,
          state: event.state || null,
          event: event.event,
          durationMs: event.durationMs
        });
      }
    });
  }

  const topProviders = Array.from(countsByProvider.entries())
    .map(([providerId, count]) => ({ providerId, count }))
    .sort((left, right) => (
      Number(right.count) - Number(left.count)
    ) || String(left.providerId).localeCompare(String(right.providerId)))
    .slice(0, 20);

  return {
    schemaVersion: PREFLIGHT_LOG_SCHEMA_VERSION,
    fileCount: files.length,
    eventCount: uniqueEventKeys.size,
    rawEventCount,
    duplicateEventCount: Math.max(0, rawEventCount - uniqueEventKeys.size),
    timeoutEvents,
    countsByEvent: Object.fromEntries(
      Array.from(countsByEvent.entries()).sort(([left], [right]) => left.localeCompare(right))
    ),
    countsByState: Object.fromEntries(
      Array.from(countsByState.entries()).sort(([left], [right]) => left.localeCompare(right))
    ),
    countsByClass: Object.fromEntries(
      Array.from(countsByClass.entries()).sort(([left], [right]) => left.localeCompare(right))
    ),
    topProviders,
    topSlow,
    summary: {
      lineCount: summaryLineCount,
      maxQueuePeak: summaryMaxQueuePeak,
      teardownTimedOutCount: summaryTeardownTimedOutCount,
      countsByClass: Object.fromEntries(
        Array.from(summaryCountsByClass.entries()).sort(([left], [right]) => left.localeCompare(right))
      ),
      countsByState: Object.fromEntries(
        Array.from(summaryCountsByState.entries()).sort(([left], [right]) => left.localeCompare(right))
      ),
      countsByPolicy: Object.fromEntries(
        Array.from(summaryCountsByPolicy.entries()).sort(([left], [right]) => left.localeCompare(right))
      ),
      topSlow: summaryTopSlow
    }
  };
};

const buildProgressConfidenceSummary = async (resultsRoot, options = {}) => {
  const files = await listBenchStreamFiles(resultsRoot, PROGRESS_CONFIDENCE_STREAM_FILE_SUFFIX, options);
  const orderedFiles = files
    .slice()
    .sort((left, right) => Number(isMasterBenchStreamFile(left)) - Number(isMasterBenchStreamFile(right))
      || left.localeCompare(right));
  const bucketCounts = new Map();
  const perFile = [];
  const lowConfidenceEventsTop = [];
  const latestByLabel = new Map();
  let rawEventCount = 0;
  let malformedLines = 0;
  let totalScore = 0;
  let totalScoreCount = 0;
  let minScoreGlobal = Number.POSITIVE_INFINITY;
  let maxScoreGlobal = Number.NEGATIVE_INFINITY;
  const uniqueEventKeys = new Set();

  for (const filePath of orderedFiles) {
    let raw = '';
    try {
      raw = await fsPromises.readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    const fileBucketCounts = new Map();
    let fileScoreSum = 0;
    let fileScoreCount = 0;
    let fileMinScore = Number.POSITIVE_INFINITY;
    let fileEventCount = 0;
    forEachNonEmptyLine(raw, (line) => {
      const parsed = parseProgressConfidenceLine(line);
      if (!parsed) {
        malformedLines += 1;
        return;
      }
      rawEventCount += 1;
      fileEventCount += 1;
      const eventKey = buildProgressConfidenceEventKey(resolveBenchStreamScope(filePath), parsed);
      if (eventKey && uniqueEventKeys.has(eventKey)) return;
      if (eventKey) uniqueEventKeys.add(eventKey);
      const bucket = parsed.bucket || 'unknown';
      bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1);
      fileBucketCounts.set(bucket, (fileBucketCounts.get(bucket) || 0) + 1);
      if (Number.isFinite(parsed.score)) {
        fileScoreSum += parsed.score;
        fileScoreCount += 1;
        totalScore += parsed.score;
        totalScoreCount += 1;
        if (parsed.score < fileMinScore) fileMinScore = parsed.score;
        if (parsed.score < minScoreGlobal) minScoreGlobal = parsed.score;
        if (parsed.score > maxScoreGlobal) maxScoreGlobal = parsed.score;
        pushTopNOrdered(lowConfidenceEventsTop, {
          path: filePath,
          label: parsed.label,
          score: parsed.score,
          bucket: parsed.bucket,
          reason: parsed.reason || null,
          ts: parsed.ts || null
        }, 20, (left, right) => (
          Number(left.score) - Number(right.score)
        ) || String(left.label || '').localeCompare(String(right.label || '')));
      }
      if (parsed.label) {
        const prior = latestByLabel.get(parsed.label);
        const parsedTime = Date.parse(parsed.ts || '');
        const priorTime = Date.parse(prior?.ts || '');
        if (!prior || (Number.isFinite(parsedTime) && (!Number.isFinite(priorTime) || parsedTime >= priorTime))) {
          latestByLabel.set(parsed.label, {
            label: parsed.label,
            score: parsed.score,
            bucket: parsed.bucket,
            reason: parsed.reason || null,
            ts: parsed.ts || null
          });
        }
      }
    });
    perFile.push({
      path: filePath,
      eventCount: fileEventCount,
      avgScore: fileScoreCount
        ? fileScoreSum / fileScoreCount
        : null,
      minScore: Number.isFinite(fileMinScore) ? fileMinScore : null,
      countsByBucket: Object.fromEntries(
        Array.from(fileBucketCounts.entries()).sort(([left], [right]) => left.localeCompare(right))
      )
    });
  }

  const avgScore = totalScoreCount
    ? totalScore / totalScoreCount
    : null;

  return {
    schemaVersion: BENCH_PROGRESS_CONFIDENCE_SCHEMA_VERSION,
    fileCount: files.length,
    files: perFile,
    eventCount: uniqueEventKeys.size,
    rawEventCount,
    duplicateEventCount: Math.max(0, rawEventCount - uniqueEventKeys.size),
    avgScore,
    minScore: Number.isFinite(minScoreGlobal) ? minScoreGlobal : null,
    maxScore: Number.isFinite(maxScoreGlobal) ? maxScoreGlobal : null,
    countsByBucket: Object.fromEntries(
      Array.from(bucketCounts.entries()).sort(([left], [right]) => left.localeCompare(right))
    ),
    lowConfidenceEvents: lowConfidenceEventsTop,
    latestByLabel: Array.from(latestByLabel.values())
      .sort((left, right) => String(left.label).localeCompare(String(right.label))),
    malformedLines
  };
};

const REMEDIATION_SCHEMA_VERSION = 1;
const LOW_HIT_THRESHOLD = 0.82;

const roundValue = (value, digits = 4) => {
  if (!Number.isFinite(Number(value))) return null;
  const scale = 10 ** Math.max(0, Math.floor(Number(digits) || 0));
  return Math.round(Number(value) * scale) / scale;
};

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const buildSuggestion = ({
  suggestionId,
  component,
  title,
  score,
  reason,
  targetFiles,
  severity
}) => ({
  suggestionId,
  component,
  title,
  score: roundValue(clamp01(score), 3),
  reason,
  targetFiles: Array.isArray(targetFiles) ? targetFiles : [],
  loop: {
    accepted: false,
    baseline: {
      bestHitRate: roundValue(severity.bestHitRate, 4),
      queryWallMsPerSearch: roundValue(severity.queryWallMsPerSearch, 2),
      avgResultCount: roundValue(severity.avgResultCount, 3)
    },
    postChange: null,
    delta: null
  }
});

const buildRankedRemediationSuggestions = ({ severity }) => {
  const suggestions = [];
  if (!Number.isFinite(severity?.bestHitRate) || !Number.isFinite(severity?.hitGap)) return suggestions;

  suggestions.push(buildSuggestion({
    suggestionId: 'query.intent-weight-rebalance',
    component: 'ranker',
    title: 'Rebalance intent weights by language family',
    score: 0.45 + (severity.hitGap * 1.35) + (severity.scarcityPressure * 0.25),
    reason: (
      `best hit ${(severity.bestHitRate * 100).toFixed(1)}% is below ` +
      `${(severity.lowHitThreshold * 100).toFixed(1)}%; calibrate symbol/type/api/behavior weights.`
    ),
    targetFiles: [
      'tools/bench/query-generator.js',
      'benchmarks/repos.json'
    ],
    severity
  }));

  if (severity.scarcityPressure > 0.05 || severity.bestHitRate < (severity.lowHitThreshold * 0.9)) {
    suggestions.push(buildSuggestion({
      suggestionId: 'tokenizer.language-family-pack',
      component: 'tokenizer',
      title: 'Expand language-family tokenizer coverage',
      score: 0.30 + (severity.hitGap * 1.15) + (severity.scarcityPressure * 0.35),
      reason: (
        `avg hits/search ${roundValue(severity.avgResultCount, 2) ?? 'n/a'} indicates sparse recall; ` +
        'prioritize dictionary/token normalization updates for this family.'
      ),
      targetFiles: [
        'src/retrieval/query-intent.js',
        'tools/bench/query-generator.js'
      ],
      severity
    }));
  }

  if (severity.latencyPressure > 0) {
    suggestions.push(buildSuggestion({
      suggestionId: 'ranker.rerank-budget',
      component: 'ranker',
      title: 'Tune rerank budget for low-hit queries',
      score: 0.20 + (severity.hitGap * 0.85) + (severity.latencyPressure * 0.65),
      reason: (
        `query/search latency ${roundValue(severity.queryWallMsPerSearch, 1) ?? 'n/a'}ms with low hit rate; ` +
        'tighten rerank depth and rebalance first-pass confidence thresholds.'
      ),
      targetFiles: [
        'src/retrieval/pipeline/rank-stage.js',
        'src/retrieval/scoring/ann-candidate-policy.js'
      ],
      severity
    }));
  }

  if ((severity.avgResultCount || 0) < 1.2 || severity.bestHitRate < 0.6) {
    suggestions.push(buildSuggestion({
      suggestionId: 'indexing.chunking-balance',
      component: 'indexing',
      title: 'Tune chunking/normalization for recall',
      score: 0.15 + (severity.hitGap * 0.75) + (severity.scarcityPressure * 0.4),
      reason: (
        'low result density suggests chunk boundary or normalization drift; tune language-role chunk sizing and indexing presets.'
      ),
      targetFiles: [
        'src/index/chunking/dispatch.js',
        'src/index/chunking/limits.js'
      ],
      severity
    }));
  }

  return suggestions
    .sort((left, right) => Number(right.score) - Number(left.score))
    .map((entry, index) => ({
      ...entry,
      rank: index + 1
    }));
};

const resolveTopMissTaxonomyLabels = (summary, maxLabels = 6) => {
  const source = summary?.missTaxonomy && typeof summary.missTaxonomy === 'object'
    ? summary.missTaxonomy
    : null;
  if (!source) return [];
  const counts = new Map();
  const appendCounts = (bucket) => {
    if (!bucket || typeof bucket !== 'object') return;
    for (const labels of Object.values(bucket)) {
      if (!labels || typeof labels !== 'object') continue;
      for (const [rawLabel, rawCount] of Object.entries(labels)) {
        const label = typeof rawLabel === 'string' ? rawLabel.trim() : '';
        if (!label) continue;
        const count = Number(rawCount);
        if (!Number.isFinite(count) || count <= 0) continue;
        counts.set(label, (counts.get(label) || 0) + count);
      }
    }
  };
  appendCounts(source.lowHitByBackend);
  appendCounts(source.byBackend);
  const limit = Math.max(1, Math.floor(Number(maxLabels) || 6));
  const top = [];
  for (const entry of counts.entries()) {
    pushTopNOrdered(
      top,
      entry,
      limit,
      (left, right) => (right[1] - left[1]) || left[0].localeCompare(right[0])
    );
  }
  return top.map(([label, count]) => ({ label, count }));
};

const buildRemediationSummary = (tasks) => {
  const remediationRows = [];
  const aggregateSuggestions = new Map();
  const validTasks = (Array.isArray(tasks) ? tasks : []).filter((entry) => entry?.summary);
  for (const entry of validTasks) {
    const severity = computeLowHitSeverity({
      summary: entry.summary,
      lowHitThreshold: LOW_HIT_THRESHOLD
    });
    if (!Number.isFinite(severity?.bestHitRate) || severity.bestHitRate >= LOW_HIT_THRESHOLD) continue;
    const rankedSuggestions = buildRankedRemediationSuggestions({ severity });
    for (const suggestion of rankedSuggestions) {
      if (!aggregateSuggestions.has(suggestion.suggestionId)) {
        aggregateSuggestions.set(suggestion.suggestionId, {
          suggestionId: suggestion.suggestionId,
          title: suggestion.title,
          component: suggestion.component,
          uses: 0,
          scoreTotal: 0,
          repos: new Set()
        });
      }
      const bucket = aggregateSuggestions.get(suggestion.suggestionId);
      bucket.uses += 1;
      bucket.scoreTotal += Number(suggestion.score) || 0;
      bucket.repos.add(`${entry.language}/${entry.repo}`);
    }
    remediationRows.push({
      language: entry.language,
      tier: entry.tier,
      repo: entry.repo,
      repoPath: entry.repoPath || null,
      outFile: entry.outFile || null,
      bestHitRate: roundValue(severity.bestHitRate, 4),
      lowHitThreshold: LOW_HIT_THRESHOLD,
      hitGap: roundValue(severity.hitGap, 4),
      avgResultCount: roundValue(severity.avgResultCount, 3),
      queryWallMsPerSearch: roundValue(severity.queryWallMsPerSearch, 2),
      queryWallMsPerQuery: roundValue(severity.queryWallMsPerQuery, 2),
      severityScore: roundValue(severity.severityScore, 3),
      missTaxonomyTop: resolveTopMissTaxonomyLabels(entry.summary),
      rankedSuggestions
    });
  }
  remediationRows.sort((left, right) => (
    Number(right.severityScore || 0) - Number(left.severityScore || 0)
  ));
  const topSuggestions = Array.from(aggregateSuggestions.values())
    .map((entry) => ({
      suggestionId: entry.suggestionId,
      title: entry.title,
      component: entry.component,
      uses: entry.uses,
      avgScore: roundValue(entry.uses > 0 ? (entry.scoreTotal / entry.uses) : 0, 3),
      repos: Array.from(entry.repos).sort((left, right) => left.localeCompare(right))
    }))
    .sort((left, right) => (Number(right.avgScore || 0) - Number(left.avgScore || 0))
      || (Number(right.uses || 0) - Number(left.uses || 0))
      || left.suggestionId.localeCompare(right.suggestionId));
  const totalSuggestions = remediationRows.reduce((sum, entry) => (
    sum + (Array.isArray(entry.rankedSuggestions) ? entry.rankedSuggestions.length : 0)
  ), 0);
  return {
    schemaVersion: REMEDIATION_SCHEMA_VERSION,
    lowHitThreshold: LOW_HIT_THRESHOLD,
    reposConsidered: validTasks.length,
    lowHitCount: remediationRows.length,
    lowHitRepos: remediationRows,
    topSuggestions,
    loop: {
      trackedSuggestions: totalSuggestions,
      acceptedSuggestions: 0,
      pendingSuggestions: totalSuggestions,
      postChangeDeltaReady: false
    }
  };
};

export const summarizeResults = (items, { metricTags = null, methodology = null } = {}) => {
  const valid = items.filter((entry) => entry.summary);
  if (!valid.length) return null;
  const backendSet = new Set();
  for (const entry of valid) {
    const summary = entry.summary;
    const backends = summary.backends || Object.keys(summary.latencyMsAvg || {});
    for (const backend of backends) backendSet.add(backend);
  }
  const backends = Array.from(backendSet);
  const latencyMsAvg = {};
  const hitRate = {};
  const resultCountAvg = {};
  const memoryRssAvgMb = {};
  const buildMsAvg = {};
  for (const backend of backends) {
    const latencies = valid.map((entry) => entry.summary?.latencyMsAvg?.[backend]).filter(Number.isFinite);
    const hits = valid.map((entry) => entry.summary?.hitRate?.[backend]).filter(Number.isFinite);
    const results = valid.map((entry) => entry.summary?.resultCountAvg?.[backend]).filter(Number.isFinite);
    const mem = valid
      .map((entry) => entry.summary?.memoryRss?.[backend]?.mean)
      .filter(Number.isFinite)
      .map((value) => value / (1024 * 1024));
    if (latencies.length) latencyMsAvg[backend] = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    if (hits.length) hitRate[backend] = hits.reduce((a, b) => a + b, 0) / hits.length;
    if (results.length) resultCountAvg[backend] = results.reduce((a, b) => a + b, 0) / results.length;
    if (mem.length) memoryRssAvgMb[backend] = mem.reduce((a, b) => a + b, 0) / mem.length;
  }
  for (const entry of valid) {
    const build = entry.summary?.buildMs;
    if (!build) continue;
    for (const [key, value] of Object.entries(build)) {
      if (!Number.isFinite(value)) continue;
      if (!buildMsAvg[key]) buildMsAvg[key] = [];
      buildMsAvg[key].push(value);
    }
  }
  const buildMs = Object.fromEntries(
    Object.entries(buildMsAvg).map(([key, values]) => [
      key,
      values.reduce((a, b) => a + b, 0) / values.length
    ])
  );
  const stageTimingMerged = createEmptyStageTimingProfile();
  let stageTimingSamples = 0;
  for (const entry of valid) {
    if (!entry?.stageTimingProfile) continue;
    mergeStageTimingProfile(stageTimingMerged, entry.stageTimingProfile);
    stageTimingSamples += 1;
  }
  const stageTiming = stageTimingSamples > 0
    ? finalizeStageTimingProfile(stageTimingMerged)
    : null;
  return {
    backends,
    latencyMsAvg,
    hitRate,
    reuse: buildBenchReuseSummary({
      tasks: valid,
      methodology
    }),
    resultCountAvg,
    memoryRssAvgMb,
    buildMs: Object.keys(buildMs).length ? buildMs : null,
    stageTiming,
    metricTags
  };
};

export const printSummary = (
  label,
  summary,
  count,
  quietMode,
  { writeLine = (line) => log(line) } = {}
) => {
  if (!summary || quietMode) return;
  writeLine(`\n${label} summary (${count} repos)`);
  for (const backend of summary.backends) {
    const latency = summary.latencyMsAvg?.[backend];
    const hit = summary.hitRate?.[backend];
    const results = summary.resultCountAvg?.[backend];
    const mem = summary.memoryRssAvgMb?.[backend];
    const latencyText = Number.isFinite(latency) ? `${latency.toFixed(1)}ms` : 'n/a';
    const hitText = Number.isFinite(hit) ? `${(hit * 100).toFixed(1)}%` : 'n/a';
    const resultText = Number.isFinite(results) ? results.toFixed(1) : 'n/a';
    const memText = Number.isFinite(mem) ? `${mem.toFixed(1)} MB` : 'n/a';
    writeLine(`- ${backend} avg ${latencyText} | hit ${hitText} | avg hits ${resultText} | rss ${memText}`);
  }
  if (summary.buildMs) {
    for (const [key, value] of Object.entries(summary.buildMs)) {
      if (!Number.isFinite(value)) continue;
      writeLine(`- build ${key} avg ${(value / 1000).toFixed(1)}s`);
    }
  }
  const reuse = summary.reuse || null;
  if (Number.isFinite(reuse?.coldStart?.averageHitRate)) {
    writeLine(`- reuse cold-start avg ${(reuse.coldStart.averageHitRate * 100).toFixed(1)}%`);
  }
  if (Number.isFinite(reuse?.intraRun?.averageHitRate)) {
    writeLine(`- reuse intra-run avg ${(reuse.intraRun.averageHitRate * 100).toFixed(1)}%`);
  }
  if (Number.isFinite(reuse?.crossRun?.averageHitRate)) {
    writeLine(`- reuse cross-run avg ${(reuse.crossRun.averageHitRate * 100).toFixed(1)}%`);
  }
};

export const buildBenchRunDiagnosticsSummaryLines = (output) => {
  const lines = [];
  const countsByType = output?.diagnostics?.stream?.repoCountsByType && typeof output.diagnostics.stream.repoCountsByType === 'object'
    ? output.diagnostics.stream.repoCountsByType
    : (
      output?.diagnostics?.stream?.countsByType && typeof output.diagnostics.stream.countsByType === 'object'
        ? output.diagnostics.stream.countsByType
        : {}
    );
  const countsBySeverity = output?.diagnostics?.stream?.countsBySeverity && typeof output.diagnostics.stream.countsBySeverity === 'object'
    ? output.diagnostics.stream.countsBySeverity
    : {};
  const highlights = [
    ['provider_request_timeout', 'timeouts'],
    ['provider_request_failed', 'request-failures'],
    ['provider_circuit_breaker', 'circuit-breakers'],
    ['provider_degraded_mode_entered', 'degraded'],
    ['provider_preflight_blocked', 'blocked'],
    ['artifact_tail_stall', 'artifact-stalls'],
    ['queue_delay_hotspot', 'queue-hotspots'],
    ['warning_suppressed', 'warning-suppressed'],
    ['fallback_used', 'fallbacks']
  ]
    .map(([eventType, label]) => {
      const count = Number(countsByType[eventType] || 0);
      return count > 0 ? `${label}=${count}` : null;
    })
    .filter(Boolean);
  if (highlights.length) {
    lines.push(`[diagnostics] run highlights: ${highlights.join(' | ')}`);
  }
  const artifactFamilyCounts = new Map();
  for (const task of Array.isArray(output?.tasks) ? output.tasks : []) {
    const topSignals = Array.isArray(task?.diagnostics?.topSignals) ? task.diagnostics.topSignals : [];
    for (const signal of topSignals) {
      if (signal?.eventType !== 'artifact_tail_stall') continue;
      const failureClass = String(signal?.failureClass || '').trim().toLowerCase();
      if (!failureClass.startsWith('family:')) continue;
      const family = failureClass.slice('family:'.length).trim();
      if (!family) continue;
      const count = Number.isFinite(Number(signal?.count)) ? Number(signal.count) : 0;
      artifactFamilyCounts.set(family, (artifactFamilyCounts.get(family) || 0) + Math.max(1, count));
    }
  }
  const artifactFamilyHighlights = Array.from(artifactFamilyCounts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([family, count]) => `${family}=${count}`);
  if (artifactFamilyHighlights.length) {
    lines.push(`[diagnostics] artifact families: ${artifactFamilyHighlights.join(' | ')}`);
  }
  const providerFidelityIssueCounts = new Map();
  for (const task of Array.isArray(output?.tasks) ? output.tasks : []) {
    const fidelity = task?.diagnostics?.fidelity && typeof task.diagnostics.fidelity === 'object'
      ? task.diagnostics.fidelity
      : null;
    const providerId = String(fidelity?.providerId || '').trim();
    if (!providerId) continue;
    for (const issueClass of Array.isArray(fidelity?.runtimeIssues) ? fidelity.runtimeIssues : []) {
      const normalized = String(issueClass || '').trim();
      if (!normalized) continue;
      bumpMapCount(providerFidelityIssueCounts, `${providerId}.${normalized}`);
    }
  }
  const providerFidelityHighlights = Array.from(providerFidelityIssueCounts.entries())
    .sort((left, right) => Number(right[1]) - Number(left[1])
      || String(left[0]).localeCompare(String(right[0])))
    .slice(0, 8)
    .map(([key, count]) => `${key.replaceAll('_', '-')}=${count}`);
  if (providerFidelityHighlights.length) {
    lines.push(`[diagnostics] provider fidelity: ${providerFidelityHighlights.join(' | ')}`);
  }
  const fallbackCauseCounts = output?.diagnostics?.stream?.countsByFailureClass && typeof output.diagnostics.stream.countsByFailureClass === 'object'
    ? output.diagnostics.stream.countsByFailureClass
    : {};
  const fallbackCauseHighlights = [
    ['provider_unhealthy', 'provider-unhealthy'],
    ['provider_unavailable', 'provider-unavailable'],
    ['cache_invalid', 'cache-invalid']
  ].map(([key, label]) => {
    const count = Number(fallbackCauseCounts[key] || 0);
    return count > 0 ? `${label}=${count}` : null;
  }).filter(Boolean);
  if (fallbackCauseHighlights.length) {
    lines.push(`[diagnostics] fallback causes: ${fallbackCauseHighlights.join(' | ')}`);
  }
  const reuse = output?.diagnostics?.reuse && typeof output.diagnostics.reuse === 'object'
    ? output.diagnostics.reuse
    : null;
  const surfaceSource = reuse?.countsBySurfaceAndSource && typeof reuse.countsBySurfaceAndSource === 'object'
    ? reuse.countsBySurfaceAndSource
    : {};
  const reuseHighlights = [
    ['scm-derived:cache', 'scm-cache'],
    ['scm-derived:mixed', 'scm-mixed'],
    ['scm-derived:fresh', 'scm-fresh'],
    ['scm-derived:mixed-fallback', 'scm-mixed-fallback'],
    ['scm-derived:fallback', 'scm-fallback'],
    ['scm-derived:fresh-fallback', 'scm-fresh-fallback'],
    ['provider-result:cache', 'provider-cache'],
    ['provider-result:live', 'provider-live']
  ].map(([key, label]) => {
    const count = Number(surfaceSource[key] || 0);
    return count > 0 ? `${label}=${count}` : null;
  }).filter(Boolean);
  if (reuseHighlights.length) {
    lines.push(`[diagnostics] reuse surfaces: ${reuseHighlights.join(' | ')}`);
  }
  const qualityCounts = reuse?.countsByQualityImpact && typeof reuse.countsByQualityImpact === 'object'
    ? reuse.countsByQualityImpact
    : {};
  const qualityHighlights = Object.entries(qualityCounts)
    .filter(([, count]) => Number(count) > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, count]) => `${label}=${count}`);
  const timeCostMs = Number(reuse?.cost?.timeCostMs || 0);
  const fetchedCount = Number(reuse?.cost?.fetchedCount || 0);
  const chunkCount = Number(reuse?.cost?.chunkCount || 0);
  if (timeCostMs > 0 || fetchedCount > 0 || chunkCount > 0 || qualityHighlights.length) {
    const costHighlights = [];
    if (timeCostMs > 0) costHighlights.push(`time=${formatCompactDuration(timeCostMs)}`);
    if (fetchedCount > 0) costHighlights.push(`fetched-files=${fetchedCount}`);
    if (chunkCount > 0) costHighlights.push(`chunks=${chunkCount}`);
    if (qualityHighlights.length) costHighlights.push(`quality ${qualityHighlights.join(' | ')}`);
    lines.push(`[diagnostics] fallback cost: ${costHighlights.join(' | ')}`);
  }
  const qualityBudget = output?.diagnostics?.qualityBudget && typeof output.diagnostics.qualityBudget === 'object'
    ? output.diagnostics.qualityBudget
    : null;
  const reducedRecallCount = Number(qualityBudget?.reducedRecallCount || 0);
  const budgetSkippedFiles = Number(qualityBudget?.skippedFiles || 0);
  const budgetSuppressedFiles = Number(qualityBudget?.estimatedSuppressedFiles || 0);
  const weightedRecallLossRatio = Number(qualityBudget?.weightedRecallLossRatio || 0);
  if (reducedRecallCount > 0 || budgetSkippedFiles > 0 || budgetSuppressedFiles > 0 || weightedRecallLossRatio > 0) {
    const budgetHighlights = [];
    if (reducedRecallCount > 0) budgetHighlights.push(`reduced-recall=${reducedRecallCount}`);
    if (budgetSkippedFiles > 0) budgetHighlights.push(`skipped-files=${budgetSkippedFiles}`);
    if (budgetSuppressedFiles > 0) budgetHighlights.push(`suppressed-est=${budgetSuppressedFiles}`);
    if (weightedRecallLossRatio > 0) budgetHighlights.push(`weighted-recall-loss=${(weightedRecallLossRatio * 100).toFixed(1)}%`);
    lines.push(`[diagnostics] extracted-prose quality budget: ${budgetHighlights.join(' | ')}`);
  }
  const repoYieldClassCounts = qualityBudget?.countsByRepoYieldClass && typeof qualityBudget.countsByRepoYieldClass === 'object'
    ? qualityBudget.countsByRepoYieldClass
    : {};
  const opportunityClassCounts = qualityBudget?.countsByOpportunityClass
    && typeof qualityBudget.countsByOpportunityClass === 'object'
    ? qualityBudget.countsByOpportunityClass
    : {};
  const recallClassCounts = qualityBudget?.countsByRecallClass && typeof qualityBudget.countsByRecallClass === 'object'
    ? qualityBudget.countsByRecallClass
    : {};
  const budgetClassHighlights = [
    ...Object.entries(repoYieldClassCounts)
      .filter(([, count]) => Number(count) > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, count]) => `${label}=${count}`),
    ...Object.entries(opportunityClassCounts)
      .filter(([, count]) => Number(count) > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, count]) => `opportunity-${label}=${count}`),
    ...Object.entries(recallClassCounts)
      .filter(([, count]) => Number(count) > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, count]) => `recall-${label}=${count}`)
  ];
  if (budgetClassHighlights.length) {
    lines.push(`[diagnostics] extracted-prose classes: ${budgetClassHighlights.join(' | ')}`);
  }
  const warningCount = Number(countsBySeverity.warn || 0);
  const errorCount = Number(countsBySeverity.error || 0);
  if (warningCount > 0 || errorCount > 0) {
    lines.push(`[diagnostics] severity: error=${errorCount} warn=${warningCount}`);
  }
  const progressBuckets = output?.diagnostics?.progressConfidence?.countsByBucket
    && typeof output.diagnostics.progressConfidence.countsByBucket === 'object'
    ? output.diagnostics.progressConfidence.countsByBucket
    : {};
  const mediumConfidence = Number(progressBuckets.medium || 0);
  const lowConfidence = Number(progressBuckets.low || 0);
  if (mediumConfidence > 0 || lowConfidence > 0) {
    lines.push(`[diagnostics] progress confidence: low=${lowConfidence} medium=${mediumConfidence}`);
  }
  const retainedCount = Number(output?.diagnostics?.crashRetention?.retainedCount) || 0;
  if (retainedCount > 0) {
    lines.push(`[diagnostics] retained crash bundles: ${retainedCount}`);
  }
  return lines;
};

const resolveTaskPayload = async (entry) => {
  if (!entry?.outFile) return null;
  return loadJsonFile(entry.outFile);
};

const resolveTaskRepoIdentity = (entry, payload) => (
  entry?.repoPath
  || payload?.repo?.root
  || payload?.artifacts?.repo?.root
  || `${entry?.language || 'unknown'}/${entry?.repo || 'unknown'}`
);

const resolveTaskThroughputLedger = ({ entry, payload }) => {
  const existing = payload?.artifacts?.throughputLedger;
  if (isValidThroughputLedger(existing)) return existing;
  return buildThroughputLedgerForTask({
    repoPath: entry?.repoPath || payload?.repo?.root || payload?.artifacts?.repo?.root || null,
    summary: entry?.summary || payload?.summary || null,
    throughput: payload?.artifacts?.throughput || null,
    indexingSummary: payload?.artifacts?.indexing || null
  });
};

const applyThroughputLedgerDiffs = (tasks) => {
  const historyByRepo = new Map();
  const historyWindow = 8;
  const out = [];
  for (const task of tasks) {
    const repoIdentity = task.repoIdentity;
    const baseline = historyByRepo.get(repoIdentity) || [];
    const throughputLedgerDiff = isValidThroughputLedger(task.throughputLedger)
      ? computeThroughputLedgerRegression({
        currentLedger: task.throughputLedger,
        baselineLedgers: baseline,
        metric: 'chunksPerSec'
      })
      : null;
    const nextTask = {
      ...task,
      throughputLedgerDiff
    };
    out.push(nextTask);
    if (isValidThroughputLedger(task.throughputLedger)) {
      if (historyByRepo.has(repoIdentity)) {
        baseline.push(task.throughputLedger);
        while (baseline.length > historyWindow) baseline.shift();
      } else {
        historyByRepo.set(repoIdentity, [task.throughputLedger]);
      }
    }
  }
  return out;
};

const buildThroughputLedgerSummary = (tasks) => {
  const topRegressions = [];
  for (const entry of tasks) {
    const regressions = entry?.throughputLedgerDiff?.regressions || [];
    for (const regression of regressions.slice(0, 3)) {
      pushTopNOrdered(topRegressions, {
        language: entry.language,
        tier: entry.tier,
        repo: entry.repo,
        repoIdentity: entry.repoIdentity,
        modality: regression.modality,
        stage: regression.stage,
        metric: regression.metric,
        currentRate: regression.currentRate,
        baselineRate: regression.baselineRate,
        deltaRate: regression.deltaRate,
        deltaPct: regression.deltaPct,
        baselineSamples: regression.baselineSamples
      }, 20, (left, right) => (
        Number(left.deltaPct) - Number(right.deltaPct)
      ) || String(left.repoIdentity).localeCompare(String(right.repoIdentity)));
    }
  }
  return {
    schemaVersion: THROUGHPUT_LEDGER_SCHEMA_VERSION,
    diffSchemaVersion: THROUGHPUT_LEDGER_DIFF_SCHEMA_VERSION,
    taskCount: tasks.length,
    ledgerTaskCount: tasks.filter((entry) => isValidThroughputLedger(entry?.throughputLedger)).length,
    diffTaskCount: tasks.filter((entry) => entry?.throughputLedgerDiff?.baselineCount > 0).length,
    topRegressions
  };
};

export const buildReportOutput = async ({
  configPath,
  cacheRoot,
  resultsRoot,
  results,
  config,
  environmentMetadata = null,
  runLabel = null,
  runSuffix = null,
  waiverFile = null,
  methodology = null
}) => {
  const metricTags = buildBenchMetricTags(methodology);
  const controlSliceTaskIds = new Set(
    Array.isArray(methodology?.controlSlice?.taskIds)
      ? methodology.controlSlice.taskIds
      : []
  );
  const taskInputs = Array.isArray(results) ? results : [];
  const tasksWithTelemetry = await mapWithConcurrency(taskInputs, async (entry) => {
    const payload = await resolveTaskPayload(entry);
    const throughputLedger = resolveTaskThroughputLedger({ entry, payload });
    const summary = entry?.summary || null;
    const stageTimingProfile = entry?.stageTimingProfile || (summary
      ? buildStageTimingProfileForTask({
        repoPath: entry.repoPath,
        summary
      })
      : null);
    return {
      ...entry,
      payload,
      repoIdentity: resolveTaskRepoIdentity(entry, payload),
      stageTimingProfile,
      throughputLedger,
      benchContext: {
        metricTags,
        controlSliceMember: controlSliceTaskIds.has(buildBenchMethodologyTaskId(entry))
      }
    };
  }, { concurrency: 8 });
  const tasks = applyThroughputLedgerDiffs(tasksWithTelemetry);
  const groupedResults = new Map();
  for (const entry of tasks) {
    if (!groupedResults.has(entry.language)) groupedResults.set(entry.language, []);
    groupedResults.get(entry.language).push(entry);
  }
  const groupedSummary = {};
  for (const [language, items] of groupedResults.entries()) {
    groupedSummary[language] = {
      label: config[language]?.label || language,
      count: items.length,
      summary: summarizeResults(items, { metricTags, methodology })
    };
  }
  const overallSummary = summarizeResults(tasks, { metricTags, methodology });
  const crashRetention = buildCrashRetentionSummary(tasks);
  const streamOptions = { runSuffix };
  const diagnosticsStream = await buildDiagnosticsStreamSummary(resultsRoot, streamOptions);
  const diagnosticsParity = await buildDiagnosticsParitySummary(resultsRoot, diagnosticsStream, streamOptions);
  const reuseDiagnostics = await buildBenchReuseDiagnosticsSummary(tasks, resultsRoot, streamOptions);
  const progressConfidence = await buildProgressConfidenceSummary(resultsRoot, streamOptions);
  const preflight = await buildPreflightLogSummary(resultsRoot, streamOptions);
  const throughputLedger = buildThroughputLedgerSummary(tasks);
  const stageTimingTasks = tasks
    .filter((entry) => entry?.stageTimingProfile)
    .map((entry) => ({
      language: entry.language,
      tier: entry.tier,
      repo: entry.repo,
      repoPath: entry.repoPath || null,
      outFile: entry.outFile || null,
      stageTiming: entry.stageTimingProfile
    }));
  const stageTimingGrouped = Object.fromEntries(
    Object.entries(groupedSummary)
      .map(([language, payload]) => [language, payload?.summary?.stageTiming || null])
  );
  const remediation = buildRemediationSummary(tasks);
  const policy = await loadBenchPolicy({ waiverFile });
  const verdict = evaluateBenchVerdict({ tasks, policy, methodology });
  const ownership = buildBenchOwnershipSummary({
    tasks: verdict.tasks,
    methodology
  });
  let blockerConfirmations = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    loadErrors: [],
    summary: buildBenchRuntimeBlockerConfirmationSummary({
      manifest: { liveCanaries: [] },
      tasks: verdict.tasks,
      generatedAt: runSuffix,
      runAggregateResultClass: verdict.run.aggregateResultClass,
      runEnvironmentFingerprint: environmentMetadata?.fingerprint || null,
      runLabel
    })
  };
  try {
    const { manifest } = await loadBenchRuntimeCanaryManifest(process.cwd());
    const manifestFailures = validateBenchRuntimeCanaryManifest(manifest);
    blockerConfirmations = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      loadErrors: manifestFailures,
      summary: buildBenchRuntimeBlockerConfirmationSummary({
        manifest,
        tasks: verdict.tasks,
        generatedAt: runSuffix,
        runAggregateResultClass: verdict.run.aggregateResultClass,
        runEnvironmentFingerprint: environmentMetadata?.fingerprint || null,
        runLabel
      })
    };
  } catch (error) {
    blockerConfirmations = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      loadErrors: [error?.message || String(error)],
      summary: buildBenchRuntimeBlockerConfirmationSummary({
        manifest: { liveCanaries: [] },
        tasks: verdict.tasks,
        generatedAt: runSuffix,
        runAggregateResultClass: verdict.run.aggregateResultClass,
        runEnvironmentFingerprint: environmentMetadata?.fingerprint || null,
        runLabel
      })
    };
  }
  return {
    generatedAt: new Date().toISOString(),
    config: configPath,
    cacheRoot,
    resultsRoot,
    environment: environmentMetadata || null,
    methodology,
    tasks: verdict.tasks,
    run: verdict.run,
    diagnostics: {
      crashRetention,
      stream: diagnosticsStream,
      parity: diagnosticsParity,
      reuse: reuseDiagnostics,
      qualityBudget: buildBenchQualityBudgetSummary(tasks),
      progressConfidence,
      preflight
    },
    blockerConfirmations,
    ownership,
    throughputLedger,
    stageTiming: {
      schemaVersion: STAGE_TIMING_SCHEMA_VERSION,
      tasks: stageTimingTasks,
      grouped: stageTimingGrouped,
      overall: overallSummary?.stageTiming || null
    },
    remediation,
    groupedSummary,
    overallSummary
  };
};
