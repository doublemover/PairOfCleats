import crypto from 'node:crypto';
import { log, logError } from '../../../src/shared/progress.js';
import {
  normalizeReuseSource,
  normalizeReuseSurface,
  resolveQualityImpactForCause,
  resolveScmFallbackCause
} from '../../../src/shared/reuse-diagnostics.js';

const ENV_METADATA_KEYS = Object.freeze([
  'NODE_OPTIONS',
  'PAIROFCLEATS_TESTING',
  'PAIROFCLEATS_TEST_CONFIG',
  'PAIROFCLEATS_CACHE_ROOT',
  'PAIROFCLEATS_CRASH_LOG_ANNOUNCE'
]);

export const BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION = 2;
export const BENCH_DIAGNOSTIC_EVENT_TYPES = Object.freeze([
  'parser_crash',
  'scm_timeout',
  'queue_delay_hotspot',
  'artifact_tail_stall',
  'runtime_timeout_budget_extended',
  'runtime_timeout',
  'fallback_used',
  'warning_suppressed',
  'provider_preflight_start',
  'provider_preflight_finish',
  'provider_preflight_blocked',
  'provider_request_timeout',
  'provider_request_failed',
  'provider_circuit_breaker',
  'provider_degraded_mode_entered',
  'provider_degraded_mode_cleared',
  'workspace_partition_decision'
]);
export const BENCH_DIAGNOSTIC_PARITY_EVENT_TYPES = Object.freeze([
  'fallback_used',
  'warning_suppressed',
  'provider_preflight_blocked',
  'provider_request_timeout',
  'provider_request_failed',
  'provider_circuit_breaker',
  'provider_degraded_mode_entered',
  'workspace_partition_decision'
]);
export const BENCH_DIAGNOSTIC_MATERIAL_PARITY_EVENT_TYPES = Object.freeze([
  'fallback_used',
  'warning_suppressed',
  'provider_preflight_blocked',
  'provider_request_timeout',
  'provider_request_failed',
  'provider_circuit_breaker',
  'provider_degraded_mode_entered'
]);
export const BENCH_PROGRESS_CONFIDENCE_SCHEMA_VERSION = 1;
export const BENCH_PROGRESS_CONFIDENCE_THRESHOLDS = Object.freeze({
  high: 0.75,
  medium: 0.5
});
export const BENCH_PROGRESS_CONFIDENCE_COMPONENT_WEIGHTS = Object.freeze({
  heartbeatRegularity: 0.35,
  queueAge: 0.25,
  inFlightSpread: 0.2,
  stallEvents: 0.2
});

