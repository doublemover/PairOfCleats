import { createHash } from 'node:crypto';

export const EMBEDDING_CHUNK_INPUT_VERSION = 2;

/** Exact provider channels, byte-framed without a combined source-text copy.
 * No line-ending conversion is implied: provider input and identity agree.
 */
export const buildEmbeddingChunkInputHash = ({ codeText = '', docText = null } = {}) => {
  if (typeof codeText !== 'string' || docText !== null && typeof docText !== 'string') {
    throw new TypeError('Embedding input requires string code and string or absent documentation.');
  }
  const hash = createHash('sha256').update(`pairofcleats.embedding.chunk-input:${EMBEDDING_CHUNK_INPUT_VERSION}:`);
  for (const [role, value] of [['code', codeText], ['documentation', docText]]) {
    if (value === null) hash.update(`${role}:absent:`);
    else hash.update(`${role}:${Buffer.byteLength(value, 'utf8')}:`).update(value, 'utf8');
  }
  return `chunk-input-v${EMBEDDING_CHUNK_INPUT_VERSION}:${hash.digest('hex')}`;
};

export const hasCurrentEmbeddingChunkInput = payload => payload?.cacheMeta?.chunkInputVersion === EMBEDDING_CHUNK_INPUT_VERSION;
