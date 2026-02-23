import { finalizeSegments } from '../../../segments/finalize.js';

/**
 * Merge scheduler-planned segments with mode-specific extras, then dedupe deterministically.
 *
 * @param {{plannedSegments:Array<object>,extraSegments:Array<object>,relKey:string}} input
 * @returns {Array<object>}
 */
export const mergePlannedSegmentsWithExtras = ({ plannedSegments, extraSegments, relKey }) => {
  const planned = Array.isArray(plannedSegments) ? plannedSegments : [];
  const extras = Array.isArray(extraSegments) ? extraSegments : [];
  if (!extras.length) return planned;
  const merged = finalizeSegments([...planned, ...extras], relKey);
  const deduped = [];
  const seen = new Set();
  for (const segment of merged) {
    if (!segment) continue;
    const key = [
      segment.segmentId || '',
      segment.start,
      segment.end,
      segment.type || '',
      segment.languageId || '',
      segment.parentSegmentId || '',
      segment.embeddingContext || segment.meta?.embeddingContext || ''
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(segment);
  }
  return deduped;
};
