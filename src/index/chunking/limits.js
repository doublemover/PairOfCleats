import { buildLineIndex, offsetToLine } from '../../shared/lines.js';

const DEFAULT_CHUNK_GUARDRAIL_MAX_BYTES = 200 * 1024;
const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;
const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;

const normalizeChunkLimit = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const limit = Math.max(0, Math.floor(num));
  return limit > 0 ? limit : null;
};

/**
 * Resolve optional shared chunking cache for this text payload.
 * Shared caches are reused only when bound to the exact same source text.
 *
 * @param {object|null|undefined} context
 * @param {string} text
 * @returns {object|null}
 */
const resolveChunkingShared = (context, text) => {
  const shared = context?.chunkingShared;
  if (!shared || typeof shared !== 'object') return null;
  if (typeof shared.text === 'string' && shared.text !== text) return null;
  return shared;
};

/**
 * Resolve optional chunk size caps from indexing context.
 * @param {object} context
 * @returns {{maxBytes:number|null,maxLines:number|null}}
 */
export const resolveChunkingLimits = (context) => {
  const raw = context?.chunking && typeof context.chunking === 'object'
    ? context.chunking
    : {};
  return {
    maxBytes: normalizeChunkLimit(raw.maxBytes),
    maxLines: normalizeChunkLimit(raw.maxLines)
  };
};

const buildChunkWithRange = (chunk, start, end, lineIndex) => {
  const next = { ...chunk, start, end };
  if (lineIndex) {
    const meta = chunk.meta && typeof chunk.meta === 'object' ? { ...chunk.meta } : {};
    const startLine = offsetToLine(lineIndex, start);
    const endOffset = end > start ? end - 1 : start;
    const endLine = offsetToLine(lineIndex, endOffset);
    meta.startLine = startLine;
    meta.endLine = endLine;
    next.meta = meta;
  }
  return next;
};

const isHighSurrogate = (code) => code >= HIGH_SURROGATE_MIN && code <= HIGH_SURROGATE_MAX;
const isLowSurrogate = (code) => code >= LOW_SURROGATE_MIN && code <= LOW_SURROGATE_MAX;

const buildUtf8ByteMetrics = (text) => {
  const length = text.length;
  const prefix = new Uint32Array(length + 1);
  for (let i = 0; i < length; i += 1) {
    const code = text.charCodeAt(i);
    const base = prefix[i];
    if (isHighSurrogate(code) && i + 1 < length) {
      const next = text.charCodeAt(i + 1);
      if (isLowSurrogate(next)) {
        prefix[i + 1] = base + 3;
        prefix[i + 2] = base + 4;
        i += 1;
        continue;
      }
    }
    if (code <= 0x7f) {
      prefix[i + 1] = base + 1;
    } else if (code <= 0x7ff) {
      prefix[i + 1] = base + 2;
    } else {
      prefix[i + 1] = base + 3;
    }
  }
  return { text, prefix };
};

const byteLengthByRange = (text, start, end, metrics = null) => {
  if (end <= start) return 0;
  if (!metrics || metrics.text !== text || !metrics.prefix) {
    return Buffer.byteLength(text.slice(start, end), 'utf8');
  }
  let bytes = metrics.prefix[end] - metrics.prefix[start];
  if (start > 0) {
    const prev = text.charCodeAt(start - 1);
    const current = text.charCodeAt(start);
    if (isHighSurrogate(prev) && isLowSurrogate(current)) {
      bytes += 2;
    }
  }
  return bytes;
};

/**
 * Split a chunk into line-bounded windows.
 * @param {object} chunk
 * @param {string} text
 * @param {number[]} lineIndex
 * @param {number} maxLines
 * @returns {object[]}
 */
export const splitChunkByLines = (chunk, text, lineIndex, maxLines) => {
  if (!lineIndex || !maxLines) return [chunk];
  const start = Number.isFinite(chunk.start) ? chunk.start : 0;
  const end = Number.isFinite(chunk.end) ? chunk.end : start;
  if (end <= start) return [chunk];
  const startLineIdx = offsetToLine(lineIndex, start) - 1;
  const endOffset = end > start ? end - 1 : start;
  const endLineIdx = offsetToLine(lineIndex, endOffset) - 1;
  const totalLines = endLineIdx - startLineIdx + 1;
  if (totalLines <= maxLines) return [chunk];
  const output = [];
  let currentStart = start;
  let lineCount = 0;
  for (let lineIdx = startLineIdx; lineIdx <= endLineIdx; lineIdx += 1) {
    if (lineCount >= maxLines) {
      const splitAt = lineIndex[lineIdx] ?? end;
      if (splitAt > currentStart) {
        output.push(buildChunkWithRange(chunk, currentStart, splitAt, lineIndex));
      }
      currentStart = splitAt;
      lineCount = 0;
    }
    lineCount += 1;
  }
  if (currentStart < end) {
    output.push(buildChunkWithRange(chunk, currentStart, end, lineIndex));
  }
  return output.length ? output : [chunk];
};

