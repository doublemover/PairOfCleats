import { sha1 } from '../shared/hash.js';

const normalizeRangeValue = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
};

const normalizeStringValue = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || '';
};

export const resolveChunkSegmentAnchor = (chunk) => (
  normalizeStringValue(chunk?.segment?.anchor)
  || normalizeStringValue(chunk?.metaV2?.segment?.anchor)
  || ''
);

export const resolveChunkSegmentUid = (chunk) => (
  normalizeStringValue(chunk?.segment?.segmentUid)
  || normalizeStringValue(chunk?.metaV2?.segment?.segmentUid)
  || ''
);

export const resolveChunkStableFilePath = (chunk) => (
  normalizeStringValue(chunk?.file)
  || normalizeStringValue(chunk?.metaV2?.file)
  || ''
);

export const buildChunkMappingHintKey = (chunk, { includeFile = false } = {}) => {
  if (!chunk || typeof chunk !== 'object') return null;
  const filePath = includeFile ? resolveChunkStableFilePath(chunk) : '';
  const segmentUid = resolveChunkSegmentUid(chunk);
  const anchor = resolveChunkSegmentAnchor(chunk);
  const start = normalizeRangeValue(chunk?.start);
  const end = normalizeRangeValue(chunk?.end);
  const kind = normalizeStringValue(chunk?.kind || chunk?.metaV2?.kind);
  const name = normalizeStringValue(chunk?.name || chunk?.metaV2?.name);
  const docText = normalizeStringValue(chunk?.docmeta?.doc || chunk?.metaV2?.doc);
  const docHash = docText ? sha1(docText) : '';
  const hasRangeSignal = start > 0 || end > 0;
  const hasSignal = Boolean(
    segmentUid
    || anchor
    || docHash
    || (includeFile && filePath)
    || hasRangeSignal
  );
  if (!hasSignal) return null;
  return [
    filePath,
    segmentUid,
    anchor,
    start,
    end,
    kind,
    name,
    docHash
  ].join('|');
};

export const buildChunkId = (chunk) => {
  if (!chunk) return null;
  const keyParts = [
    chunk.file || '',
    chunk.segment?.segmentId || '',
    chunk.start ?? '',
    chunk.end ?? ''
  ];
  if (Number.isFinite(chunk.spanIndex)) {
    keyParts.push(chunk.spanIndex);
  }
  const key = keyParts.join('|');
  return `chunk_${sha1(key)}`;
};

export const resolveChunkId = (chunk) => {
  if (!chunk) return null;
  return chunk.metaV2?.chunkId || chunk.chunkId || buildChunkId(chunk);
};