const BENCH_DIAGNOSTIC_EVENT_TYPE_SET = new Set(BENCH_DIAGNOSTIC_EVENT_TYPES);
const TOOLING_PREFLIGHT_EVENT_STATE_BY_EVENT = Object.freeze({
  start: 'running',
  queued: 'queued',
  dequeued: 'running',
  ok: 'ready',
  cache_hit: 'ready',
  blocked: 'blocked',
  degraded: 'degraded',
  failed: 'failed',
  timeout: 'degraded',
  teardown_timeout: 'failed',
  teardown_failed: 'failed',
  teardown_abort: 'failed',
  teardown_force_cleanup: 'failed'
});
const TOOLING_REQUEST_METHOD_BY_STAGE = Object.freeze({
  documentsymbol: 'textDocument/documentSymbol',
  hover: 'textDocument/hover',
  semantic_tokens: 'textDocument/semanticTokens/full',
  signature_help: 'textDocument/signatureHelp',
  inlay_hints: 'textDocument/inlayHint',
  definition: 'textDocument/definition',
  type_definition: 'textDocument/typeDefinition',
  references: 'textDocument/references'
});
const TOOLING_PREFLIGHT_START_PATTERN = /\[tooling\]\s+preflight:start\s+provider=(?<providerId>[^\s]+)\s+id=(?<preflightId>[^\s]+)(?<rest>.*)$/iu;
const TOOLING_PREFLIGHT_FINISH_PATTERN = /\[tooling\]\s+preflight:(?<event>cache_hit|ok|blocked|degraded|failed|timeout)\s+provider=(?<providerId>[^\s]+)\s+id=(?<preflightId>[^\s]+)(?<rest>.*)$/iu;
const TOOLING_REQUEST_SIGNAL_PATTERN = /\[tooling\]\s+request:(?<kind>timeout|failed)\s+provider=(?<providerId>[^\s]+)\s+method=(?<requestMethod>[^\s]+)(?<rest>.*)$/iu;
const TOOLING_CIRCUIT_BREAKER_PATTERN = /\[tooling\]\s+(?<providerId>[^\s]+)\s+circuit breaker tripped\./iu;
const TOOLING_DEGRADED_ENTER_PATTERN = /\[tooling\]\s+(?<providerId>[^\s]+)\s+degraded mode active \(fail-open\)\./iu;
const TOOLING_DEGRADED_CLEAR_PATTERN = /\[tooling\]\s+(?<providerId>[^\s]+)\s+degraded mode cleared\./iu;
const TOOLING_WORKSPACE_PARTITION_PATTERN = /\[tooling\]\s+workspace:partition\s+provider=(?<providerId>[^\s]+)(?<rest>.*)$/iu;
const TOOLING_WARNING_SUPPRESSED_PATTERN = /\[tooling\]\s+(?<providerId>[^\s]+)\s+suppressed\s+(?<count>\d+)\s+(?<kind>.+?)\s+stderr line\(s\)(?<rest>.*)$/iu;
const IMPORT_WARNING_SUPPRESSED_POLICY_PATTERN = /\[imports\]\s+all captured unresolved samples were suppressed by live policy\s+\((?<count>\d+)\)\./iu;
const IMPORT_WARNING_SUPPRESSION_EVENT_PATTERN = /\[imports\]\s+suppression:\s+policy=(?<policy>[^\s]+)\s+count=(?<count>\d+)\s+degraded=(?<degraded>[01])\s+visible=(?<visible>\d+)\s+total=(?<total>\d+)\s+actionable=(?<actionable>\d+)\s+omittedFailureCauses=(?<failureCauses>[^\s]+)$/iu;
const IMPORT_WARNING_SUPPRESSED_COUNT_PATTERN = /\[imports\]\s+suppressed\s+(?<count>\d+)\s+import resolution warnings\./iu;
const SCM_FILE_META_SNAPSHOT_PATTERN = /\[scm\]\s+file-meta snapshot:\s+source=(?<source>[^\s]+)\s+requested=(?<requested>\d+)\s+reused=(?<reused>\d+)\s+fetched=(?<fetched>\d+)\.(?<rest>.*)$/iu;
const TOOLING_PROVIDER_DONE_PATTERN = /\[tooling\]\s+provider\s+\d+\/\d+\s+done\s+id=(?<providerId>[^\s]+)\s+outcome=(?<outcome>[^\s]+)\s+source=(?<source>[^\s]+)\s+chunks=(?<chunks>\d+)\s+elapsedMs=(?<elapsedMs>\d+)\./iu;
const TOOLING_CACHE_SKIPPED_PATTERN = /\[tooling\]\s+provider cache skipped for\s+(?<providerId>[^\s:]+):\s+oversized\s+\((?<sizeBytes>\d+)\s+bytes\)\./iu;
const TOOLING_CACHE_READ_FAILED_PATTERN = /\[tooling\]\s+provider cache read failed for\s+(?<providerId>[^\s;]+);\s+using live run\./iu;
const TOOLING_CACHE_WRITE_FAILED_PATTERN = /\[tooling\]\s+provider cache write failed for\s+(?<providerId>[^\s.]+)\./iu;
const TOOLING_FIELD_PATTERN = /([a-zA-Z][a-zA-Z0-9_]*)=("([^"]*)"|[^\s]+)/gu;

export const BENCH_DIAGNOSTIC_SEVERITY_LEVELS = Object.freeze([
  'info',
  'warn',
  'error'
]);
const BENCH_DIAGNOSTIC_SEVERITY_RANK = Object.freeze({
  info: 0,
  warn: 1,
  error: 2
});

const normalizeDiagnosticField = (value, maxLength = 160) => (
  normalizeBenchDiagnosticText(value, { maxLength })
);

const parseToolingFields = (raw) => {
  const out = Object.create(null);
  const text = String(raw || '');
  for (const match of text.matchAll(TOOLING_FIELD_PATTERN)) {
    const key = String(match[1] || '').trim();
    const rawValue = String(match[3] ?? match[2] ?? '').trim();
    if (!key || !rawValue) continue;
    out[key.toLowerCase()] = rawValue;
  }
  return out;
};

const toPositiveCount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.floor(parsed)) : null;
};

const toNonNegativeCount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.max(0, Math.floor(parsed)) : null;
};

const normalizeWorkspacePartitionValue = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  return text;
};

const parseScmSnapshotObservation = (text) => {
  const match = SCM_FILE_META_SNAPSHOT_PATTERN.exec(text);
  if (!match) return null;
  const source = normalizeReuseSource(match.groups?.source) || 'unknown';
  const requested = toNonNegativeCount(match.groups?.requested);
  const reused = toNonNegativeCount(match.groups?.reused);
  const fetched = toNonNegativeCount(match.groups?.fetched);
  const fields = parseToolingFields(match.groups?.rest || '');
  const timeoutCount = toNonNegativeCount(fields.timeoutcount) || 0;
  const timeoutRetries = toNonNegativeCount(fields.timeoutretries) || 0;
  const cooldownSkips = toNonNegativeCount(fields.cooldownskips) || 0;
  const unavailableChunks = toNonNegativeCount(fields.unavailablechunks) || 0;
  const elapsedMs = toNonNegativeCount(fields.elapsedms);
  const causeClass = resolveScmFallbackCause({
    source,
    timeoutCount,
    cooldownSkips,
    unavailableChunks
  });
  return {
    kind: 'scm_snapshot',
    reuseSurface: 'scm-derived',
    reuseSource: source,
    causeClass,
    qualityImpact: resolveQualityImpactForCause(causeClass),
    requestedCount: requested,
    reusedCount: reused,
    fetchedCount: fetched,
    timeCostMs: elapsedMs,
    timeoutCount,
    timeoutRetries,
    cooldownSkips,
    unavailableChunks
  };
};

