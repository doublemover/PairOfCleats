import { isNonEmptyVector, isVectorLike } from '../../../src/shared/embedding-vector-utils.js';

/** Aggregate file fingerprints are hints; exact chunk hashes decide reuse. */
export const reusePriorChunkVectors = ({ prior, chunkHashes, docTexts, identityKey, expectedDims, reuse }) => {
  if (!prior || prior.cacheMeta?.identityKey !== identityKey || !Array.isArray(prior.chunkHashes)) return 0;
  const buckets = new Map();
  for (let index = 0; index < prior.chunkHashes.length; index++) {
    const hash = prior.chunkHashes[index];
    if (!hash) continue;
    let bucket = buckets.get(hash);
    if (!bucket) { bucket = { indices: [], cursor: 0 }; buckets.set(hash, bucket); }
    bucket.indices.push(index);
  }
  let matched = 0;
  const valid = vector => isNonEmptyVector(vector) && (!expectedDims || vector.length === expectedDims)
    && Array.from(vector).every(Number.isFinite);
  for (let index = 0; index < chunkHashes.length; index++) {
    const bucket = buckets.get(chunkHashes[index]);
    if (!bucket || bucket.cursor >= bucket.indices.length) continue;
    const oldIndex = bucket.indices[bucket.cursor++];
    const code = prior.codeVectors?.[oldIndex], doc = prior.docVectors?.[oldIndex], merged = prior.mergedVectors?.[oldIndex];
    if (!valid(code) || !valid(merged) || code.length !== merged.length) continue;
    const hasDoc = typeof docTexts?.[index] === 'string' && docTexts[index].length > 0;
    if (hasDoc ? !valid(doc) || doc.length !== code.length : doc != null && (!isVectorLike(doc) || doc.length !== 0)) continue;
    reuse.code[index] = code; reuse.doc[index] = doc || new Float32Array(0); reuse.merged[index] = merged; matched++;
  }
  return matched;
};
