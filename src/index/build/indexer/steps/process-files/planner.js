import path from 'node:path';
import { fileExt, toPosix } from '../../../../../shared/files.js';
import { coerceNonNegativeInt, coercePositiveInt } from '../../../../../shared/number-coerce.js';
import { getLanguageForFile } from '../../../../language-registry.js';
import { shouldSkipTreeSitterPlanningForPath } from '../../../tree-sitter-scheduler/policy.js';

const DEFAULT_POSTINGS_ROWS_PER_PENDING = 300;
const DEFAULT_POSTINGS_BYTES_PER_PENDING = 12 * 1024 * 1024;
const DEFAULT_POSTINGS_PENDING_SCALE = 4;
const DEFAULT_POSTINGS_RESERVE_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_WINDOW_TARGET_COST = 500;
const DEFAULT_WINDOW_MAX_COST = 1000;
const DEFAULT_WINDOW_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_WINDOW_MAX_SEQ_SPAN = 256;
const LEXICON_FILTER_LOG_LIMIT = 5;
const MB = 1024 * 1024;

/**
 * Resolve postings queue backpressure thresholds from runtime config.
 * Defaults scale with CPU queue capacity to bound in-flight sparse payloads
 * without starving workers on larger repositories.
 *
 * @param {object} runtime
 * @returns {{
 *   maxPending:number,
 *   maxPendingRows:number,
 *   maxPendingBytes:number,
 *   maxHeapFraction:number|undefined,
 *   reserveTimeoutMs:number
 * }}
 */
export const resolvePostingsQueueConfig = (runtime) => {
  const config = runtime?.stage1Queues?.postings || {};
  const cpuPending = Number.isFinite(runtime?.queues?.cpu?.maxPending)
    ? runtime.queues.cpu.maxPending
    : null;
  const cpuConcurrency = Number.isFinite(runtime?.cpuConcurrency)
    ? Math.max(1, Math.floor(runtime.cpuConcurrency))
    : 1;
  const baseMaxPending = coercePositiveInt(config.maxPending)
    ?? (Number.isFinite(cpuPending)
      ? Math.max(1, Math.floor(cpuPending * DEFAULT_POSTINGS_PENDING_SCALE))
      : null)
    ?? Math.max(64, cpuConcurrency * 12);
  const perWorkerWriteBufferMb = Number(runtime?.memoryPolicy?.perWorkerWriteBufferMb);
  const projectedWriteBufferBytes = Number.isFinite(perWorkerWriteBufferMb) && perWorkerWriteBufferMb > 0
    ? Math.floor(perWorkerWriteBufferMb * MB * Math.max(1, cpuConcurrency))
    : 0;
  const highMemoryProfile = runtime?.memoryPolicy?.highMemoryProfile || {};
  const highMemoryPostingsScale = Number(highMemoryProfile?.postingsScale);
  const postingsScale = highMemoryProfile?.applied === true
    && Number.isFinite(highMemoryPostingsScale)
    && highMemoryPostingsScale > 1
    ? highMemoryPostingsScale
    : 1;
  const basePendingRows = coercePositiveInt(config.maxPendingRows)
    ?? Math.max(DEFAULT_POSTINGS_ROWS_PER_PENDING, baseMaxPending * DEFAULT_POSTINGS_ROWS_PER_PENDING);
  const basePendingBytes = coercePositiveInt(config.maxPendingBytes)
    ?? Math.max(
      DEFAULT_POSTINGS_BYTES_PER_PENDING,
      baseMaxPending * DEFAULT_POSTINGS_BYTES_PER_PENDING,
      projectedWriteBufferBytes
    );
  const maxPendingRows = Math.max(DEFAULT_POSTINGS_ROWS_PER_PENDING, Math.floor(basePendingRows * postingsScale));
  const maxPendingBytes = Math.max(DEFAULT_POSTINGS_BYTES_PER_PENDING, Math.floor(basePendingBytes * postingsScale));
  const maxHeapFraction = Number(config.maxHeapFraction);
  const reserveTimeoutMs = coerceNonNegativeInt(config.reserveTimeoutMs)
    ?? DEFAULT_POSTINGS_RESERVE_TIMEOUT_MS;
  return {
    maxPending: baseMaxPending,
    maxPendingRows,
    maxPendingBytes,
    maxHeapFraction: Number.isFinite(maxHeapFraction) && maxHeapFraction >= 0 ? maxHeapFraction : undefined,
    reserveTimeoutMs
  };
};

