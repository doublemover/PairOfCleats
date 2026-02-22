import crypto from 'node:crypto';
import { log, logError } from '../../../src/shared/progress.js';

const ENV_METADATA_KEYS = Object.freeze([
  'NODE_OPTIONS',
  'PAIROFCLEATS_TESTING',
  'PAIROFCLEATS_TEST_CONFIG',
  'PAIROFCLEATS_CACHE_ROOT',
  'PAIROFCLEATS_CRASH_LOG_ANNOUNCE'
]);

export const BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION = 1;
export const BENCH_DIAGNOSTIC_EVENT_TYPES = Object.freeze([
  'parser_crash',
  'scm_timeout',
  'queue_delay_hotspot',
  'artifact_tail_stall',
  'fallback_used'
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
  const score = Number(value);
  if (!Number.isFinite(score)) return 'unknown';
  if (score >= BENCH_PROGRESS_CONFIDENCE_THRESHOLDS.high) return 'high';
  if (score >= BENCH_PROGRESS_CONFIDENCE_THRESHOLDS.medium) return 'medium';
  return 'low';
};

export const formatBenchProgressConfidence = (value) => {
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
  message = ''
} = {}) => {
  const type = isBenchDiagnosticEventType(eventType) ? eventType : 'unknown';
  return [
    type,
    normalizeBenchDiagnosticText(stage, { maxLength: 64 }) || '-',
    normalizeBenchDiagnosticText(taskId, { maxLength: 96 }) || '-',
    normalizeBenchDiagnosticText(source, { maxLength: 48 }) || '-',
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
