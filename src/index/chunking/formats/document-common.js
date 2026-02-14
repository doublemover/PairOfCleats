import { createHash } from 'node:crypto';

export const DOCUMENT_CHUNKER_VERSION = 'v1';

export const DOCUMENT_CHUNKING_DEFAULTS = Object.freeze({
  maxCharsPerChunk: 2400,
  minCharsPerChunk: 400,
  maxTokensPerChunk: 700
});

const normalizePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
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
