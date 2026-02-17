import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { smartChunk } from './chunking.js';
import { computeSegmentUid } from './identity/chunk-uid.js';
import { finalizeSegments } from './segments/finalize.js';
import {
  normalizeSegmentsConfig,
  resolveSegmentExt,
  resolveSegmentTokenMode,
  resolveSegmentType,
  shouldIndexSegment
} from './segments/config.js';
import { segmentMarkdown } from './segments/markdown.js';
import { segmentJsx } from './segments/jsx.js';
import { segmentAstro, segmentSvelte, segmentVue } from './segments/vue.js';
import { buildCdcSegments } from './segments/cdc.js';

export { normalizeSegmentsConfig } from './segments/config.js';
export { detectFrontmatter } from './segments/frontmatter.js';

const isBaseSegment = (segment, textLength, baseSegmentType) => segment.start === 0
  && segment.end === textLength
  && segment.type === baseSegmentType
  && !segment.parentSegmentId
  && !segment.embeddingContext
  && (!segment.meta || Object.keys(segment.meta).length === 0);

// When chunking a sliced segment (vs the full container text), any full-file chunk/AST
// caches in `context` can produce out-of-segment ranges. That later breaks VFS tooling
// range mapping (`Invalid virtualRange ...; skipping target.`). Strip those caches so
// the segment is chunked against its own text, even if we have to fall back.
const stripFullFileChunkingCaches = (context) => {
  if (!context || typeof context !== 'object') return context;
  const next = { ...context };
  for (const key of Object.keys(next)) {
    if (key.endsWith('Chunks')) delete next[key];
  }
  delete next.jsAst;
  delete next.pythonAst;
  delete next.chunkingShared;
  return next;
};

const buildSegmentLineIndex = (lineIndex, segmentStart, segmentEnd) => {
  if (!Array.isArray(lineIndex) || !lineIndex.length) return [0];
  if (!Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd) || segmentEnd <= segmentStart) {
    return [0];
  }
  const startLineIdx = Math.max(0, offsetToLine(lineIndex, segmentStart) - 1);
  const endOffset = segmentEnd > segmentStart ? segmentEnd - 1 : segmentStart;
  const endLineIdx = Math.max(startLineIdx, offsetToLine(lineIndex, endOffset) - 1);
  const local = [0];
  for (let line = startLineIdx + 1; line <= endLineIdx; line += 1) {
    const absoluteOffset = lineIndex[line];
    if (!Number.isFinite(absoluteOffset)) continue;
    if (absoluteOffset <= segmentStart || absoluteOffset >= segmentEnd) continue;
    local.push(absoluteOffset - segmentStart);
  }
  return local;
};

export const assignSegmentUids = async ({ text, segments, ext, mode }) => {
  if (!text || !Array.isArray(segments) || !segments.length) return segments;
  const effectiveMode = mode === 'extracted-prose' ? 'prose' : mode;
  const baseSegmentType = resolveSegmentType(effectiveMode, ext);
  for (const segment of segments) {
    if (!segment || segment.segmentUid) continue;
    if (isBaseSegment(segment, text.length, baseSegmentType)) continue;
    const segmentText = text.slice(segment.start, segment.end);
    const segmentUid = await computeSegmentUid({
      segmentText,
      segmentType: segment.type,
      languageId: segment.languageId
    });
    if (segmentUid) segment.segmentUid = segmentUid;
  }
  return segments;
};

export function discoverSegments({
  text,
  ext,
  relPath,
  mode,
  languageId = null,
  context = null,
  segmentsConfig = null,
  extraSegments = []
}) {
  const effectiveMode = mode === 'extracted-prose' ? 'prose' : mode;
  const config = normalizeSegmentsConfig(segmentsConfig);
  if (config.onlyExtras) {
    return finalizeSegments(extraSegments || [], relPath);
  }
  if (ext === '.md' || ext === '.mdx') {
    const segments = segmentMarkdown({ text, ext, relPath, segmentsConfig: config });
    return extraSegments && extraSegments.length
      ? finalizeSegments([...segments, ...extraSegments], relPath)
      : segments;
  }
  if (ext === '.jsx' || ext === '.tsx') {
    const segments = segmentJsx({ text, ext, relPath, languageId, context });
    if (segments) {
      return extraSegments && extraSegments.length
        ? finalizeSegments([...segments, ...extraSegments], relPath)
        : segments;
    }
  }
  if (ext === '.vue') {
    const segments = segmentVue({ text, relPath });
    if (segments) {
      return extraSegments && extraSegments.length
        ? finalizeSegments([...segments, ...extraSegments], relPath)
        : segments;
    }
  }
  if (ext === '.svelte') {
    const segments = segmentSvelte({ text, relPath });
    if (segments) {
      return extraSegments && extraSegments.length
        ? finalizeSegments([...segments, ...extraSegments], relPath)
        : segments;
    }
  }
  if (ext === '.astro') {
    const segments = segmentAstro({ text, relPath });
    if (segments) {
      return extraSegments && extraSegments.length
        ? finalizeSegments([...segments, ...extraSegments], relPath)
        : segments;
    }
  }
  if (config.cdc?.enabled && text.length >= (config.cdc.minFileBytes || 0)) {
    const cdcSegments = buildCdcSegments({
      text,
      languageId,
      options: config.cdc
    });
    if (cdcSegments.length) {
      return extraSegments && extraSegments.length
        ? finalizeSegments([...cdcSegments, ...extraSegments], relPath)
        : finalizeSegments(cdcSegments, relPath);
    }
  }
  const baseSegment = {
    type: resolveSegmentType(effectiveMode, ext),
    languageId,
    start: 0,
    end: text.length,
    parentSegmentId: null,
    meta: {}
  };
  return extraSegments && extraSegments.length
    ? finalizeSegments([baseSegment, ...extraSegments], relPath)
    : finalizeSegments([baseSegment], relPath);
}

