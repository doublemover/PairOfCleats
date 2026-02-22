import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { buildGeneratedPolicyConfig } from '../../../src/index/build/generated-policy.js';
import { tokenizeComments } from '../../../src/index/build/file-processor/cpu/tokenizer.js';
import { discoverFilesForModes } from '../../../src/index/build/discover.js';
import { extractDocx } from '../../../src/index/extractors/docx.js';
import { extractPdf } from '../../../src/index/extractors/pdf.js';
import { normalizeDocumentExtractionPolicy, normalizeExtractedText } from '../../../src/index/extractors/common.js';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { extractComments, normalizeCommentConfig } from '../../../src/index/comments.js';
import { detectFrontmatter } from '../../../src/index/segments.js';
import { runWithConcurrency } from '../../../src/shared/concurrency.js';
import { readTextFile } from '../../../src/shared/encoding.js';
import { buildLineIndex, offsetToLine } from '../../../src/shared/lines.js';
import { countLinesForEntries } from '../../../src/shared/file-stats.js';
import { formatDurationMs } from '../../../src/shared/time-format.js';
import { getMetricsDir, getTriageConfig, loadUserConfig } from '../../shared/dict-utils.js';
import { emitBenchLog } from './logging.js';

export const formatDuration = (ms) => formatDurationMs(ms);

export const formatGb = (mb) => `${(mb / 1024).toFixed(1)} GB`;

