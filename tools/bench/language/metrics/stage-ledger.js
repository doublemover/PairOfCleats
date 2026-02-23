import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getMetricsDir, loadUserConfig } from '../../../shared/dict-utils.js';

export const STAGE_TIMING_SCHEMA_VERSION = 1;
export const STAGE_TIMING_STAGE_KEYS = Object.freeze([
  'discovery',
  'importScan',
  'scmMeta',
  'parseChunk',
  'inference',
  'artifactWrite',
  'embedding',
  'sqliteBuild'
]);
export const STAGE_TIMING_BREAKDOWN_KEYS = Object.freeze([
  'parseChunk',
  'inference',
  'embedding'
]);
const INDEX_METRICS_MODES = Object.freeze(['code', 'prose', 'extracted-prose', 'records']);
const THROUGHPUT_MODE_KEY_BY_METRICS_MODE = Object.freeze({
  code: 'code',
  prose: 'prose',
  'extracted-prose': 'extractedProse',
  records: 'records'
});
const THROUGHPUT_LEDGER_STAGE_KEYS_INTERNAL = Object.freeze([
  'total',
  'discovery',
  'importScan',
  'scmMeta',
  'parseChunk',
  'inference',
  'artifactWrite',
  'embedding'
]);

export const THROUGHPUT_LEDGER_SCHEMA_VERSION = 1;
export const THROUGHPUT_LEDGER_MODALITY_KEYS = INDEX_METRICS_MODES;
export const THROUGHPUT_LEDGER_STAGE_KEYS = THROUGHPUT_LEDGER_STAGE_KEYS_INTERNAL;

const toSafeDurationMs = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const toSafeCount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
};

const toNullableNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const computeRatePerSec = (amount, durationMs) => {
  const value = toNullableNumber(amount);
  const duration = toNullableNumber(durationMs);
  if (!Number.isFinite(value) || !Number.isFinite(duration) || duration <= 0) return null;
  return value / (duration / 1000);
};

const resolveStageDurationsFromModeMetrics = (modeMetrics) => {
  const timings = modeMetrics?.timings || {};
  const stageTimingBreakdown = timings?.stageTimingBreakdown || {};
  return {
    total: toNullableNumber(timings.totalMs),
    discovery: toNullableNumber(timings.discoverMs),
    importScan: toNullableNumber(timings.importsMs),
    scmMeta: toNullableNumber(timings.scmMetaMs),
    parseChunk: toNullableNumber(stageTimingBreakdown?.parseChunk?.totalMs),
    inference: toNullableNumber(stageTimingBreakdown?.inference?.totalMs),
    artifactWrite: toNullableNumber(timings.writeMs),
    embedding: toNullableNumber(stageTimingBreakdown?.embedding?.totalMs)
  };
};

const resolveModeCountsForLedger = ({
  modeMetrics = null,
  throughputEntry = null,
  indexingEntry = null
} = {}) => {
  const files = toNullableNumber(throughputEntry?.files)
    ?? toNullableNumber(modeMetrics?.files?.candidates)
    ?? toNullableNumber(indexingEntry?.files);
  const chunks = toNullableNumber(throughputEntry?.chunks)
    ?? toNullableNumber(modeMetrics?.chunks?.total);
  const tokens = toNullableNumber(throughputEntry?.tokens)
    ?? toNullableNumber(modeMetrics?.tokens?.total);
  const bytes = toNullableNumber(throughputEntry?.bytes)
    ?? toNullableNumber(modeMetrics?.bytes?.total)
    ?? toNullableNumber(indexingEntry?.bytes);
  return { files, chunks, tokens, bytes };
};

const buildLedgerStageEntry = ({ counts, durationMs }) => {
  const duration = toNullableNumber(durationMs);
  return {
    durationMs: duration,
    files: toNullableNumber(counts?.files),
    chunks: toNullableNumber(counts?.chunks),
    tokens: toNullableNumber(counts?.tokens),
    bytes: toNullableNumber(counts?.bytes),
    filesPerSec: computeRatePerSec(counts?.files, duration),
    chunksPerSec: computeRatePerSec(counts?.chunks, duration),
    tokensPerSec: computeRatePerSec(counts?.tokens, duration),
    bytesPerSec: computeRatePerSec(counts?.bytes, duration)
  };
};

const hasLedgerStageValues = (stageEntry) => (
  Number.isFinite(stageEntry?.durationMs)
  || Number.isFinite(stageEntry?.chunks)
  || Number.isFinite(stageEntry?.tokens)
  || Number.isFinite(stageEntry?.bytes)
  || Number.isFinite(stageEntry?.files)
);