export function chunkSegments({
  text,
  ext,
  relPath,
  mode,
  context = {},
  segments = [],
  lineIndex = null
}) {
  const effectiveMode = mode === 'extracted-prose' ? 'prose' : mode;
  const baseSegmentType = resolveSegmentType(effectiveMode, ext);
  const resolvedLineIndex = lineIndex || buildLineIndex(text);
  const chunks = [];
  for (const segment of segments) {
    const segmentText = text.slice(segment.start, segment.end);
    const isBase = isBaseSegment(segment, text.length, baseSegmentType);
    const tokenMode = resolveSegmentTokenMode(segment);
    if (!shouldIndexSegment(segment, tokenMode, effectiveMode)) continue;
    const segmentExt = resolveSegmentExt(ext, segment);
    const embeddingContext = segment.embeddingContext || segment.meta?.embeddingContext || null;
    const segmentStartLine = offsetToLine(resolvedLineIndex, segment.start);
    const segmentEndOffset = segment.end > segment.start ? segment.end - 1 : segment.start;
    const segmentEndLine = offsetToLine(resolvedLineIndex, segmentEndOffset);
    const segmentUid = isBase ? null : segment.segmentUid || null;
    const baseShared = context?.chunkingShared && typeof context.chunkingShared === 'object'
      ? context.chunkingShared
      : null;
    const chunkingShared = isBase
      ? {
        ...(baseShared || {}),
        text,
        lineIndex: resolvedLineIndex
      }
      : {
        text: segmentText,
        lineIndex: buildSegmentLineIndex(resolvedLineIndex, segment.start, segment.end)
      };
    const segmentContext = {
      ...(isBase ? context : stripFullFileChunkingCaches(context)),
      languageId: segment.languageId || context.languageId || null,
      chunkingShared,
      segment: isBase
        ? null
        : {
          ...segment,
          ext: segmentExt,
          segmentUid,
          embeddingContext
        }
    };
    const segmentChunks = smartChunk({
      text: segmentText,
      ext: segmentExt,
      relPath,
      mode: tokenMode,
      context: segmentContext,
      languageId: segment.languageId || null
    });
    if (!Array.isArray(segmentChunks) || !segmentChunks.length) continue;
    for (const chunk of segmentChunks) {
      if (!chunk) continue;
      const adjusted = { ...chunk };
      adjusted.start = chunk.start + segment.start;
      adjusted.end = chunk.end + segment.start;
      if (adjusted.meta && typeof adjusted.meta === 'object') {
        if (Number.isFinite(adjusted.meta.startLine)) {
          adjusted.meta.startLine = segmentStartLine + adjusted.meta.startLine - 1;
        }
        if (Number.isFinite(adjusted.meta.endLine)) {
          adjusted.meta.endLine = segmentStartLine + adjusted.meta.endLine - 1;
        }
      }
      if (!isBase) {
        adjusted.segment = {
          segmentId: segment.segmentId,
          segmentUid,
          type: segment.type,
          languageId: segment.languageId || null,
          ext: segmentExt,
          start: segment.start,
          end: segment.end,
          startLine: segmentStartLine,
          endLine: segmentEndLine,
          parentSegmentId: segment.parentSegmentId || null,
          embeddingContext
        };
      }
      chunks.push(adjusted);
    }
  }
  if (chunks.length > 1) {
    chunks.sort((a, b) => (a.start - b.start) || (a.end - b.end));
  }
  return chunks;
}

