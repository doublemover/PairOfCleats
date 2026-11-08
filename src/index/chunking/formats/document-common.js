import { createHash } from 'node:crypto';
import { MARKDOWN_EXTS } from '../../constants.js';

export const DOCUMENT_CHUNKER_VERSION = 'v1';

export const DOCUMENT_CHUNKING_DEFAULTS = Object.freeze({
  maxCharsPerChunk: 2400,
  minCharsPerChunk: 400,
  maxTokensPerChunk: 700
});
export const EXTRACTED_PROSE_DOCUMENT_EXTENSIONS = Object.freeze([
  ...MARKDOWN_EXTS,
  '.rst',
  '.adoc',
  '.asciidoc',
  '.txt',
  '.pdf',
  '.docx',
  '.rtf',
  '.html',
  '.htm',
  '.xml'
]);
export const EXTRACTED_PROSE_LOW_YIELD_BAILOUT_DEFAULTS = Object.freeze({
  enabled: true,
  warmupSampleSize: 48,
  warmupWindowMultiplier: 4,
  minYieldRatio: 0.08,
  minYieldedFiles: 2,
  minYieldedChunks: 4,
  seed: 'extracted-prose-low-yield-v1',
  disableWhenHistoryHasYield: true,
  historyMinBuilds: 1,
  historyMinObservedFiles: 48,
  historyWarmupSampleScale: 0.25,
  historyWarmupSampleFloor: 8
});
export const EXTRACTED_PROSE_YIELD_PROFILE_PREFILTER_DEFAULTS = Object.freeze({
  enabled: true,
  minBuilds: 1,
  minProfileSamples: 192,
  minFamilySamples: 64,
  maxYieldRatio: 0.01,
  maxYieldedFiles: 0
});

const normalizePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};
const normalizeBoolean = (value, fallback) => {
  if (typeof value === 'boolean') return value;
  return fallback;
};
const normalizeRatio = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return fallback;
  return parsed;
};
const normalizeRatioExclusiveZero = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) return fallback;
  return parsed;
};
const normalizeString = (value, fallback) => {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw || fallback;
};
const normalizeNonNegativeInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
};

export const normalizeExtractedProseLowYieldBailoutConfig = (value = null) => {
  const config = value && typeof value === 'object' ? value : {};
  const defaults = EXTRACTED_PROSE_LOW_YIELD_BAILOUT_DEFAULTS;
  const warmupSampleSize = normalizePositiveInt(config.warmupSampleSize, defaults.warmupSampleSize);
  const warmupWindowMultiplier = normalizePositiveInt(
    config.warmupWindowMultiplier,
    defaults.warmupWindowMultiplier
  );
  return {
    enabled: normalizeBoolean(config.enabled, defaults.enabled),
    warmupSampleSize,
    warmupWindowMultiplier,
    warmupWindowSize: Math.max(
      warmupSampleSize,
      Math.floor(warmupSampleSize * warmupWindowMultiplier)
    ),
    minYieldRatio: normalizeRatio(config.minYieldRatio, defaults.minYieldRatio),
    minYieldedFiles: normalizePositiveInt(config.minYieldedFiles, defaults.minYieldedFiles),
    minYieldedChunks: normalizePositiveInt(config.minYieldedChunks, defaults.minYieldedChunks),
    seed: normalizeString(config.seed, defaults.seed),
    disableWhenHistoryHasYield: normalizeBoolean(
      config.disableWhenHistoryHasYield,
      defaults.disableWhenHistoryHasYield
    ),
    historyMinBuilds: normalizePositiveInt(config.historyMinBuilds, defaults.historyMinBuilds),
    historyMinObservedFiles: normalizePositiveInt(
      config.historyMinObservedFiles,
      defaults.historyMinObservedFiles
    ),
    historyWarmupSampleScale: normalizeRatioExclusiveZero(
      config.historyWarmupSampleScale,
      defaults.historyWarmupSampleScale
    ),
    historyWarmupSampleFloor: normalizePositiveInt(
      config.historyWarmupSampleFloor,
      defaults.historyWarmupSampleFloor
    )
  };
};

