import { sha1 } from '../shared/hash.js';

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
