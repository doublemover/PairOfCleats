import { compareStrings } from '../../../../../shared/sort.js';
import { buildExtractedProseLowYieldBailoutSummary } from './extracted-prose.js';
import {
  buildWatchdogNearThresholdSummary,
  createDurationHistogram,
  isNearThresholdSlowFileDuration,
  resolveStageTimingSizeBin
} from './watchdog.js';
import {
  FILE_QUEUE_DELAY_HISTOGRAM_BUCKETS_MS,
  STAGE_TIMING_SCHEMA_VERSION,
  clampDurationMs
} from './watchdog-policy.js';

const createStageTimingSection = () => ({
  totalMs: 0,
  byLanguage: new Map(),
  bySizeBin: new Map()
});

const updateTimingBucket = (bucketMap, key, { durationMs = 0, files = 1, bytes = 0, lines = 0 } = {}) => {
  const bucketKey = key || 'unknown';
  const entry = bucketMap.get(bucketKey) || {
    files: 0,
    totalMs: 0,
    bytes: 0,
    lines: 0
  };
  entry.files += Math.max(0, Math.floor(Number(files) || 0));
  entry.totalMs += clampDurationMs(durationMs);
  entry.bytes += Math.max(0, Math.floor(Number(bytes) || 0));
  entry.lines += Math.max(0, Math.floor(Number(lines) || 0));
  bucketMap.set(bucketKey, entry);
};