/**
 * Resolve ordered appender backpressure thresholds.
 *
 * The ordered appender preserves deterministic emission order, but allowing a
 * bounded out-of-order buffer keeps workers productive while a single slow
 * head-of-line file is still processing.
 *
 * @param {object} runtime
 * @returns {{maxPendingBeforeBackpressure:number,maxPendingEmergencyFactor:number|undefined}}
 */
export const resolveOrderedAppenderConfig = (runtime) => {
  const config = runtime?.stage1Queues?.ordered || {};
  const windowConfig = runtime?.stage1Queues?.window || {};
  const cpuPending = Number.isFinite(runtime?.queues?.cpu?.maxPending)
    ? runtime.queues.cpu.maxPending
    : null;
  const fileConcurrency = Number.isFinite(runtime?.fileConcurrency)
    ? Math.max(1, Math.floor(runtime.fileConcurrency))
    : 1;
  const maxPendingBeforeBackpressure = coercePositiveInt(config.maxPending)
    ?? cpuPending
    ?? Math.max(128, fileConcurrency * 20);
  const maxPendingEmergencyFactor = Number(config.maxPendingEmergencyFactor);
  const maxPendingBytes = coercePositiveInt(config.maxPendingBytes)
    ?? coercePositiveInt(windowConfig.maxWindowBytes)
    ?? DEFAULT_WINDOW_MAX_BYTES;
  const commitLagHard = coercePositiveInt(config.commitLagHard)
    ?? coercePositiveInt(windowConfig.maxInFlightSeqSpan)
    ?? DEFAULT_WINDOW_MAX_SEQ_SPAN;
  const resumeHysteresisRatioRaw = Number(config.resumeHysteresisRatio);
  return {
    maxPendingBeforeBackpressure,
    maxPendingBytes,
    commitLagHard,
    resumeHysteresisRatio: Number.isFinite(resumeHysteresisRatioRaw)
      ? Math.max(0.1, Math.min(0.95, resumeHysteresisRatioRaw))
      : 0.7,
    maxPendingEmergencyFactor: Number.isFinite(maxPendingEmergencyFactor) && maxPendingEmergencyFactor > 1
      ? maxPendingEmergencyFactor
      : undefined
  };
};

/**
 * Resolve contiguous seq-window planner settings from runtime config.
 *
 * @param {object} runtime
 * @returns {{
 *   targetWindowCost:number,
 *   maxWindowCost:number,
 *   maxWindowBytes:number,
 *   maxInFlightSeqSpan:number,
 *   minWindowEntries:number,
 *   maxWindowEntries:number,
 *   maxActiveWindows:number
 * }}
 */
export const resolveWindowPlannerConfig = (runtime) => {
  const config = runtime?.stage1Queues?.window && typeof runtime.stage1Queues.window === 'object'
    ? runtime.stage1Queues.window
    : {};
  const fileConcurrency = Number.isFinite(runtime?.fileConcurrency)
    ? Math.max(1, Math.floor(runtime.fileConcurrency))
    : 1;
  const targetWindowCost = coercePositiveInt(config.targetWindowCost)
    ?? Math.max(DEFAULT_WINDOW_TARGET_COST, fileConcurrency * DEFAULT_WINDOW_TARGET_COST);
  const maxWindowCost = coercePositiveInt(config.maxWindowCost)
    ?? Math.max(DEFAULT_WINDOW_MAX_COST, Math.floor(targetWindowCost * 2));
  const maxWindowBytes = coercePositiveInt(config.maxWindowBytes)
    ?? DEFAULT_WINDOW_MAX_BYTES;
  const maxInFlightSeqSpan = coercePositiveInt(config.maxInFlightSeqSpan)
    ?? Math.max(DEFAULT_WINDOW_MAX_SEQ_SPAN, fileConcurrency * 32);
  const minWindowEntries = coercePositiveInt(config.minWindowEntries)
    ?? Math.max(1, Math.min(16, fileConcurrency));
  const maxWindowEntries = Math.max(
    minWindowEntries,
    coercePositiveInt(config.maxWindowEntries)
    ?? Math.max(minWindowEntries, fileConcurrency * 64)
  );
  const maxActiveWindows = Math.max(
    1,
    Math.min(2, coercePositiveInt(config.maxActiveWindows) ?? 2)
  );
  return {
    targetWindowCost,
    maxWindowCost,
    maxWindowBytes,
    maxInFlightSeqSpan,
    minWindowEntries,
    maxWindowEntries,
    maxActiveWindows
  };
};

