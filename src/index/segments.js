import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { smartChunk } from './chunking.js';
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

export { normalizeSegmentsConfig } from './segments/config.js';
export { detectFrontmatter } from './segments/frontmatter.js';
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
  const baseSegment = {
    type: resolveSegmentType(mode, ext),
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
  const resolvedLineIndex = lineIndex || buildLineIndex(text);
  const chunks = [];
  for (const segment of segments) {
    const segmentText = text.slice(segment.start, segment.end);
    const tokenMode = resolveSegmentTokenMode(segment);
    if (!shouldIndexSegment(segment, tokenMode, effectiveMode)) continue;
    const segmentExt = resolveSegmentExt(ext, segment);
    const segmentContext = {
      ...context,
      languageId: segment.languageId || context.languageId || null,
      segment
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
    const segmentStartLine = offsetToLine(resolvedLineIndex, segment.start);
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
      adjusted.segment = {
        segmentId: segment.segmentId,
        type: segment.type,
        languageId: segment.languageId || null,
        start: segment.start,
        end: segment.end,
        parentSegmentId: segment.parentSegmentId || null,
        embeddingContext: segment.embeddingContext || segment.meta?.embeddingContext || null
      };
      chunks.push(adjusted);
    }
  }
  if (chunks.length > 1) {
    chunks.sort((a, b) => (a.start - b.start) || (a.end - b.end));
  }
  return chunks;
}