const parseToolingProviderDoneObservation = (text) => {
  const match = TOOLING_PROVIDER_DONE_PATTERN.exec(text);
  if (!match) return null;
  const providerId = String(match.groups?.providerId || '').trim() || null;
  const source = normalizeReuseSource(match.groups?.source) || 'unknown';
  const chunks = toNonNegativeCount(match.groups?.chunks);
  const elapsedMs = toNonNegativeCount(match.groups?.elapsedMs);
  const outcome = String(match.groups?.outcome || '').trim().toLowerCase() || null;
  const causeClass = source === 'cache'
    ? 'cache_hit'
    : (source === 'live' ? 'cache_miss' : source);
  return {
    kind: 'provider_result',
    reuseSurface: 'provider-result',
    reuseSource: source,
    providerId,
    causeClass,
    qualityImpact: resolveQualityImpactForCause(causeClass),
    chunkCount: chunks,
    timeCostMs: elapsedMs,
    outcome
  };
};

const parseToolingCacheObservation = (text) => {
  const skippedMatch = TOOLING_CACHE_SKIPPED_PATTERN.exec(text);
  if (skippedMatch) {
    return {
      kind: 'provider_cache',
      reuseSurface: 'provider-result',
      reuseSource: 'live',
      providerId: String(skippedMatch.groups?.providerId || '').trim() || null,
      causeClass: 'cache_invalid',
      qualityImpact: resolveQualityImpactForCause('cache_invalid'),
      sizeBytes: toNonNegativeCount(skippedMatch.groups?.sizeBytes)
    };
  }
  const readFailedMatch = TOOLING_CACHE_READ_FAILED_PATTERN.exec(text);
  if (readFailedMatch) {
    return {
      kind: 'provider_cache',
      reuseSurface: 'provider-result',
      reuseSource: 'live',
      providerId: String(readFailedMatch.groups?.providerId || '').trim() || null,
      causeClass: 'cache_invalid',
      qualityImpact: resolveQualityImpactForCause('cache_invalid')
    };
  }
  const writeFailedMatch = TOOLING_CACHE_WRITE_FAILED_PATTERN.exec(text);
  if (writeFailedMatch) {
    return {
      kind: 'provider_cache',
      reuseSurface: 'provider-result',
      reuseSource: 'write-failed',
      providerId: String(writeFailedMatch.groups?.providerId || '').trim() || null,
      causeClass: 'cache_write_failed',
      qualityImpact: 'future-reuse-risk'
    };
  }
  return null;
};

export const parseBenchReuseObservation = (line = '') => {
  const text = String(line || '').trim();
  if (!text) return null;
  return parseScmSnapshotObservation(text)
    || parseToolingCacheObservation(text)
    || parseToolingProviderDoneObservation(text)
    || null;
};

const buildDiagnosticSignal = ({
  eventType,
  message,
  source = 'stream',
  providerId = null,
  workspacePartition = null,
  requestMethod = null,
  failureClass = null,
  preflightId = null,
  preflightClass = null,
  preflightState = null,
  reuseSurface = null,
  reuseSource = null,
  qualityImpact = null,
  timeCostMs = null,
  requestedCount = null,
  reusedCount = null,
  fetchedCount = null,
  chunkCount = null,
  timeoutKind = null,
  phase = null,
  resourceClass = null,
  failureMode = null,
  decisionReason = null,
  outcome = null,
  effectiveBudgetMs = null,
  skippedWork = null,
  partialSuccess = null,
  suppressedCount = null,
  suppressionPolicy = null,
  omittedSampleClasses = null,
  degradedRun = null,
  visibleSampleCount = null,
  actionableCount = null,
  totalCount = null,
  stage = null,
  taskId = null,
  level = null,
  severity = null
} = {}) => {
  if (!isBenchDiagnosticEventType(eventType)) return null;
  return {
    eventType,
    message: String(message || '').trim(),
    source: String(source || 'stream').trim() || 'stream',
    providerId: String(providerId || '').trim() || null,
    workspacePartition: normalizeWorkspacePartitionValue(workspacePartition),
    requestMethod: String(requestMethod || '').trim() || null,
    failureClass: String(failureClass || '').trim() || null,
    preflightId: String(preflightId || '').trim() || null,
    preflightClass: String(preflightClass || '').trim() || null,
    preflightState: String(preflightState || '').trim() || null,
    reuseSurface: normalizeReuseSurface(reuseSurface),
    reuseSource: normalizeReuseSource(reuseSource),
    qualityImpact: String(qualityImpact || '').trim().toLowerCase() || null,
    timeCostMs: toNonNegativeCount(timeCostMs),
    requestedCount: toNonNegativeCount(requestedCount),
    reusedCount: toNonNegativeCount(reusedCount),
    fetchedCount: toNonNegativeCount(fetchedCount),
    chunkCount: toNonNegativeCount(chunkCount),
    timeoutKind: String(timeoutKind || '').trim() || null,
    phase: String(phase || '').trim() || null,
    resourceClass: String(resourceClass || '').trim() || null,
    failureMode: String(failureMode || '').trim() || null,
    decisionReason: String(decisionReason || '').trim() || null,
    outcome: String(outcome || '').trim() || null,
    effectiveBudgetMs: toNonNegativeCount(effectiveBudgetMs),
    skippedWork: Array.isArray(skippedWork)
      ? skippedWork.map((entry) => String(entry || '').trim()).filter(Boolean)
      : null,
    partialSuccess: typeof partialSuccess === 'boolean' ? partialSuccess : null,
    suppressedCount: toNonNegativeCount(suppressedCount),
    suppressionPolicy: String(suppressionPolicy || '').trim() || null,
    omittedSampleClasses: Array.isArray(omittedSampleClasses)
      ? omittedSampleClasses.map((entry) => String(entry || '').trim()).filter(Boolean)
      : null,
    degradedRun: typeof degradedRun === 'boolean' ? degradedRun : null,
    visibleSampleCount: toNonNegativeCount(visibleSampleCount),
    actionableCount: toNonNegativeCount(actionableCount),
    totalCount: toNonNegativeCount(totalCount),
    stage: String(stage || '').trim() || null,
    taskId: String(taskId || '').trim() || null,
    level: String(level || '').trim() || null,
    severity: normalizeBenchDiagnosticSeverity(severity)
  };
};

