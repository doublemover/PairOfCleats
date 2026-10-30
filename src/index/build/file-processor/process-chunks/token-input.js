import { TOKENIZE_BATCH_MAX_TEXT_BYTES } from '../../workers/tokenize-batch.js';
import { getLanguageRouteForFile } from '../../../language-registry/routing.js';
import { resolveSegmentTokenMode } from '../../../segments/config.js';
import { stripCommentText } from '../utils.js';
import { readChunkContent } from '../../../../shared/embedded-content.js';

/**
 * Verify chunk byte bounds align exactly to the requested line window so token
 * slicing can reuse prebuilt file line-token streams without re-tokenization.
 *
 * @param {{
 *   chunkStart:number,
 *   chunkEnd:number,
 *   startLine:number,
 *   endLine:number,
 *   lineIndex:number[],
 *   fileLength:number
 * }} input
 * @returns {boolean}
 */
export const canUseLineTokenStreamSlice = ({
  chunkStart,
  chunkEnd,
  startLine,
  endLine,
  lineIndex,
  fileLength
}) => {
  if (!Array.isArray(lineIndex) || !lineIndex.length) return false;
  if (!Number.isFinite(chunkStart) || !Number.isFinite(chunkEnd)) return false;
  const startLineNumber = Math.max(1, Math.floor(Number(startLine) || 1));
  const endLineNumber = Math.max(startLineNumber, Math.floor(Number(endLine) || startLineNumber));
  const startLineOffset = lineIndex[startLineNumber - 1];
  if (!Number.isFinite(startLineOffset)) return false;
  const nextLineOffset = lineIndex[endLineNumber];
  const endLineOffset = Number.isFinite(nextLineOffset)
    ? nextLineOffset
    : (Number.isFinite(fileLength) ? fileLength : null);
  if (!Number.isFinite(endLineOffset)) return false;
  return chunkStart === startLineOffset && chunkEnd === endLineOffset;
};

export const createChunkTokenBatchInput = ({ chunksForProcessing, text, lexicalCheckpoint,
  tokenMode, containerExt, relKey, containerLanguageId, commentRangeAssignments, normalizedCommentsConfig,
  chunkLineRanges, fileLineCount, tokenizationFileStreamEnabled, lineIndex, fileStat, workerDictOverride }) => index => {
  const chunk = chunksForProcessing[index];
  if (!chunk || chunk.end - chunk.start > TOKENIZE_BATCH_MAX_TEXT_BYTES) return null;
  const chunkText = readChunkContent(text, chunk);
  const chunkMode = (chunk.segment ? resolveSegmentTokenMode(chunk.segment) : tokenMode) || tokenMode;
  const effectiveExt = chunk.segment?.ext || containerExt;
  const effectiveLang = getLanguageRouteForFile(effectiveExt, relKey) || null;
  const languageId = effectiveLang?.id || chunk.segment?.languageId || containerLanguageId || 'unknown';
  const ranges = commentRangeAssignments.get(index) || [];
  const tokenText = !chunk.segment?.contentView && chunkMode === 'code' && normalizedCommentsConfig.includeInCode !== true && ranges.length
    ? stripCommentText(chunkText, chunk.start, ranges) : chunkText;
  if (lexicalCheckpoint?.has(index, lexicalCheckpoint.key({ index, start: chunk.start, end: chunk.end, text: tokenText,
    mode: chunkMode, ext: effectiveExt, languageId, segmentUid: chunk.segment?.segmentUid || null }))) return null;
  const lines = chunkLineRanges[index] || { startLine: 1, endLine: fileLineCount || 1 };
  if (!chunk.segment?.contentView && tokenizationFileStreamEnabled && tokenText === chunkText && canUseLineTokenStreamSlice({
    chunkStart: chunk.start, chunkEnd: chunk.end, startLine: lines.startLine, endLine: lines.endLine,
    lineIndex, fileLength: text.length
  })) return null;
  return { text: tokenText, mode: chunkMode, ext: effectiveExt, languageId, file: relKey, size: fileStat.size,
    ...(workerDictOverride ? { dictConfig: workerDictOverride } : {}) };
};