const resolveByteBoundary = (text, start, end, maxBytes, byteMetrics = null) => {
  let lo = start;
  let hi = end;
  let best = start;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const bytes = byteLengthByRange(text, start, mid, byteMetrics);
    if (bytes <= maxBytes) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
};

/**
 * Split a chunk into byte-bounded windows while preserving line metadata.
 * @param {object} chunk
 * @param {string} text
 * @param {(() => number[])|number[]} resolveLineIndex
 * @param {number} maxBytes
 * @param {{text:string,prefix:Uint32Array}|null} [byteMetrics]
 * @returns {object[]}
 */
export const splitChunkByBytes = (chunk, text, resolveLineIndex, maxBytes, byteMetrics = null) => {
  if (!maxBytes) return [chunk];
  const start = Number.isFinite(chunk.start) ? chunk.start : 0;
  const end = Number.isFinite(chunk.end) ? chunk.end : start;
  if (end <= start) return [chunk];
  const bytes = byteLengthByRange(text, start, end, byteMetrics);
  if (bytes <= maxBytes) return [chunk];
  const output = [];
  let cursor = start;
  let hi = start;
  let lineIndex = null;
  const ensureLineIndex = () => {
    if (lineIndex) return lineIndex;
    if (typeof resolveLineIndex === 'function') {
      lineIndex = resolveLineIndex();
    } else if (resolveLineIndex && Array.isArray(resolveLineIndex)) {
      lineIndex = resolveLineIndex;
    }
    return lineIndex;
  };
  const canUseLinearWindowScan = Boolean(
    byteMetrics
    && byteMetrics.text === text
    && byteMetrics.prefix
  );
  if (canUseLinearWindowScan) {
    while (cursor < end) {
      if (hi < cursor + 1) hi = cursor + 1;
      while (hi <= end && byteLengthByRange(text, cursor, hi, byteMetrics) <= maxBytes) {
        hi += 1;
      }
      let safeNext = hi - 1;
      if (safeNext <= cursor) {
        safeNext = Math.min(cursor + 1, end);
      }
      output.push(buildChunkWithRange(chunk, cursor, safeNext, ensureLineIndex()));
      if (safeNext <= cursor) break;
      cursor = safeNext;
    }
    return output.length ? output : [chunk];
  }
  while (cursor < end) {
    const next = resolveByteBoundary(text, cursor, end, maxBytes, byteMetrics);
    const safeNext = next > cursor ? next : Math.min(cursor + 1, end);
    output.push(buildChunkWithRange(chunk, cursor, safeNext, ensureLineIndex()));
    if (safeNext <= cursor) break;
    cursor = safeNext;
  }
  return output.length ? output : [chunk];
};

/**
 * Apply configured line/byte chunk caps with a byte-guardrail fallback.
 * @param {Array<object>} chunks
 * @param {string} text
 * @param {object} context
 * @returns {Array<object>}
 */
export const applyChunkingLimits = (chunks, text, context) => {
  if (!Array.isArray(chunks) || !chunks.length) return chunks;
  const { maxBytes, maxLines } = resolveChunkingLimits(context);
  const shared = resolveChunkingShared(context, text);
  let byteMetrics = shared?.byteMetrics
    && shared.byteMetrics.text === text
    && shared.byteMetrics.prefix
    ? shared.byteMetrics
    : null;
  if (!byteMetrics && (maxBytes || !maxLines)) {
    byteMetrics = buildUtf8ByteMetrics(text);
    if (shared) shared.byteMetrics = byteMetrics;
  }
  const resolveChunkBytes = (chunk) => {
    const start = Number.isFinite(chunk.start) ? chunk.start : 0;
    const end = Number.isFinite(chunk.end) ? chunk.end : start;
    if (end <= start) return 0;
    return byteLengthByRange(text, start, end, byteMetrics);
  };
  const guardrailMaxBytes = (!maxBytes && !maxLines)
    ? chunks.some((chunk) => resolveChunkBytes(chunk) > DEFAULT_CHUNK_GUARDRAIL_MAX_BYTES)
      ? DEFAULT_CHUNK_GUARDRAIL_MAX_BYTES
      : null
    : null;
  if (!maxBytes && !maxLines && !guardrailMaxBytes) return chunks;
  let lineIndex = Array.isArray(shared?.lineIndex) ? shared.lineIndex : null;
  const getLineIndex = () => {
    if (!lineIndex) {
      lineIndex = buildLineIndex(text);
      if (shared) shared.lineIndex = lineIndex;
    }
    return lineIndex;
  };
  let output = chunks;
  if (maxLines) {
    const resolvedLineIndex = getLineIndex();
    const nextOutput = [];
    for (const chunk of output) {
      const split = splitChunkByLines(chunk, text, resolvedLineIndex, maxLines);
      for (const item of split) nextOutput.push(item);
    }
    output = nextOutput;
  }
  const effectiveMaxBytes = maxBytes || guardrailMaxBytes;
  if (effectiveMaxBytes) {
    const nextOutput = [];
    for (const chunk of output) {
      const split = splitChunkByBytes(chunk, text, getLineIndex, effectiveMaxBytes, byteMetrics);
      for (const item of split) nextOutput.push(item);
    }
    output = nextOutput;
  }
  return output;
};