export const normalizeBenchDiagnosticSeverity = (value, fallback = 'info') => {
  const text = String(value || '').trim().toLowerCase();
  if (text && Object.prototype.hasOwnProperty.call(BENCH_DIAGNOSTIC_SEVERITY_RANK, text)) return text;
  return String(fallback || 'info').trim().toLowerCase();
};

export const resolveBenchDiagnosticSeverity = ({
  eventType,
  failureClass = null,
  preflightState = null
} = {}) => {
  const type = String(eventType || '').trim();
  const failure = String(failureClass || '').trim().toLowerCase();
  const state = String(preflightState || '').trim().toLowerCase();
  switch (type) {
    case 'parser_crash':
    case 'runtime_timeout':
      return 'error';
    case 'provider_preflight_start':
    case 'provider_degraded_mode_cleared':
    case 'runtime_timeout_budget_extended':
      return 'info';
    case 'provider_preflight_finish':
      if (state === 'ready' || failure === 'ready') return 'info';
      return 'warn';
    case 'scm_timeout':
    case 'queue_delay_hotspot':
    case 'artifact_tail_stall':
    case 'fallback_used':
    case 'warning_suppressed':
    case 'provider_preflight_blocked':
    case 'provider_request_timeout':
    case 'provider_request_failed':
    case 'provider_circuit_breaker':
    case 'provider_degraded_mode_entered':
    case 'workspace_partition_decision':
      return 'warn';
    default:
      return 'info';
  }
};