const buildThroughputLedgerSignature = ({ repoPath, summary, modalities }) => {
  const fingerprint = JSON.stringify({
    repoPath: repoPath || null,
    buildMs: summary?.buildMs || null,
    modalities: Object.fromEntries(
      Object.entries(modalities || {}).map(([modeKey, modeEntry]) => [
        modeKey,
        Object.fromEntries(
          Object.entries(modeEntry?.stages || {}).map(([stageKey, stageEntry]) => [
            stageKey,
            {
              durationMs: stageEntry?.durationMs ?? null,
              files: stageEntry?.files ?? null,
              chunks: stageEntry?.chunks ?? null,
              tokens: stageEntry?.tokens ?? null,
              bytes: stageEntry?.bytes ?? null
            }
          ])
        )
      ])
    )
  });
  const digest = crypto
    .createHash('sha1')
    .update(fingerprint)
    .digest('hex')
    .slice(0, 16);
  return `ub095:v1:${digest}`;
};

const createBucket = () => ({
  files: 0,
  totalMs: 0,
  bytes: 0,
  lines: 0
});

const mergeBucket = (target, source) => {
  const next = target && typeof target === 'object' ? target : createBucket();
  next.files = toSafeCount(next.files) + toSafeCount(source?.files);
  next.totalMs = toSafeDurationMs(next.totalMs) + toSafeDurationMs(source?.totalMs);
  next.bytes = toSafeCount(next.bytes) + toSafeCount(source?.bytes);
  next.lines = toSafeCount(next.lines) + toSafeCount(source?.lines);
  return next;
};

const mergeBucketMap = (target = {}, source = {}) => {
  const out = { ...target };
  if (!source || typeof source !== 'object') return out;
  for (const [key, value] of Object.entries(source)) {
    out[key] = mergeBucket(out[key], value);
  }
  return out;
};

const finalizeBucketMap = (input = {}) => (
  Object.fromEntries(
    Object.entries(input)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, value]) => {
        const files = toSafeCount(value?.files);
        const totalMs = toSafeDurationMs(value?.totalMs);
        const bytes = toSafeCount(value?.bytes);
        const lines = toSafeCount(value?.lines);
        return [key, {
          files,
          totalMs,
          avgMs: files > 0 ? totalMs / files : 0,
          bytes,
          lines
        }];
      })
  )
);

const createQueueDelaySummary = () => ({
  count: 0,
  totalMs: 0,
  minMs: 0,
  maxMs: 0,
  avgMs: 0
});

const createQueueDelayHistogram = () => ({
  bucketsMs: [],
  counts: [],
  overflow: 0
});

export const createEmptyStageTimingProfile = () => ({
  schemaVersion: STAGE_TIMING_SCHEMA_VERSION,
  stages: Object.fromEntries(STAGE_TIMING_STAGE_KEYS.map((key) => [key, 0])),
  breakdown: Object.fromEntries(
    STAGE_TIMING_BREAKDOWN_KEYS.map((key) => [
      key,
      {
        totalMs: 0,
        byLanguage: {},
        bySizeBin: {}
      }
    ])
  ),
  watchdog: {
    queueDelayMs: {
      summary: createQueueDelaySummary(),
      histogram: createQueueDelayHistogram()
    }
  }
});

const mergeHistogram = (target = createQueueDelayHistogram(), source = {}) => {
  const sourceBuckets = Array.isArray(source?.bucketsMs) ? source.bucketsMs.map(toSafeDurationMs) : [];
  const sourceCounts = Array.isArray(source?.counts) ? source.counts.map(toSafeCount) : [];
  if (!target.bucketsMs.length && sourceBuckets.length) {
    target.bucketsMs = sourceBuckets.slice();
    target.counts = new Array(sourceBuckets.length).fill(0);
  }
  const sameShape = target.bucketsMs.length === sourceBuckets.length
    && target.bucketsMs.every((value, index) => value === sourceBuckets[index]);
  if (sameShape) {
    for (let i = 0; i < target.counts.length; i += 1) {
      target.counts[i] = toSafeCount(target.counts[i]) + toSafeCount(sourceCounts[i]);
    }
    target.overflow = toSafeCount(target.overflow) + toSafeCount(source?.overflow);
  }
  return target;
};

const mergeQueueDelay = (target = createQueueDelaySummary(), source = {}) => {
  const targetCount = toSafeCount(target.count);
  const sourceCount = toSafeCount(source?.count);
  const sourceTotalMs = toSafeDurationMs(source?.totalMs);
  const sourceMinMs = toSafeDurationMs(source?.minMs);
  const sourceMaxMs = toSafeDurationMs(source?.maxMs);
  const nextCount = targetCount + sourceCount;
  const nextTotalMs = toSafeDurationMs(target.totalMs) + sourceTotalMs;
  let nextMinMs = 0;
  if (targetCount > 0 && sourceCount > 0) {
    nextMinMs = Math.min(toSafeDurationMs(target.minMs), sourceMinMs);
  } else if (targetCount > 0) {
    nextMinMs = toSafeDurationMs(target.minMs);
  } else if (sourceCount > 0) {
    nextMinMs = sourceMinMs;
  }
  const nextMaxMs = Math.max(toSafeDurationMs(target.maxMs), sourceMaxMs);
  return {
    count: nextCount,
    totalMs: nextTotalMs,
    minMs: Number.isFinite(nextMinMs) ? nextMinMs : 0,
    maxMs: nextMaxMs,
    avgMs: nextCount > 0 ? nextTotalMs / nextCount : 0
  };
};

