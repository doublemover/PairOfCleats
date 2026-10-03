/**
 * Rebase a segment-local chunk into container-file coordinates.
 *
 * @param {{
 *  chunk:object,
 *  segment?:object|null,
 *  segmentUid?:string|null,
 *  segmentExt?:string,
 *  segmentStart:number,
 *  segmentEnd:number,
 *  segmentStartLine:number,
 *  segmentEndLine:number,
 *  embeddingContext?:object|null
 * }} input
 * @returns {object}
 */
export const attachSegmentMeta = ({
  chunk,
  segment,
  segmentUid,
  segmentExt,
  segmentStart,
  segmentEnd,
  segmentStartLine,
  segmentEndLine,
  embeddingContext
}) => {
  const adjusted = { ...chunk };
  adjusted.start = chunk.start + segmentStart;
  adjusted.end = chunk.end + segmentStart;
  if (adjusted.meta && typeof adjusted.meta === 'object') {
    if (Number.isFinite(adjusted.meta.startLine)) {
      adjusted.meta.startLine = segmentStartLine + adjusted.meta.startLine - 1;
    }
    if (Number.isFinite(adjusted.meta.endLine)) {
      adjusted.meta.endLine = segmentStartLine + adjusted.meta.endLine - 1;
    }
  }
  if (segment) {
    adjusted.segment = {
      segmentId: segment.segmentId,
      segmentUid,
      type: segment.type,
      languageId: segment.languageId || null,
      ext: segmentExt,
      start: segmentStart,
      end: segmentEnd,
      startLine: segmentStartLine,
      endLine: segmentEndLine,
      parentSegmentId: segment.parentSegmentId || null,
      embeddingContext
    };
  }
  return adjusted;
};