export const createBenchDiagnosticClassifier = () => {
  const preflightByKey = new Map();

  const classifyStructuredDiagnostics = ({
    event = null,
    source = 'stream'
  } = {}) => {
    const candidates = Array.isArray(event?.benchDiagnostics)
      ? event.benchDiagnostics
      : (event?.benchDiagnostic && typeof event.benchDiagnostic === 'object' && !Array.isArray(event.benchDiagnostic)
        ? [event.benchDiagnostic]
        : []);
    if (!candidates.length) return [];
    const signals = [];
    for (const entry of candidates) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const signal = buildDiagnosticSignal({
        eventType: entry.eventType,
        message: entry.message || event?.message || '',
        source: entry.source || source,
        providerId: entry.providerId || event?.providerId || null,
        workspacePartition: entry.workspacePartition || null,
        requestMethod: entry.requestMethod || null,
        failureClass: entry.failureClass || null,
        preflightId: entry.preflightId || null,
        preflightClass: entry.preflightClass || null,
        preflightState: entry.preflightState || null,
        reuseSurface: entry.reuseSurface || null,
        reuseSource: entry.reuseSource || null,
        qualityImpact: entry.qualityImpact || null,
        timeCostMs: entry.timeCostMs,
        requestedCount: entry.requestedCount,
        reusedCount: entry.reusedCount,
        fetchedCount: entry.fetchedCount,
        chunkCount: entry.chunkCount,
        timeoutKind: entry.timeoutKind || null,
        phase: entry.phase || null,
        resourceClass: entry.resourceClass || null,
        failureMode: entry.failureMode || null,
        decisionReason: entry.decisionReason || null,
        outcome: entry.outcome || null,
        effectiveBudgetMs: entry.effectiveBudgetMs,
        skippedWork: entry.skippedWork || null,
        partialSuccess: entry.partialSuccess ?? null,
        suppressedCount: entry.suppressedCount,
        suppressionPolicy: entry.suppressionPolicy,
        omittedSampleClasses: entry.omittedSampleClasses,
        degradedRun: entry.degradedRun ?? null,
        visibleSampleCount: entry.visibleSampleCount,
        actionableCount: entry.actionableCount,
        totalCount: entry.totalCount,
        stage: entry.stage ?? event?.stage ?? null,
        taskId: entry.taskId ?? event?.taskId ?? null,
        level: entry.level ?? event?.level ?? null,
        severity: normalizeBenchDiagnosticSeverity(
          entry.severity,
          resolveBenchDiagnosticSeverity({
            eventType: entry.eventType,
            failureClass: entry.failureClass || null,
            preflightState: entry.preflightState || null
          })
        )
      });
      if (signal) signals.push(signal);
    }
    return signals;
  };

  const classify = ({
    line = '',
    event = null,
    source = 'stream'
  } = {}) => {
    const text = String(
      event && typeof event.message === 'string' && event.message.trim()
        ? event.message
        : line
    ).trim();
    if (!text) return [];
    const signals = [];
    const structuredSignals = classifyStructuredDiagnostics({ event, source });
    if (structuredSignals.length) return structuredSignals;

    const preflightStartMatch = TOOLING_PREFLIGHT_START_PATTERN.exec(text);
    if (preflightStartMatch) {
      const providerId = String(preflightStartMatch.groups?.providerId || '').trim();
      const preflightId = String(preflightStartMatch.groups?.preflightId || '').trim();
      const fields = parseToolingFields(preflightStartMatch.groups?.rest || '');
      const preflightClass = String(fields.class || '').trim() || null;
      if (providerId && preflightId) {
        preflightByKey.set(`${providerId}|${preflightId}`, {
          preflightClass
        });
      }
      const signal = buildDiagnosticSignal({
        eventType: 'provider_preflight_start',
        message: text,
        source,
        providerId,
        preflightId,
        preflightClass,
        preflightState: TOOLING_PREFLIGHT_EVENT_STATE_BY_EVENT.start,
        failureClass: 'start',
        stage: event?.stage || null,
        taskId: event?.taskId || null,
        level: event?.level || null,
        severity: resolveBenchDiagnosticSeverity({
          eventType: 'provider_preflight_start',
          failureClass: 'start',
          preflightState: TOOLING_PREFLIGHT_EVENT_STATE_BY_EVENT.start
        })
      });
      return signal ? [signal] : [];
    }

    const preflightFinishMatch = TOOLING_PREFLIGHT_FINISH_PATTERN.exec(text);
    if (preflightFinishMatch) {
      const providerId = String(preflightFinishMatch.groups?.providerId || '').trim();
      const preflightId = String(preflightFinishMatch.groups?.preflightId || '').trim();
      const eventName = String(preflightFinishMatch.groups?.event || '').trim().toLowerCase();
      const fields = parseToolingFields(preflightFinishMatch.groups?.rest || '');
      const cached = preflightByKey.get(`${providerId}|${preflightId}`) || null;
      const preflightClass = String(fields.class || cached?.preflightClass || '').trim() || null;
      const preflightState = String(
        fields.state || TOOLING_PREFLIGHT_EVENT_STATE_BY_EVENT[eventName] || ''
      ).trim().toLowerCase() || null;
      const failureClass = eventName === 'ok' || preflightState === 'ready'
        ? 'ready'
        : eventName;
      const finishSignal = buildDiagnosticSignal({
        eventType: 'provider_preflight_finish',
        message: text,
        source,
        providerId,
        preflightId,
        preflightClass,
        preflightState,
        failureClass,
        stage: event?.stage || null,
        taskId: event?.taskId || null,
        level: event?.level || null,
        severity: resolveBenchDiagnosticSeverity({
          eventType: 'provider_preflight_finish',
          failureClass,
          preflightState
        })
      });
      if (finishSignal) signals.push(finishSignal);
      if (preflightState === 'blocked' || failureClass === 'blocked') {
        const blockedSignal = buildDiagnosticSignal({
          eventType: 'provider_preflight_blocked',
          message: text,
          source,
          providerId,
          preflightId,
          preflightClass,
          preflightState,
          failureClass: 'blocked',
          stage: event?.stage || null,
          taskId: event?.taskId || null,
          level: event?.level || null,
          severity: resolveBenchDiagnosticSeverity({
            eventType: 'provider_preflight_blocked',
            failureClass: 'blocked',
            preflightState
          })
        });
        if (blockedSignal) signals.push(blockedSignal);
      }
      return signals;
    }

    const requestMatch = TOOLING_REQUEST_SIGNAL_PATTERN.exec(text);
    if (requestMatch) {
      const providerId = String(requestMatch.groups?.providerId || '').trim();
      const requestMethod = String(requestMatch.groups?.requestMethod || '').trim();
      const kind = String(requestMatch.groups?.kind || '').trim().toLowerCase();
      const fields = parseToolingFields(requestMatch.groups?.rest || '');
      const stageName = String(fields.stage || '').trim().toLowerCase();
      const requestStageMethod = stageName ? TOOLING_REQUEST_METHOD_BY_STAGE[stageName] : null;
      const signal = buildDiagnosticSignal({
        eventType: kind === 'timeout' ? 'provider_request_timeout' : 'provider_request_failed',
        message: text,
        source,
        providerId,
        requestMethod: requestMethod || requestStageMethod || null,
        workspacePartition: fields.workspacepartition || null,
        failureClass: String(fields.class || kind).trim() || kind,
        stage: event?.stage || null,
        taskId: event?.taskId || null,
        level: event?.level || null,
        severity: resolveBenchDiagnosticSeverity({
          eventType: kind === 'timeout' ? 'provider_request_timeout' : 'provider_request_failed',
          failureClass: String(fields.class || kind).trim() || kind
        })
      });
      return signal ? [signal] : [];
    }

    const circuitMatch = TOOLING_CIRCUIT_BREAKER_PATTERN.exec(text);
    if (circuitMatch) {
      const signal = buildDiagnosticSignal({
        eventType: 'provider_circuit_breaker',
        message: text,
        source,
        providerId: circuitMatch.groups?.providerId || null,
        failureClass: 'circuit_breaker',
        stage: event?.stage || null,
        taskId: event?.taskId || null,
        level: event?.level || null,
        severity: resolveBenchDiagnosticSeverity({
          eventType: 'provider_circuit_breaker',
          failureClass: 'circuit_breaker'
        })
      });
      return signal ? [signal] : [];
    }

    const degradedEnterMatch = TOOLING_DEGRADED_ENTER_PATTERN.exec(text);
    if (degradedEnterMatch) {
      const signal = buildDiagnosticSignal({
        eventType: 'provider_degraded_mode_entered',
        message: text,
        source,
        providerId: degradedEnterMatch.groups?.providerId || null,
        failureClass: 'fail_open',
        stage: event?.stage || null,
        taskId: event?.taskId || null,
        level: event?.level || null,
        severity: resolveBenchDiagnosticSeverity({
          eventType: 'provider_degraded_mode_entered',
          failureClass: 'fail_open'
        })
      });
      return signal ? [signal] : [];
    }

    const degradedClearMatch = TOOLING_DEGRADED_CLEAR_PATTERN.exec(text);
    if (degradedClearMatch) {
      const signal = buildDiagnosticSignal({
        eventType: 'provider_degraded_mode_cleared',
        message: text,
        source,
        providerId: degradedClearMatch.groups?.providerId || null,
        failureClass: 'recovered',
        stage: event?.stage || null,
        taskId: event?.taskId || null,
        level: event?.level || null,
        severity: resolveBenchDiagnosticSeverity({
          eventType: 'provider_degraded_mode_cleared',
          failureClass: 'recovered'
        })
      });
      return signal ? [signal] : [];
    }

    const workspaceMatch = TOOLING_WORKSPACE_PARTITION_PATTERN.exec(text);
    if (workspaceMatch) {
      const providerId = String(workspaceMatch.groups?.providerId || '').trim();
      const fields = parseToolingFields(workspaceMatch.groups?.rest || '');
      const signal = buildDiagnosticSignal({
        eventType: 'workspace_partition_decision',
        message: text,
        source,
        providerId,
        workspacePartition: fields.workspacepartition || null,
        failureClass: String(fields.reason || fields.state || '').trim() || null,
        stage: event?.stage || null,
        taskId: event?.taskId || null,
        level: event?.level || null,
        severity: resolveBenchDiagnosticSeverity({
          eventType: 'workspace_partition_decision',
          failureClass: String(fields.reason || fields.state || '').trim() || null
        })
      });
      return signal ? [signal] : [];
    }

    const toolingWarningSuppressedMatch = TOOLING_WARNING_SUPPRESSED_PATTERN.exec(text);
    if (toolingWarningSuppressedMatch) {
      const providerId = String(toolingWarningSuppressedMatch.groups?.providerId || '').trim();
      const count = String(toolingWarningSuppressedMatch.groups?.count || '').trim();
      const kind = normalizeDiagnosticField(toolingWarningSuppressedMatch.groups?.kind || '', 96) || 'stderr';
      const signal = buildDiagnosticSignal({
        eventType: 'warning_suppressed',
        message: text,
        source,
        providerId,
        failureClass: `stderr:${kind}`,
        stage: event?.stage || null,
        taskId: event?.taskId || null,
        level: event?.level || null,
        severity: resolveBenchDiagnosticSeverity({
          eventType: 'warning_suppressed',
          failureClass: `stderr:${kind}:${count}`
        })
      });
      return signal ? [signal] : [];
    }

    const importPolicySuppressedMatch = IMPORT_WARNING_SUPPRESSED_POLICY_PATTERN.exec(text);
    if (importPolicySuppressedMatch) {
      const count = String(importPolicySuppressedMatch.groups?.count || '').trim();
      const signal = buildDiagnosticSignal({
        eventType: 'warning_suppressed',
        message: text,
        source,
        failureClass: `imports_live_policy:${count || 'unknown'}`,
        stage: event?.stage || null,
        taskId: event?.taskId || null,
        level: event?.level || null,
        severity: resolveBenchDiagnosticSeverity({
          eventType: 'warning_suppressed',
          failureClass: `imports_live_policy:${count || 'unknown'}`
        })
      });
      return signal ? [signal] : [];
    }

    const importSuppressionEventMatch = IMPORT_WARNING_SUPPRESSION_EVENT_PATTERN.exec(text);
    if (importSuppressionEventMatch) {
      const count = String(importSuppressionEventMatch.groups?.count || '').trim();
      const policy = String(importSuppressionEventMatch.groups?.policy || '').trim().toLowerCase() || 'unknown';
      const omittedSampleClasses = String(importSuppressionEventMatch.groups?.failureCauses || '')
        .split(',')
        .map((entry) => normalizeDiagnosticField(entry, 48))
        .filter(Boolean);
      const signal = buildDiagnosticSignal({
        eventType: 'warning_suppressed',
        message: text,
        source,
        failureClass: `imports_${policy}:${count || 'unknown'}`,
        suppressedCount: Number(count || 0),
        suppressionPolicy: policy,
        omittedSampleClasses,
        degradedRun: String(importSuppressionEventMatch.groups?.degraded || '') === '1',
        visibleSampleCount: Number(importSuppressionEventMatch.groups?.visible || 0),
        actionableCount: Number(importSuppressionEventMatch.groups?.actionable || 0),
        totalCount: Number(importSuppressionEventMatch.groups?.total || 0),
        stage: event?.stage || null,
        taskId: event?.taskId || null,
        level: event?.level || null,
        severity: resolveBenchDiagnosticSeverity({
          eventType: 'warning_suppressed',
          failureClass: `imports_${policy}:${count || 'unknown'}`
        })
      });
      return signal ? [signal] : [];
    }

    const importCountSuppressedMatch = IMPORT_WARNING_SUPPRESSED_COUNT_PATTERN.exec(text);
    if (importCountSuppressedMatch) {
      const count = String(importCountSuppressedMatch.groups?.count || '').trim();
      const signal = buildDiagnosticSignal({
        eventType: 'warning_suppressed',
        message: text,
        source,
        failureClass: `imports_warning_count:${count || 'unknown'}`,
        stage: event?.stage || null,
        taskId: event?.taskId || null,
        level: event?.level || null,
        severity: resolveBenchDiagnosticSeverity({
          eventType: 'warning_suppressed',
          failureClass: `imports_warning_count:${count || 'unknown'}`
        })
      });
      return signal ? [signal] : [];
    }

    const reuseObservation = parseBenchReuseObservation(text);
    if (reuseObservation && ['provider_unavailable', 'provider_unhealthy', 'cache_invalid'].includes(reuseObservation.causeClass)) {
      const signal = buildDiagnosticSignal({
        eventType: 'fallback_used',
        message: text,
        source,
        providerId: reuseObservation.providerId || null,
        failureClass: reuseObservation.causeClass,
        reuseSurface: reuseObservation.reuseSurface,
        reuseSource: reuseObservation.reuseSource,
        qualityImpact: reuseObservation.qualityImpact,
        timeCostMs: reuseObservation.timeCostMs,
        requestedCount: reuseObservation.requestedCount,
        reusedCount: reuseObservation.reusedCount,
        fetchedCount: reuseObservation.fetchedCount,
        chunkCount: reuseObservation.chunkCount,
        stage: event?.stage || null,
        taskId: event?.taskId || null,
        level: event?.level || null,
        severity: resolveBenchDiagnosticSeverity({
          eventType: 'fallback_used',
          failureClass: reuseObservation.causeClass
        })
      });
      return signal ? [signal] : [];
    }

    return [];
  };

  return { classify };
};