export const isExtractedProseDocumentLikeExtension = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return false;
  const normalized = raw.startsWith('.') ? raw : `.${raw}`;
  return EXTRACTED_PROSE_DOCUMENT_EXTENSIONS.includes(normalized);
};

export const normalizeExtractedProseYieldProfilePrefilterConfig = (value = null) => {
  const config = value && typeof value === 'object' ? value : {};
  const defaults = EXTRACTED_PROSE_YIELD_PROFILE_PREFILTER_DEFAULTS;
  return {
    enabled: normalizeBoolean(config.enabled, defaults.enabled),
    minBuilds: Math.max(1, normalizePositiveInt(config.minBuilds, defaults.minBuilds)),
    minProfileSamples: Math.max(1, normalizePositiveInt(config.minProfileSamples, defaults.minProfileSamples)),
    minFamilySamples: Math.max(1, normalizePositiveInt(config.minFamilySamples, defaults.minFamilySamples)),
    maxYieldRatio: normalizeRatio(config.maxYieldRatio, defaults.maxYieldRatio),
    maxYieldedFiles: Math.max(0, normalizeNonNegativeInt(config.maxYieldedFiles, defaults.maxYieldedFiles))
  };
};

export const scoreDeterministicSampleKey = ({ key, seed }) => {
  const digest = createHash('sha256')
    .update(`${String(seed || '')}|${String(key || '')}`, 'utf8')
    .digest('hex');
  const prefix = digest.slice(0, 8);
  const score = Number.parseInt(prefix, 16);
  return Number.isFinite(score) ? score : Number.MAX_SAFE_INTEGER;
};

export const selectDeterministicWarmupSample = ({
  values,
  sampleSize,
  seed,
  resolveKey
} = {}) => {
  const list = Array.isArray(values) ? values : [];
  if (!list.length) return [];
  const requested = Number(sampleSize);
  const target = Number.isFinite(requested) && requested > 0
    ? Math.min(list.length, Math.floor(requested))
    : 0;
  if (target <= 0) return [];
  const keyFor = typeof resolveKey === 'function'
    ? resolveKey
    : (entry) => String(entry || '');
  return list
    .map((entry, index) => {
      const key = String(keyFor(entry) || '');
      return {
        entry,
        index,
        key,
        score: scoreDeterministicSampleKey({ key, seed })
      };
    })
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score;
      if (left.key < right.key) return -1;
      if (left.key > right.key) return 1;
      return left.index - right.index;
    })
    .slice(0, target)
    .map((item) => item.entry);
};

export const normalizeDocumentChunkingBudgets = (context = null) => {
  const rawChunking = context?.chunking && typeof context.chunking === 'object'
    ? context.chunking
    : {};
  const maxCharsPerChunk = normalizePositiveInt(
    rawChunking.maxCharsPerChunk,
    DOCUMENT_CHUNKING_DEFAULTS.maxCharsPerChunk
  );
  const minCharsRaw = normalizePositiveInt(
    rawChunking.minCharsPerChunk,
    DOCUMENT_CHUNKING_DEFAULTS.minCharsPerChunk
  );
  const minCharsPerChunk = Math.min(minCharsRaw, Math.max(1, maxCharsPerChunk));
  return {
    maxCharsPerChunk,
    minCharsPerChunk,
    maxTokensPerChunk: normalizePositiveInt(
      rawChunking.maxTokensPerChunk,
      DOCUMENT_CHUNKING_DEFAULTS.maxTokensPerChunk
    )
  };
};

const normalizeAnchorSlice = (value) => (
  String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
);

export const buildDocumentAnchor = ({
  type,
  start,
  end,
  textSlice
}) => {
  const normalizedType = String(type || 'document').trim() || 'document';
  const startId = Number(start) || 0;
  const endId = Number(end) || startId;
  const normalizedSlice = normalizeAnchorSlice(textSlice);
  const digest = createHash('sha256').update(normalizedSlice, 'utf8').digest('hex').slice(0, 12);
  return `${normalizedType}:${startId}-${endId}:${digest}`;
};

