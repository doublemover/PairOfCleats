import { mapEmbeddedContentRange } from '../../shared/embedded-content.js';
import { offsetToLine } from '../../shared/lines.js';

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
  embeddingContext,
  lineIndex = null
}) => {
  const adjusted = { ...chunk };
  const sourcePieces = segment?.contentView ? mapEmbeddedContentRange(segment.contentView, chunk.start, chunk.end) : null;
  adjusted.start = sourcePieces ? sourcePieces[0].start : chunk.start + segmentStart;
  adjusted.end = sourcePieces ? sourcePieces.at(-1).end : chunk.end + segmentStart;
  if (adjusted.meta && typeof adjusted.meta === 'object') {
    adjusted.meta = { ...adjusted.meta };
    if (Number.isFinite(adjusted.meta.startLine)) {
      adjusted.meta.startLine = sourcePieces && lineIndex ? offsetToLine(lineIndex, adjusted.start) : segmentStartLine + adjusted.meta.startLine - 1;
    }
    if (Number.isFinite(adjusted.meta.endLine)) {
      adjusted.meta.endLine = sourcePieces && lineIndex ? offsetToLine(lineIndex, Math.max(adjusted.start, adjusted.end - 1)) : segmentStartLine + adjusted.meta.endLine - 1;
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
      embeddingContext,
      ...(segment.meta?.commentContentIdentity ? { contentOrigin: { kind: 'comment',
        identity: segment.meta.commentContentIdentity, start: segment.meta.containerStart, end: segment.meta.containerEnd } } : {}),
      ...(segment.contentView ? { contentView: segment.contentView } : {})
    };
  }
  return adjusted;
};