export const isBenchDiagnosticEventType = (value) => (
  typeof value === 'string' && BENCH_DIAGNOSTIC_EVENT_TYPE_SET.has(value)
);

export const normalizeBenchDiagnosticText = (value, { maxLength = 160 } = {}) => {
  const text = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!text) return '';
  if (!Number.isFinite(Number(maxLength)) || Number(maxLength) <= 0) return text;
  const limit = Math.floor(Number(maxLength));
  return text.length <= limit ? text : text.slice(0, limit);
};

export const classifyBenchProgressConfidence = (value) => {
  if (value == null || value === '') return 'unknown';
  const score = Number(value);
  if (!Number.isFinite(score)) return 'unknown';
  if (score >= BENCH_PROGRESS_CONFIDENCE_THRESHOLDS.high) return 'high';
  if (score >= BENCH_PROGRESS_CONFIDENCE_THRESHOLDS.medium) return 'medium';
  return 'low';
};

export const formatBenchProgressConfidence = (value) => {
  if (value == null || value === '') return 'unknown';
  const score = Number(value);
  if (!Number.isFinite(score)) return 'unknown';
  const bucket = classifyBenchProgressConfidence(score);
  return `${bucket} ${(Math.max(0, Math.min(1, score)) * 100).toFixed(1)}%`;
};

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const toSafeSampleCount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

