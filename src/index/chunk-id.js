import { sha1 } from '../shared/hash.js';

export const buildChunkId = (chunk) => {
  if (!chunk) return null;
  const key = [
    chunk.file || '',
    chunk.segment?.segmentId || '',
    chunk.start ?? '',
    chunk.end ?? '',
    chunk.kind || '',
    chunk.name || ''
  ].join('|');
  return `chunk_${sha1(key)}`;
};

export const resolveChunkId = (chunk) => {
  if (!chunk) return null;
  return chunk.metaV2?.chunkId || chunk.chunkId || buildChunkId(chunk);
};