const finalizeBreakdownBucket = (bucketMap) => (
  Object.fromEntries(
    Array.from(bucketMap.entries())
      .sort((a, b) => compareStrings(a[0], b[0]))
      .map(([key, value]) => {
        const totalMs = clampDurationMs(value?.totalMs);
        const files = Math.max(0, Math.floor(Number(value?.files) || 0));
        const bytes = Math.max(0, Math.floor(Number(value?.bytes) || 0));
        const lines = Math.max(0, Math.floor(Number(value?.lines) || 0));
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

/**
 * Build stage1 timing/watchdog aggregation helpers.
 *
 * @param {{
 *   runtime?:object,
 *   stageFileWatchdogConfig?:object,
 *   extractedProseLowYieldBailout?:object
 * }} [input]
 * @returns {{
 *   queueDelaySummary:{count:number,totalMs:number,minMs:number|null,maxMs:number},
 *   queueDelayTelemetryChannel:string,
 *   recordStageTimingSample:(section:string,input?:{languageId?:string|null,bytes?:number,lines?:number,durationMs?:number})=>void,
 *   observeQueueDelay:(durationMs:number)=>void,
 *   observeWatchdogNearThreshold:(input?:{activeDurationMs?:number,thresholdMs?:number,triggeredSlowWarning?:boolean,lowerFraction?:number,upperFraction?:number})=>void,
 *   buildStageTimingBreakdownPayload:()=>object
 * }}
 */
export const createStage1TimingAggregator = ({
  runtime = null,
  stageFileWatchdogConfig = null,
  extractedProseLowYieldBailout = null
} = {}) => {
  const stageTimingBreakdown = {
    parseChunk: createStageTimingSection(),
    inference: createStageTimingSection(),
    embedding: createStageTimingSection()
  };
  const queueDelayHistogram = createDurationHistogram(FILE_QUEUE_DELAY_HISTOGRAM_BUCKETS_MS);
  const queueDelaySummary = { count: 0, totalMs: 0, minMs: null, maxMs: 0 };
  const watchdogNearThreshold = {
    sampleCount: 0,
    nearThresholdCount: 0,
    slowWarningCount: 0,
    thresholdTotalMs: 0,
    activeTotalMs: 0
  };
  const queueDelayTelemetryChannel = 'stage1.file-queue-delay';
  runtime?.telemetry?.clearDurationHistogram?.(queueDelayTelemetryChannel);

  const recordStageTimingSample = (section, {
    languageId = null,
    bytes = 0,
    lines = 0,
    durationMs = 0
  } = {}) => {
    const sectionBucket = stageTimingBreakdown[section];
    if (!sectionBucket) return;
    const safeDurationMs = clampDurationMs(durationMs);
    if (safeDurationMs <= 0) return;
    const safeBytes = Math.max(0, Math.floor(Number(bytes) || 0));
    const safeLines = Math.max(0, Math.floor(Number(lines) || 0));
    const normalizedLanguage = languageId || 'unknown';
    const sizeBin = resolveStageTimingSizeBin(safeBytes);
    sectionBucket.totalMs += safeDurationMs;
    updateTimingBucket(sectionBucket.byLanguage, normalizedLanguage, {
      durationMs: safeDurationMs,
      files: 1,
      bytes: safeBytes,
      lines: safeLines
    });
    updateTimingBucket(sectionBucket.bySizeBin, sizeBin, {
      durationMs: safeDurationMs,
      files: 1,
      bytes: safeBytes,
      lines: safeLines
    });
  };

  const observeQueueDelay = (durationMs) => {
    const safeDurationMs = clampDurationMs(durationMs);
    queueDelaySummary.count += 1;
    queueDelaySummary.totalMs += safeDurationMs;
    queueDelaySummary.minMs = queueDelaySummary.minMs == null
      ? safeDurationMs
      : Math.min(queueDelaySummary.minMs, safeDurationMs);
    queueDelaySummary.maxMs = Math.max(queueDelaySummary.maxMs, safeDurationMs);
    queueDelayHistogram.observe(safeDurationMs);
    runtime?.telemetry?.recordDuration?.(queueDelayTelemetryChannel, safeDurationMs);
  };

  const observeWatchdogNearThreshold = ({
    activeDurationMs = 0,
    thresholdMs = 0,
    triggeredSlowWarning = false,
    lowerFraction = stageFileWatchdogConfig?.nearThresholdLowerFraction,
    upperFraction = stageFileWatchdogConfig?.nearThresholdUpperFraction
  } = {}) => {
    const threshold = Number(thresholdMs);
    if (!Number.isFinite(threshold) || threshold <= 0) return;
    const activeMs = clampDurationMs(activeDurationMs);
    watchdogNearThreshold.sampleCount += 1;
    watchdogNearThreshold.thresholdTotalMs += threshold;
    watchdogNearThreshold.activeTotalMs += activeMs;
    if (triggeredSlowWarning) {
      watchdogNearThreshold.slowWarningCount += 1;
      return;
    }
    if (isNearThresholdSlowFileDuration({
      activeDurationMs: activeMs,
      thresholdMs: threshold,
      lowerFraction,
      upperFraction
    })) {
      watchdogNearThreshold.nearThresholdCount += 1;
    }
  };

  const buildStageTimingBreakdownPayload = () => ({
    schemaVersion: STAGE_TIMING_SCHEMA_VERSION,
    parseChunk: {
      totalMs: clampDurationMs(stageTimingBreakdown.parseChunk.totalMs),
      byLanguage: finalizeBreakdownBucket(stageTimingBreakdown.parseChunk.byLanguage),
      bySizeBin: finalizeBreakdownBucket(stageTimingBreakdown.parseChunk.bySizeBin)
    },
    inference: {
      totalMs: clampDurationMs(stageTimingBreakdown.inference.totalMs),
      byLanguage: finalizeBreakdownBucket(stageTimingBreakdown.inference.byLanguage),
      bySizeBin: finalizeBreakdownBucket(stageTimingBreakdown.inference.bySizeBin)
    },
    embedding: {
      totalMs: clampDurationMs(stageTimingBreakdown.embedding.totalMs),
      byLanguage: finalizeBreakdownBucket(stageTimingBreakdown.embedding.byLanguage),
      bySizeBin: finalizeBreakdownBucket(stageTimingBreakdown.embedding.bySizeBin)
    },
    extractedProseLowYieldBailout: buildExtractedProseLowYieldBailoutSummary(extractedProseLowYieldBailout),
    watchdog: {
      queueDelayMs: {
        summary: {
          count: Math.max(0, Math.floor(queueDelaySummary.count)),
          totalMs: clampDurationMs(queueDelaySummary.totalMs),
          minMs: queueDelaySummary.minMs == null ? 0 : clampDurationMs(queueDelaySummary.minMs),
          maxMs: clampDurationMs(queueDelaySummary.maxMs),
          avgMs: queueDelaySummary.count > 0
            ? clampDurationMs(queueDelaySummary.totalMs) / queueDelaySummary.count
            : 0
        },
        histogram: queueDelayHistogram.snapshot()
      },
      nearThreshold: buildWatchdogNearThresholdSummary({
        sampleCount: watchdogNearThreshold.sampleCount,
        nearThresholdCount: watchdogNearThreshold.nearThresholdCount,
        slowWarningCount: watchdogNearThreshold.slowWarningCount,
        thresholdTotalMs: watchdogNearThreshold.thresholdTotalMs,
        activeTotalMs: watchdogNearThreshold.activeTotalMs,
        lowerFraction: stageFileWatchdogConfig?.nearThresholdLowerFraction,
        upperFraction: stageFileWatchdogConfig?.nearThresholdUpperFraction,
        alertFraction: stageFileWatchdogConfig?.nearThresholdAlertFraction,
        minSamples: stageFileWatchdogConfig?.nearThresholdMinSamples,
        slowFileMs: stageFileWatchdogConfig?.slowFileMs
      })
    }
  });

  return {
    queueDelaySummary,
    queueDelayTelemetryChannel,
    recordStageTimingSample,
    observeQueueDelay,
    observeWatchdogNearThreshold,
    buildStageTimingBreakdownPayload
  };
};