const resolveComponentScore = (value) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return clamp01(parsed);
};

/**
 * Combine normalized UB-098 confidence components into one stable score.
 * Missing components are omitted from weighting so partial telemetry remains useful.
 */
export const computeBenchProgressConfidence = ({
  heartbeatRegularityScore,
  queueAgeScore,
  inFlightSpreadScore,
  stallEventsScore,
  heartbeatSamples = 0,
  queueSamples = 0,
  inFlightSamples = 0,
  stallSamples = 0
} = {}) => {
  const componentInputs = [
    {
      key: 'heartbeatRegularity',
      score: resolveComponentScore(heartbeatRegularityScore),
      weight: BENCH_PROGRESS_CONFIDENCE_COMPONENT_WEIGHTS.heartbeatRegularity,
      samples: toSafeSampleCount(heartbeatSamples)
    },
    {
      key: 'queueAge',
      score: resolveComponentScore(queueAgeScore),
      weight: BENCH_PROGRESS_CONFIDENCE_COMPONENT_WEIGHTS.queueAge,
      samples: toSafeSampleCount(queueSamples)
    },
    {
      key: 'inFlightSpread',
      score: resolveComponentScore(inFlightSpreadScore),
      weight: BENCH_PROGRESS_CONFIDENCE_COMPONENT_WEIGHTS.inFlightSpread,
      samples: toSafeSampleCount(inFlightSamples)
    },
    {
      key: 'stallEvents',
      score: resolveComponentScore(stallEventsScore),
      weight: BENCH_PROGRESS_CONFIDENCE_COMPONENT_WEIGHTS.stallEvents,
      samples: toSafeSampleCount(stallSamples)
    }
  ];

  let weightedSum = 0;
  let weightSum = 0;
  for (const entry of componentInputs) {
    if (!Number.isFinite(entry.score)) continue;
    weightedSum += entry.score * entry.weight;
    weightSum += entry.weight;
  }
  const score = weightSum > 0 ? clamp01(weightedSum / weightSum) : null;
  const bucket = classifyBenchProgressConfidence(score);
  return {
    schemaVersion: BENCH_PROGRESS_CONFIDENCE_SCHEMA_VERSION,
    score,
    bucket,
    text: formatBenchProgressConfidence(score),
    components: Object.fromEntries(
      componentInputs.map((entry) => [
        entry.key,
        {
          score: entry.score,
          weight: entry.weight,
          samples: entry.samples
        }
      ])
    ),
    samples: {
      heartbeat: toSafeSampleCount(heartbeatSamples),
      queueAge: toSafeSampleCount(queueSamples),
      inFlight: toSafeSampleCount(inFlightSamples),
      stallEvents: toSafeSampleCount(stallSamples)
    }
  };
};