export const mergeStageTimingProfile = (target, source) => {
  const next = target || createEmptyStageTimingProfile();
  if (!source || typeof source !== 'object') return next;
  for (const stageKey of STAGE_TIMING_STAGE_KEYS) {
    next.stages[stageKey] = toSafeDurationMs(next.stages[stageKey]) + toSafeDurationMs(source?.stages?.[stageKey]);
  }
  for (const sectionKey of STAGE_TIMING_BREAKDOWN_KEYS) {
    const sourceSection = source?.breakdown?.[sectionKey];
    if (!sourceSection || typeof sourceSection !== 'object') continue;
    const targetSection = next.breakdown[sectionKey] || {
      totalMs: 0,
      byLanguage: {},
      bySizeBin: {}
    };
    targetSection.totalMs = toSafeDurationMs(targetSection.totalMs) + toSafeDurationMs(sourceSection.totalMs);
    targetSection.byLanguage = mergeBucketMap(targetSection.byLanguage, sourceSection.byLanguage);
    targetSection.bySizeBin = mergeBucketMap(targetSection.bySizeBin, sourceSection.bySizeBin);
    next.breakdown[sectionKey] = targetSection;
  }
  const sourceQueueDelay = source?.watchdog?.queueDelayMs || {};
  const targetQueueDelay = next?.watchdog?.queueDelayMs || {
    summary: createQueueDelaySummary(),
    histogram: createQueueDelayHistogram()
  };
  targetQueueDelay.summary = mergeQueueDelay(targetQueueDelay.summary, sourceQueueDelay.summary);
  targetQueueDelay.histogram = mergeHistogram(targetQueueDelay.histogram, sourceQueueDelay.histogram);
  next.watchdog.queueDelayMs = targetQueueDelay;
  return next;
};

export const finalizeStageTimingProfile = (profile) => {
  const source = profile && typeof profile === 'object'
    ? profile
    : createEmptyStageTimingProfile();
  const stages = {};
  for (const stageKey of STAGE_TIMING_STAGE_KEYS) {
    stages[stageKey] = toSafeDurationMs(source?.stages?.[stageKey]);
  }
  const breakdown = {};
  for (const sectionKey of STAGE_TIMING_BREAKDOWN_KEYS) {
    const section = source?.breakdown?.[sectionKey] || {};
    breakdown[sectionKey] = {
      totalMs: toSafeDurationMs(section.totalMs),
      byLanguage: finalizeBucketMap(section.byLanguage),
      bySizeBin: finalizeBucketMap(section.bySizeBin)
    };
  }
  const queueDelaySource = source?.watchdog?.queueDelayMs || {};
  const queueSummary = mergeQueueDelay(createQueueDelaySummary(), queueDelaySource.summary);
  const queueHistogram = mergeHistogram(createQueueDelayHistogram(), queueDelaySource.histogram);
  const stageTotalMs = STAGE_TIMING_STAGE_KEYS
    .reduce((sum, stageKey) => sum + toSafeDurationMs(stages[stageKey]), 0);
  return {
    schemaVersion: STAGE_TIMING_SCHEMA_VERSION,
    stages,
    stageTotalMs,
    breakdown,
    watchdog: {
      queueDelayMs: {
        summary: queueSummary,
        histogram: queueHistogram
      }
    }
  };
};

const extractTimingBreakdown = (timings = {}) => {
  const fallbackBreakdown = timings?.stageTimingBreakdown && typeof timings.stageTimingBreakdown === 'object'
    ? timings.stageTimingBreakdown
    : {};
  const out = createEmptyStageTimingProfile();
  out.stages.discovery = toSafeDurationMs(timings.discoverMs);
  out.stages.importScan = toSafeDurationMs(timings.importsMs);
  out.stages.scmMeta = toSafeDurationMs(timings.scmMetaMs);
  out.stages.artifactWrite = toSafeDurationMs(timings.writeMs);
  for (const sectionKey of STAGE_TIMING_BREAKDOWN_KEYS) {
    const section = fallbackBreakdown?.[sectionKey];
    if (!section || typeof section !== 'object') continue;
    out.stages[sectionKey] = toSafeDurationMs(section.totalMs);
    out.breakdown[sectionKey].totalMs = toSafeDurationMs(section.totalMs);
    out.breakdown[sectionKey].byLanguage = mergeBucketMap(
      out.breakdown[sectionKey].byLanguage,
      section.byLanguage
    );
    out.breakdown[sectionKey].bySizeBin = mergeBucketMap(
      out.breakdown[sectionKey].bySizeBin,
      section.bySizeBin
    );
  }
  const queueDelaySource = fallbackBreakdown?.watchdog?.queueDelayMs || timings?.watchdog?.queueDelayMs || {};
  out.watchdog.queueDelayMs.summary = mergeQueueDelay(
    out.watchdog.queueDelayMs.summary,
    queueDelaySource.summary
  );
  out.watchdog.queueDelayMs.histogram = mergeHistogram(
    out.watchdog.queueDelayMs.histogram,
    queueDelaySource.histogram
  );
  return out;
};

