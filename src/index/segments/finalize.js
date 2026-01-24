import { buildSegmentId } from './config.js';

export const finalizeSegments = (segments, relPath) => {
  const output = [];
  for (const segment of segments || []) {
    if (!segment) continue;
    const start = Number(segment.start);
    const end = Number(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const normalized = {
      ...segment,
      start,
      end
    };
    normalized.segmentId = normalized.segmentId || buildSegmentId(relPath, normalized);
    output.push(normalized);
  }
  output.sort((a, b) => a.start - b.start || a.end - b.end);
  return output;
};