export const buildBenchDiagnosticSignature = ({
  eventType,
  stage = '',
  taskId = '',
  source = '',
  message = '',
  providerId = '',
  workspacePartition = '',
  requestMethod = '',
  failureClass = '',
  preflightId = '',
  preflightClass = '',
  preflightState = '',
  reuseSurface = '',
  reuseSource = '',
  qualityImpact = ''
} = {}) => {
  const type = isBenchDiagnosticEventType(eventType) ? eventType : 'unknown';
  return [
    type,
    normalizeBenchDiagnosticText(stage, { maxLength: 64 }) || '-',
    normalizeBenchDiagnosticText(taskId, { maxLength: 96 }) || '-',
    normalizeBenchDiagnosticText(source, { maxLength: 48 }) || '-',
    normalizeDiagnosticField(providerId, 64) || '-',
    normalizeDiagnosticField(workspacePartition, 80) || '-',
    normalizeDiagnosticField(requestMethod, 80) || '-',
    normalizeDiagnosticField(failureClass, 80) || '-',
    normalizeDiagnosticField(preflightId, 96) || '-',
    normalizeDiagnosticField(preflightClass, 64) || '-',
    normalizeDiagnosticField(preflightState, 48) || '-',
    normalizeDiagnosticField(reuseSurface, 48) || '-',
    normalizeDiagnosticField(reuseSource, 48) || '-',
    normalizeDiagnosticField(qualityImpact, 48) || '-',
    normalizeBenchDiagnosticText(message, { maxLength: 200 }) || '-'
  ].join('|');
};

export const buildBenchDiagnosticEventId = ({ eventType, signature } = {}) => {
  const type = isBenchDiagnosticEventType(eventType) ? eventType : 'unknown';
  const normalizedSignature = normalizeBenchDiagnosticText(signature, { maxLength: 512 }) || '-';
  const digest = crypto
    .createHash('sha1')
    .update(`${type}|${normalizedSignature}`)
    .digest('hex')
    .slice(0, 12);
  return `ub050:v1:${type}:${digest}`;
};

export const buildBenchEnvironmentMetadata = (env = process.env) => {
  const selected = {};
  for (const key of ENV_METADATA_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(env, key)) continue;
    const value = env[key];
    if (value == null || value === '') continue;
    selected[key] = String(value);
  }
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    selected
  };
};

export const emitBenchLog = (onLog, message, level = 'info') => {
  if (typeof onLog === 'function') {
    onLog(message, level);
    return;
  }
  if (level === 'error') {
    logError(message);
    return;
  }
  if (level === 'warn') {
    log(`[warn] ${message}`);
    return;
  }
  log(message);
};