export const formatLoc = (value) => {
  if (!Number.isFinite(value)) return 'n/a';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${Math.floor(value)}`;
};

export const stripMaxOldSpaceFlag = (options) => {
  if (!options) return '';
  return options
    .replace(/--max-old-space-size=\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

export const getRecommendedHeapMb = () => {
  const totalMb = Math.floor(os.totalmem() / (1024 * 1024));
  const recommended = Math.max(4096, Math.floor(totalMb * 0.75));
  const rounded = Math.floor(recommended / 256) * 256;
  return {
    totalMb,
    recommendedMb: Math.max(4096, rounded)
  };
};

export const formatMetricSummary = (summary) => {
  if (!summary) return 'Metrics: pending';
  const backends = summary.backends || Object.keys(summary.latencyMsAvg || {});
  const parts = [];
  for (const backend of backends) {
    const latency = summary.latencyMsAvg?.[backend];
    const hitRate = summary.hitRate?.[backend];
    const latencyText = Number.isFinite(latency) ? `${latency.toFixed(1)}ms` : 'n/a';
    const hitText = Number.isFinite(hitRate) ? `${(hitRate * 100).toFixed(1)}%` : 'n/a';
    parts.push(`${backend} ${latencyText} hit ${hitText}`);
  }
  if (summary.embeddingProvider) {
    parts.push(`embed ${summary.embeddingProvider}`);
  }
  return parts.length ? `Metrics: ${parts.join(' | ')}` : 'Metrics: pending';
};

const toFiniteRate = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed));
};

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const getBestHitRate = (summary) => {
  if (!summary || typeof summary !== 'object') return null;
  const candidates = Object.values(summary.hitRate || {})
    .map(toFiniteRate)
    .filter(Number.isFinite);
  if (!candidates.length) return null;
  return Math.max(...candidates);
};

export const computeLowHitSeverity = ({
  summary,
  lowHitThreshold = 0.82
} = {}) => {
  const bestHitRate = getBestHitRate(summary);
  const resultCountAvg = Object.values(summary?.resultCountAvg || {})
    .map(toFiniteNumber)
    .filter(Number.isFinite);
  const avgResultCount = resultCountAvg.length
    ? resultCountAvg.reduce((sum, value) => sum + value, 0) / resultCountAvg.length
    : null;
  const queryWallMsPerSearch = toFiniteNumber(summary?.queryWallMsPerSearch);
  const queryWallMsPerQuery = toFiniteNumber(summary?.queryWallMsPerQuery);
  const hitGap = Number.isFinite(bestHitRate)
    ? Math.max(0, lowHitThreshold - bestHitRate)
    : null;
  const scarcityPressure = Number.isFinite(avgResultCount)
    ? Math.max(0, 1.5 - avgResultCount) / 1.5
    : 0;
  const latencyPressure = Number.isFinite(queryWallMsPerSearch)
    ? Math.max(0, queryWallMsPerSearch - 120) / 480
    : 0;
  const severityScore = Number.isFinite(hitGap)
    ? Math.max(0, Math.min(1, (hitGap / Math.max(0.01, lowHitThreshold)) + (0.2 * scarcityPressure) + (0.1 * latencyPressure)))
    : null;
  return {
    lowHitThreshold,
    bestHitRate,
    hitGap,
    avgResultCount,
    queryWallMsPerSearch,
    queryWallMsPerQuery,
    scarcityPressure,
    latencyPressure,
    severityScore
  };
};

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
export const THROUGHPUT_LEDGER_DIFF_SCHEMA_VERSION = 1;
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
      const stageEntry = buildLedgerStageEntry({
        counts,
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

const meanNumeric = (values) => {
  const numeric = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter(Number.isFinite);
  if (!numeric.length) return null;
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
};

export const computeThroughputLedgerRegression = ({
  currentLedger = null,
  baselineLedgers = [],
  metric = 'chunksPerSec',
  regressionThresholdPct = -0.08
} = {}) => {
  if (!isValidThroughputLedger(currentLedger)) return null;
  const baselineEntries = (Array.isArray(baselineLedgers) ? baselineLedgers : [])
    .filter((entry) => isValidThroughputLedger(entry));
  if (!baselineEntries.length) {
    return {
      schemaVersion: THROUGHPUT_LEDGER_DIFF_SCHEMA_VERSION,
      metric,
      baselineCount: 0,
      comparedEntries: 0,
      regressionThresholdPct,
      regressions: [],
      improvements: []
    };
  }

  const baselineMap = new Map();
  for (const baseline of baselineEntries) {
    for (const [modeKey, modeEntry] of Object.entries(baseline.modalities || {})) {
      for (const [stageKey, stageEntry] of Object.entries(modeEntry?.stages || {})) {
        const rate = Number(stageEntry?.[metric]);
        if (!Number.isFinite(rate) || rate <= 0) continue;
        const key = `${modeKey}:${stageKey}`;
        if (!baselineMap.has(key)) baselineMap.set(key, []);
        baselineMap.get(key).push(rate);
      }
    }
  }

  const regressions = [];
  const improvements = [];
  let comparedEntries = 0;
  const threshold = Number(regressionThresholdPct);
  const resolvedThreshold = Number.isFinite(threshold) ? threshold : -0.08;

  for (const [modeKey, modeEntry] of Object.entries(currentLedger.modalities || {})) {
    for (const [stageKey, stageEntry] of Object.entries(modeEntry?.stages || {})) {
      const currentRate = Number(stageEntry?.[metric]);
      if (!Number.isFinite(currentRate) || currentRate <= 0) continue;
      const key = `${modeKey}:${stageKey}`;
      const baselineRates = baselineMap.get(key) || [];
      const baselineRate = meanNumeric(baselineRates);
      if (!Number.isFinite(baselineRate) || baselineRate <= 0) continue;
      const deltaRate = currentRate - baselineRate;
      const deltaPct = deltaRate / baselineRate;
      comparedEntries += 1;
      const row = {
        modality: modeKey,
        stage: stageKey,
        metric,
        currentRate,
        baselineRate,
        deltaRate,
        deltaPct,
        baselineSamples: baselineRates.length
      };
      if (deltaPct <= resolvedThreshold) {
        regressions.push(row);
      } else if (deltaPct >= Math.abs(resolvedThreshold)) {
        improvements.push(row);
      }
    }
  }

  regressions.sort((left, right) => (
    Number(left.deltaPct) - Number(right.deltaPct)
  ) || left.modality.localeCompare(right.modality) || left.stage.localeCompare(right.stage));
  improvements.sort((left, right) => (
    Number(right.deltaPct) - Number(left.deltaPct)
  ) || left.modality.localeCompare(right.modality) || left.stage.localeCompare(right.stage));

  return {
    schemaVersion: THROUGHPUT_LEDGER_DIFF_SCHEMA_VERSION,
    metric,
    baselineCount: baselineEntries.length,
    comparedEntries,
    regressionThresholdPct: resolvedThreshold,
    regressions,
    improvements
  };
};

const resolveMaxFileBytes = (userConfig) => {
  const raw = userConfig?.indexing?.maxFileBytes;
  const parsed = Number(raw);
  if (raw === false || raw === 0) return null;
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return 5 * 1024 * 1024;
};

const DOCUMENT_EXTS = new Set(['.pdf', '.docx']);
const EMPTY_TOKEN_DICT = new Set();

const countTextLines = (text) => {
  if (!text) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return count;
};

const buildPdfExtractionText = (pages) => {
  const parts = [];
  for (const page of pages || []) {
    const text = normalizeExtractedText(page?.text || '');
    if (!text) continue;
    parts.push(text);
  }
  return parts.join('\n\n');
};

const buildDocxExtractionText = (paragraphs) => {
  const parts = [];
  for (const paragraph of paragraphs || []) {
    const text = normalizeExtractedText(paragraph?.text || '');
    if (!text) continue;
    parts.push(text);
  }
  return parts.join('\n\n');
};

/**
 * Convert extra-segment offset spans into a de-duplicated line count.
 * Overlaps (for example comment + embedded config segments on the same lines)
 * are merged so extracted LOC reflects unique indexed lines.
 *
 * @param {{segments:Array<object>, lineIndex:number[], textLength:number}} input
 * @returns {number}
 */
const countUniqueSegmentLines = ({ segments, lineIndex, textLength }) => {
  if (!Array.isArray(segments) || segments.length === 0 || !textLength) return 0;
  const maxOffset = Math.max(0, textLength - 1);
  const ranges = [];
  for (const segment of segments) {
    const rawStart = Number(segment?.start);
    const rawEnd = Number(segment?.end);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) continue;
    const start = Math.max(0, Math.min(maxOffset, Math.floor(rawStart)));
    const endExclusive = Math.max(start + 1, Math.min(textLength, Math.floor(rawEnd)));
    const startLine = offsetToLine(lineIndex, start);
    const endLine = offsetToLine(lineIndex, Math.max(start, endExclusive - 1));
    if (!Number.isFinite(startLine) || !Number.isFinite(endLine) || endLine < startLine) continue;
    ranges.push([startLine, endLine]);
  }
  if (!ranges.length) return 0;
  ranges.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  let total = 0;
  let currentStart = ranges[0][0];
  let currentEnd = ranges[0][1];
  for (let i = 1; i < ranges.length; i += 1) {
    const [nextStart, nextEnd] = ranges[i];
    if (nextStart <= currentEnd + 1) {
      currentEnd = Math.max(currentEnd, nextEnd);
      continue;
    }
    total += currentEnd - currentStart + 1;
    currentStart = nextStart;
    currentEnd = nextEnd;
  }
  total += currentEnd - currentStart + 1;
  return total;
};

const collectExtractedProseSegmentsForText = ({ text, ext, rel, normalizedCommentsConfig }) => {
  const lineIndex = buildLineIndex(text);
  const languageId = getLanguageForFile(ext, rel)?.id || null;
  const commentData = normalizedCommentsConfig.extract !== 'off'
    ? extractComments({
      text,
      ext,
      languageId,
      lineIndex,
      config: normalizedCommentsConfig
    })
    : { comments: [], configSegments: [] };
  const { commentSegments } = tokenizeComments({
    comments: commentData.comments,
    ext,
    tokenDictWords: EMPTY_TOKEN_DICT,
    dictConfig: null,
    normalizedCommentsConfig,
    languageId,
    commentSegmentsEnabled: true
  });
  const segments = [];
  if (Array.isArray(commentSegments) && commentSegments.length) {
    segments.push(...commentSegments);
  }
  if (Array.isArray(commentData.configSegments) && commentData.configSegments.length) {
    segments.push(...commentData.configSegments);
  }
  if (ext === '.md' || ext === '.mdx') {
    const frontmatter = detectFrontmatter(text);
    if (frontmatter) {
      segments.push({
        type: 'prose',
        languageId: 'markdown',
        start: frontmatter.start,
        end: frontmatter.end,
        parentSegmentId: null,
        embeddingContext: 'prose',
        meta: { frontmatter: true }
      });
    }
  }
  return { lineIndex, segments };
};

const countExtractedDocumentLines = async ({ entry, documentExtractionPolicy }) => {
  const extracted = entry.ext === '.pdf'
    ? await extractPdf({ filePath: entry.abs, policy: documentExtractionPolicy })
    : await extractDocx({ filePath: entry.abs, policy: documentExtractionPolicy });
  if (!extracted?.ok) return 0;
  const extractedText = entry.ext === '.pdf'
    ? buildPdfExtractionText(extracted.pages)
    : buildDocxExtractionText(extracted.paragraphs);
  return countTextLines(extractedText);
};

const countExtractedProseLinesForEntry = async ({
  entry,
  normalizedCommentsConfig,
  documentExtractionEnabled,
  documentExtractionPolicy
}) => {
  if (documentExtractionEnabled && DOCUMENT_EXTS.has(entry.ext)) {
    try {
      return await countExtractedDocumentLines({ entry, documentExtractionPolicy });
    } catch {
      return 0;
    }
  }
  let text = '';
  try {
    ({ text } = await readTextFile(entry.abs));
  } catch {
    return 0;
  }
  if (!text) return 0;
  const { lineIndex, segments } = collectExtractedProseSegmentsForText({
    text,
    ext: entry.ext,
    rel: entry.rel,
    normalizedCommentsConfig
  });
  return countUniqueSegmentLines({
    segments,
    lineIndex,
    textLength: text.length
  });
};

/**
 * Count extracted-prose lines by simulating the same extras-only segment path
 * used by indexing in `extracted-prose` mode.
 *
 * @param {Array<{abs:string,rel:string,ext:string}>} entries
 * @param {{concurrency:number, normalizedCommentsConfig:object, documentExtractionConfig:object|null}} options
 * @returns {Promise<Map<string, number>>}
 */
const countExtractedProseLinesForEntries = async (entries, {
  concurrency,
  normalizedCommentsConfig,
  documentExtractionConfig
}) => {
  const lineCounts = new Map();
  if (!Array.isArray(entries) || entries.length === 0) return lineCounts;
  const documentExtractionEnabled = documentExtractionConfig?.enabled === true;
  const documentExtractionPolicy = normalizeDocumentExtractionPolicy(documentExtractionConfig);
  await runWithConcurrency(
    entries,
    concurrency,
    async (entry) => {
      const rel = String(entry.rel || entry.abs || '').replace(/\\/g, '/');
      if (!rel) return;
      const lines = await countExtractedProseLinesForEntry({
        entry,
        normalizedCommentsConfig,
        documentExtractionEnabled,
        documentExtractionPolicy
      });
      lineCounts.set(rel, lines);
    },
    { collectResults: false }
  );
  return lineCounts;
};

export const buildLineStats = async (repoPath, userConfig) => {
  const modes = ['code', 'prose', 'extracted-prose', 'records'];
  const indexingConfig = userConfig?.indexing && typeof userConfig.indexing === 'object'
    ? userConfig.indexing
    : {};
  const generatedPolicy = buildGeneratedPolicyConfig(indexingConfig);
  const { ignoreMatcher } = await buildIgnoreMatcher({ root: repoPath, userConfig, generatedPolicy });
  const skippedByMode = { code: [], prose: [], 'extracted-prose': [], records: [] };
  const maxFileBytes = resolveMaxFileBytes(userConfig);
  const normalizedCommentsConfig = normalizeCommentConfig(indexingConfig.comments || {});
  const documentExtractionConfig = indexingConfig.documentExtraction || null;
  const triageConfig = getTriageConfig(repoPath, userConfig);
  const recordsConfig = userConfig.records || null;
  const entriesByMode = await discoverFilesForModes({
    root: repoPath,
    modes,
    documentExtractionConfig,
    recordsDir: triageConfig.recordsDir,
    recordsConfig,
    ignoreMatcher,
    generatedPolicy,
    skippedByMode,
    maxFileBytes
  });
  const linesByFile = {
    code: new Map(),
    prose: new Map(),
    'extracted-prose': new Map(),
    records: new Map()
  };
  const totals = { code: 0, prose: 0, 'extracted-prose': 0, records: 0 };
  const concurrency = Math.max(1, Math.min(32, os.cpus().length * 2));
  for (const mode of modes) {
    const entries = entriesByMode[mode] || [];
    if (!entries.length) continue;
    const lineCounts = mode === 'extracted-prose'
      ? await countExtractedProseLinesForEntries(entries, {
        concurrency,
        normalizedCommentsConfig,
        documentExtractionConfig
      })
      : await countLinesForEntries(entries, { concurrency });
    for (const [rel, lines] of lineCounts) {
      linesByFile[mode].set(rel, lines);
      totals[mode] += lines;
    }
  }
  return { totals, linesByFile };
};

export const validateEncodingFixtures = async (scriptRoot, { onLog = null } = {}) => {
  const warn = (message) => emitBenchLog(onLog, message, 'warn');
  const fixturePath = path.join(scriptRoot, 'tests', 'fixtures', 'encoding', 'latin1.js');
  if (!fs.existsSync(fixturePath)) return;
  try {
    const { text, usedFallback } = await readTextFile(fixturePath);
    const expected = 'caf\u00e9';
    if (!text.includes(expected) || !usedFallback) {
      warn(`[bench] Encoding fixture did not decode as expected: ${fixturePath}`);
    }
  } catch (err) {
    warn(`[bench] Encoding fixture read failed: ${err?.message || err}`);
  }
};
