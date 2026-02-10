import { chunkSegments } from '../../../segments.js';
import {
  resolveTreeSitterLanguageForSegment,
  resolveTreeSitterLanguagesForSegments
} from '../tree-sitter.js';
import { TREE_SITTER_LANGUAGE_IDS } from '../../../../lang/tree-sitter/config.js';
import { isTreeSitterEnabled } from '../../../../lang/tree-sitter/options.js';

const TREE_SITTER_LANG_IDS = new Set(TREE_SITTER_LANGUAGE_IDS);

export const chunkSegmentsWithTreeSitterPasses = async ({
  text,
  ext,
  relPath,
  mode,
  segments,
  lineIndex,
  context,
  treeSitterConfig,
  languageOptions,
  log
}) => {
  if (!treeSitterConfig || treeSitterConfig.enabled === false) {
    return chunkSegments({ text, ext, relPath, mode, segments, lineIndex, context });
  }
  if (treeSitterConfig.languagePasses === false) {
    return chunkSegments({ text, ext, relPath, mode, segments, lineIndex, context });
  }
  if (!Array.isArray(segments) || !segments.length) {
    return chunkSegments({ text, ext, relPath, mode, segments, lineIndex, context });
  }
  const baseOptions = { treeSitter: treeSitterConfig };
  const passSegments = new Map();
  const fallbackSegments = [];
  for (const segment of segments) {
    const rawLanguageId = segment?.languageId || context?.languageId || null;
    const languageId = resolveTreeSitterLanguageForSegment(rawLanguageId, ext);
    if (!languageId || !TREE_SITTER_LANG_IDS.has(languageId) || !isTreeSitterEnabled(baseOptions, languageId)) {
      fallbackSegments.push(segment);
      continue;
    }
    if (!passSegments.has(languageId)) passSegments.set(languageId, []);
    passSegments.get(languageId).push(segment);
  }
  if (passSegments.size <= 1 && !fallbackSegments.length) {
    return chunkSegments({ text, ext, relPath, mode, segments, lineIndex, context });
  }
  const chunks = [];
  if (fallbackSegments.length) {
    const fallbackContext = {
      ...context,
      treeSitter: { ...(treeSitterConfig || {}), enabled: false }
    };
    const fallbackChunks = chunkSegments({
      text,
      ext,
      relPath,
      mode,
      segments: fallbackSegments,
      lineIndex,
      context: fallbackContext
    });
    if (fallbackChunks && fallbackChunks.length) chunks.push(...fallbackChunks);
  }
  for (const [languageId, languageSegments] of passSegments) {
    const passTreeSitter = { ...(treeSitterConfig || {}), allowedLanguages: [languageId] };
    const passChunks = chunkSegments({
      text,
      ext,
      relPath,
      mode,
      segments: languageSegments,
      lineIndex,
      context: {
        ...context,
        treeSitter: passTreeSitter
      }
    });
    if (passChunks && passChunks.length) chunks.push(...passChunks);
  }
  if (!chunks.length) return chunks;
  chunks.sort((a, b) => (a.start - b.start) || (a.end - b.end));
  return chunks;
};

export const validateChunkBounds = (chunks, textLength) => {
  if (!Array.isArray(chunks)) return 'chunk list missing';
  let lastStart = -1;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (!chunk) return `chunk ${i} missing`;
    const start = Number(chunk.start);
    const end = Number(chunk.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return `chunk ${i} missing offsets`;
    }
    if (start < 0 || end < 0 || start > end || end > textLength) {
      return `chunk ${i} out of bounds`;
    }
    if (start < lastStart) {
      return `chunk ${i} out of order`;
    }
    lastStart = start;
  }
  return null;
};

export const sanitizeChunkBounds = (chunks, textLength) => {
  if (!Array.isArray(chunks)) return;
  const max = Number.isFinite(textLength) ? textLength : 0;
  for (const chunk of chunks) {
    if (!chunk) continue;
    const start = Number(chunk.start);
    const end = Number(chunk.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const clampedStart = Math.max(0, Math.min(start, max));
    const clampedEnd = Math.max(clampedStart, Math.min(end, max));
    if (clampedStart !== start) chunk.start = clampedStart;
    if (clampedEnd !== end) chunk.end = clampedEnd;
  }
};