const readJsonFileSync = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const loadRepoIndexMetrics = (repoPath) => {
  try {
    const userConfig = loadUserConfig(repoPath);
    const metricsDir = getMetricsDir(repoPath, userConfig);
    const metricsByMode = {};
    for (const mode of INDEX_METRICS_MODES) {
      const metricsPath = path.join(metricsDir, `index-${mode}.json`);
      const payload = readJsonFileSync(metricsPath);
      if (payload) metricsByMode[mode] = payload;
    }
    return metricsByMode;
  } catch {
    return {};
  }
};

export const buildStageTimingProfileForTask = ({ repoPath, summary }) => {
  const profile = createEmptyStageTimingProfile();
  if (repoPath) {
    const metricsByMode = loadRepoIndexMetrics(repoPath);
    for (const metrics of Object.values(metricsByMode)) {
      mergeStageTimingProfile(profile, extractTimingBreakdown(metrics?.timings));
    }
  }
  profile.stages.sqliteBuild += toSafeDurationMs(summary?.buildMs?.sqlite);
  profile.stages.embedding += toSafeDurationMs(summary?.buildMs?.embedding);
  return finalizeStageTimingProfile(profile);
};

export const isValidThroughputLedger = (ledger) => {
  if (!ledger || typeof ledger !== 'object') return false;
  if (ledger.schemaVersion !== THROUGHPUT_LEDGER_SCHEMA_VERSION) return false;
  const modalities = ledger.modalities;
  if (!modalities || typeof modalities !== 'object') return false;
  return Object.keys(modalities).length > 0;
};

export const buildThroughputLedgerForTask = ({
  repoPath = null,
  summary = null,
  throughput = null,
  indexingSummary = null,
  metricsByMode = null
} = {}) => {
  const resolvedMetricsByMode = metricsByMode && typeof metricsByMode === 'object'
    ? metricsByMode
    : (repoPath ? loadRepoIndexMetrics(repoPath) : {});
  const modalities = {};
  const stageCoverage = Object.fromEntries(THROUGHPUT_LEDGER_STAGE_KEYS_INTERNAL.map((stage) => [stage, 0]));

  for (const modeKey of INDEX_METRICS_MODES) {
    const throughputKey = THROUGHPUT_MODE_KEY_BY_METRICS_MODE[modeKey];
    const modeMetrics = resolvedMetricsByMode?.[modeKey] || null;
    const throughputEntry = throughput?.[throughputKey] || null;
    const indexingEntry = indexingSummary?.modes?.[modeKey] || null;
    const counts = resolveModeCountsForLedger({
      modeMetrics,
      throughputEntry,
      indexingEntry
    });
    const stageDurations = resolveStageDurationsFromModeMetrics(modeMetrics);
    const stages = {};
    let hasAnyStageValues = false;

    for (const stageKey of THROUGHPUT_LEDGER_STAGE_KEYS_INTERNAL) {
      const fallbackDuration = stageKey === 'total'
        ? (toNullableNumber(throughputEntry?.totalMs) ?? toNullableNumber(indexingEntry?.durationMs))
        : null;
      // Only `total` currently has trustworthy aggregate counters. Avoid
      // emitting misleading per-stage throughput derived from global counts.
      const stageCounts = stageKey === 'total' ? counts : null;
      const stageEntry = buildLedgerStageEntry({
        counts: stageCounts,
        durationMs: stageDurations[stageKey] ?? fallbackDuration
      });
      if (hasLedgerStageValues(stageEntry)) {
        hasAnyStageValues = true;
        stageCoverage[stageKey] += 1;
      }
      stages[stageKey] = stageEntry;
    }

    if (!hasAnyStageValues) continue;
    modalities[modeKey] = {
      mode: modeKey,
      throughputKey,
      stages
    };
  }

  if (!Object.keys(modalities).length) return null;
  return {
    schemaVersion: THROUGHPUT_LEDGER_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    runSignature: buildThroughputLedgerSignature({ repoPath, summary, modalities }),
    modalities,
    stageCoverage
  };
};