/**
 * Filter entries eligible for Tree-sitter planning.
 *
 * Entries skipped by discovery flags or language/path policy are excluded, and
 * skip count is returned for diagnostics.
 *
 * @param {{entries:object[],root:string}} input
 * @returns {{entries:object[],skipped:number}}
 */
export const resolveTreeSitterPlannerEntries = ({ entries, root }) => {
  if (!Array.isArray(entries) || !entries.length) {
    return { entries: [], skipped: 0 };
  }
  const plannerEntries = [];
  let skipped = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.treeSitterDisabled === true || entry.skip || entry?.scan?.skip) {
      skipped += 1;
      continue;
    }
    const relKey = entry.rel || toPosix(path.relative(root, entry.abs || ''));
    const ext = typeof entry.ext === 'string' && entry.ext
      ? entry.ext
      : fileExt(entry.abs || relKey || '');
    const languageId = getLanguageForFile(ext, relKey)?.id || null;
    if (shouldSkipTreeSitterPlanningForPath({ relKey, languageId })) {
      skipped += 1;
      continue;
    }
    plannerEntries.push(entry);
  }
  return { entries: plannerEntries, skipped };
};

/**
 * Emit aggregate lexicon-filter drop telemetry for relation extraction.
 *
 * @param {{state:object,logFn:Function}} input
 * @returns {void}
 */
export const logLexiconFilterAggregate = ({ state, logFn }) => {
  if (!state?.lexiconRelationFilterByFile || typeof state.lexiconRelationFilterByFile.entries !== 'function') return;
  const entries = Array.from(state.lexiconRelationFilterByFile.entries());
  if (!entries.length) return;
  let totalDropped = 0;
  let droppedCalls = 0;
  let droppedUsages = 0;
  let droppedCallDetails = 0;
  let droppedCallDetailsWithRange = 0;
  const byLanguage = new Map();
  for (const [, stats] of entries) {
    const languageId = stats?.languageId || '_generic';
    const bucket = byLanguage.get(languageId) || { files: 0, droppedTotal: 0 };
    bucket.files += 1;
    const dropped = Number(stats?.droppedTotal) || 0;
    bucket.droppedTotal += dropped;
    byLanguage.set(languageId, bucket);
    totalDropped += dropped;
    droppedCalls += Number(stats?.droppedCalls) || 0;
    droppedUsages += Number(stats?.droppedUsages) || 0;
    droppedCallDetails += Number(stats?.droppedCallDetails) || 0;
    droppedCallDetailsWithRange += Number(stats?.droppedCallDetailsWithRange) || 0;
  }
  if (!totalDropped) return;
  const languages = Array.from(byLanguage.entries())
    .sort((a, b) => b[1].droppedTotal - a[1].droppedTotal)
    .slice(0, LEXICON_FILTER_LOG_LIMIT)
    .map(([languageId, bucket]) => `${languageId}:${bucket.droppedTotal}`);
  const suffix = languages.length ? ` top=${languages.join(',')}` : '';
  logFn(
    `[lexicon] relations filtered across ${entries.length} files `
    + `(dropped=${totalDropped} calls=${droppedCalls} usages=${droppedUsages} `
    + `callDetails=${droppedCallDetails} callDetailsRange=${droppedCallDetailsWithRange}).${suffix}`
  );
};
