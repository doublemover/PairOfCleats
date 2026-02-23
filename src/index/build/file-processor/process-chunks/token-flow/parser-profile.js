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

const toNonNegativeInt = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.max(0, Math.floor(numericValue));
};

/**
 * Resolve deterministic parser fallback mode for one file.
 *
 * Transition order is strict:
 * 1) heavy tokenization skip => `chunk-only`
 * 2) heavy-file downshift => `syntax-lite`
 * 3) heuristic fallback chunking => `syntax-lite`
 * 4) otherwise => `ast-full`
 *
 * @param {{
 *   mode:string,
 *   heavyFileDownshift:boolean,
 *   heavyFileSkipTokenization:boolean,
 *   chunkingDiagnostics?:{
 *     usedHeuristicChunking?:boolean,
 *     usedHeuristicCodeChunking?:boolean,
 *     codeFallbackSegmentCount?:number,
 *     schedulerMissingCount?:number,
 *     fallbackSegmentCount?:number
 *   }|null
 * }} input
 * @returns {{
 *   mode:'ast-full'|'syntax-lite'|'chunk-only',
 *   reasonCode:string|null,
 *   reason:string|null
 * }}
 */
export const resolveParserFallbackProfile = ({
  mode,
  heavyFileDownshift,
  heavyFileSkipTokenization,
  chunkingDiagnostics = null
}) => {
  const diagnostics = chunkingDiagnostics && typeof chunkingDiagnostics === 'object'
    ? chunkingDiagnostics
    : {};
  const schedulerMissingCount = toNonNegativeInt(diagnostics.schedulerMissingCount);
  const codeFallbackSegmentCount = toNonNegativeInt(diagnostics.codeFallbackSegmentCount);
  const usedHeuristicCodeChunking = diagnostics.usedHeuristicCodeChunking === true;
  const schedulerRequired = diagnostics.schedulerRequired === true;
  const treeSitterWasEnabled = diagnostics.treeSitterEnabled === true;
  const codeFallbackIndicatesParserLoss = usedHeuristicCodeChunking || codeFallbackSegmentCount > 0;
  const fallbackIndicatesParserLoss = (schedulerRequired || treeSitterWasEnabled)
    && (codeFallbackIndicatesParserLoss || schedulerMissingCount > 0);
  if (mode !== 'code') {
    return {
      mode: 'chunk-only',
      reasonCode: 'USR-R-HEURISTIC-ONLY',
      reason: 'non-code-mode'
    };
  }
  if (heavyFileSkipTokenization) {
    return {
      mode: 'chunk-only',
      reasonCode: 'USR-R-RESOURCE-BUDGET-EXCEEDED',
      reason: 'heavy-file-tokenization-skip'
    };
  }
  if (heavyFileDownshift) {
    return {
      mode: 'syntax-lite',
      reasonCode: 'USR-R-RESOURCE-BUDGET-EXCEEDED',
      reason: 'heavy-file-downshift'
    };
  }
  if (fallbackIndicatesParserLoss) {
    return {
      mode: 'syntax-lite',
      reasonCode: schedulerMissingCount > 0 ? 'USR-R-PARSER-UNAVAILABLE' : 'USR-R-HEURISTIC-ONLY',
      reason: schedulerMissingCount > 0 ? 'scheduler-miss' : 'heuristic-fallback'
    };
  }
  return {
    mode: 'ast-full',
    reasonCode: null,
    reason: null
  };
};
