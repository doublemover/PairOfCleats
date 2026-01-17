import { buildLineIndex, offsetToLine } from '../../shared/lines.js';

const DEFAULT_CHUNK_GUARDRAIL_MAX_BYTES = 200 * 1024;

const normalizeChunkLimit = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const limit = Math.max(0, Math.floor(num));
  return limit > 0 ? limit : null;
};

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

const resolveByteBoundary = (text, start, end, maxBytes) => {
  let lo = start;
  let hi = end;
  let best = start;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const bytes = Buffer.byteLength(text.slice(start, mid), 'utf8');
    if (bytes <= maxBytes) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
};

export const splitChunkByBytes = (chunk, text, lineIndex, maxBytes) => {
  if (!maxBytes) return [chunk];
  const start = Number.isFinite(chunk.start) ? chunk.start : 0;
  const end = Number.isFinite(chunk.end) ? chunk.end : start;
  if (end <= start) return [chunk];
  const bytes = Buffer.byteLength(text.slice(start, end), 'utf8');
  if (bytes <= maxBytes) return [chunk];
  const output = [];
  let cursor = start;
  while (cursor < end) {
    const next = resolveByteBoundary(text, cursor, end, maxBytes);
    const safeNext = next > cursor ? next : Math.min(cursor + 1, end);
    output.push(buildChunkWithRange(chunk, cursor, safeNext, lineIndex));
    if (safeNext <= cursor) break;
    cursor = safeNext;
  }
  return output.length ? output : [chunk];
};

export const applyChunkingLimits = (chunks, text, context) => {
  if (!Array.isArray(chunks) || !chunks.length) return chunks;
  const { maxBytes, maxLines } = resolveChunkingLimits(context);
  const resolveChunkBytes = (chunk) => {
    const start = Number.isFinite(chunk.start) ? chunk.start : 0;
    const end = Number.isFinite(chunk.end) ? chunk.end : start;
    if (end <= start) return 0;
    return Buffer.byteLength(text.slice(start, end), 'utf8');
  };
  const guardrailMaxBytes = (!maxBytes && !maxLines)
    ? chunks.some((chunk) => resolveChunkBytes(chunk) > DEFAULT_CHUNK_GUARDRAIL_MAX_BYTES)
      ? DEFAULT_CHUNK_GUARDRAIL_MAX_BYTES
      : null
    : null;
  if (!maxBytes && !maxLines && !guardrailMaxBytes) return chunks;
  const lineIndex = buildLineIndex(text);
  let output = chunks;
  if (maxLines) {
    output = output.flatMap((chunk) => splitChunkByLines(chunk, text, lineIndex, maxLines));
  }
  const effectiveMaxBytes = maxBytes || guardrailMaxBytes;
  if (effectiveMaxBytes) {
    output = output.flatMap((chunk) => splitChunkByBytes(chunk, text, lineIndex, effectiveMaxBytes));
  }
  return output;
};
