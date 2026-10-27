import { isEmbeddingVectorReady } from '../../shared/embedding-output-admission.js';

/** Admit the exact query width; qualified model projection happens in its
 * provider decoder. Never repair invalid values by clipping or zero padding.
 */
export function normalizeEmbeddingDims(embedding, expectedDims) {
  const queryDims = embedding?.length || 0;
  const resolvedExpected = expectedDims == null ? null : Number(expectedDims);
  const accepted = isEmbeddingVectorReady(embedding, resolvedExpected);
  return { embedding: accepted ? (Array.isArray(embedding) ? embedding : Array.from(embedding)) : null,
    queryDims, expectedDims: resolvedExpected, adjusted: false };
}