export const splitRangeByCharBudget = ({ start, end, maxCharsPerChunk, minCharsPerChunk }) => {
  const rangeStart = Number(start) || 0;
  const rangeEnd = Number(end) || rangeStart;
  if (rangeEnd <= rangeStart) return [];
  const maxChars = Math.max(1, Number(maxCharsPerChunk) || DOCUMENT_CHUNKING_DEFAULTS.maxCharsPerChunk);
  const minChars = Math.max(1, Number(minCharsPerChunk) || DOCUMENT_CHUNKING_DEFAULTS.minCharsPerChunk);
  if (rangeEnd - rangeStart <= maxChars) {
    return [{ start: rangeStart, end: rangeEnd, windowIndex: 0 }];
  }
  const windows = [];
  let cursor = rangeStart;
  let windowIndex = 0;
  while (cursor < rangeEnd) {
    let next = Math.min(rangeEnd, cursor + maxChars);
    const remaining = rangeEnd - next;
    if (remaining > 0 && remaining < minChars) {
      next = rangeEnd;
    }
    if (next <= cursor) {
      next = Math.min(rangeEnd, cursor + 1);
    }
    windows.push({ start: cursor, end: next, windowIndex });
    cursor = next;
    windowIndex += 1;
  }
  return windows;
};

export const findCoveredUnitRange = ({
  units,
  startOffset,
  endOffset,
  startField,
  endField,
  fallbackStart = 1,
  fallbackEnd = fallbackStart
}) => {
  if (!Array.isArray(units) || !units.length || endOffset <= startOffset) {
    return {
      start: fallbackStart,
      end: fallbackEnd
    };
  }
  let first = null;
  let last = null;
  for (const unit of units) {
    const unitStart = Number(unit?.start);
    const unitEnd = Number(unit?.end);
    if (!Number.isFinite(unitStart) || !Number.isFinite(unitEnd)) continue;
    if (unitEnd <= startOffset || unitStart >= endOffset) continue;
    if (!first) first = unit;
    last = unit;
  }
  if (!first || !last) {
    return {
      start: fallbackStart,
      end: fallbackEnd
    };
  }
  return {
    start: Number(first?.[startField]) || fallbackStart,
    end: Number(last?.[endField]) || Number(last?.[startField]) || fallbackEnd
  };
};

/** Operation-owned coordinate snapshot. Ordered unit/query streams use two
 * monotonic cursors; arbitrary query order uses binary lookup. Malformed or
 * unsorted coordinates retain the exported helper's full-scan semantics. */
export const createDocumentUnitRangeLookup = units => {
  const rows = Array.isArray(units) ? units.map(unit => ({ ...unit, start: Number(unit?.start), end: Number(unit?.end) })) : [];
  const ordered = rows.every((unit, index) => Number.isFinite(unit.start) && Number.isFinite(unit.end)
    && unit.end >= unit.start && (!index || (unit.start >= rows[index - 1].start && unit.end >= rows[index - 1].end)));
  let firstCursor = 0, endCursor = 0, previousStart = -Infinity, previousEnd = -Infinity;
  const lowerBound = (value, field, strict) => {
    let left = 0, right = rows.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if (strict ? rows[middle][field] <= value : rows[middle][field] < value) left = middle + 1;
      else right = middle;
    }
    return left;
  };
  return input => {
    const { startOffset, endOffset, startField, endField, fallbackStart = 1, fallbackEnd = fallbackStart } = input;
    if (!ordered) return findCoveredUnitRange({ units: rows, ...input });
    if (!rows.length || endOffset <= startOffset || !Number.isFinite(startOffset) || !Number.isFinite(endOffset)) {
      return findCoveredUnitRange({ units: rows, ...input });
    }
    if (startOffset >= previousStart) while (firstCursor < rows.length && rows[firstCursor].end <= startOffset) firstCursor++;
    else firstCursor = lowerBound(startOffset, 'end', true);
    if (endOffset >= previousEnd) while (endCursor < rows.length && rows[endCursor].start < endOffset) endCursor++;
    else endCursor = lowerBound(endOffset, 'start', false);
    previousStart = startOffset; previousEnd = endOffset;
    const first = rows[firstCursor], last = rows[endCursor - 1];
    if (firstCursor >= endCursor || !first || !last) return { start: fallbackStart, end: fallbackEnd };
    return { start: Number(first[startField]) || fallbackStart,
      end: Number(last[endField]) || Number(last[startField]) || fallbackEnd };
  };
};
