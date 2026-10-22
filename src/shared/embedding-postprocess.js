import { isVectorLike, mergeEmbeddingVectors } from './embedding-vector-utils.js';
import { quantizeEmbeddingVectorUint8 } from './embedding-quantization.js';

/** Read-only inference/cache inputs; each returned channel owns its byte buffer. */
export const postprocessEmbeddingChannels = ({ codeVector, docVector, normalize = true, quantization = {} }) => {
  const code = isVectorLike(codeVector) ? codeVector : [], doc = isVectorLike(docVector) ? docVector : [];
  if (code.length && doc.length && code.length !== doc.length) throw new Error(`[embeddings] embedding dims mismatch (code=${code.length}, doc=${doc.length}).`);
  for (const vector of [code, doc]) for (let index = 0; index < vector.length; index++) {
    if (typeof vector[index] !== 'number' || !Number.isFinite(vector[index])) {
      throw new TypeError(`[embeddings] Non-finite embedding dimension ${index}.`);
    }
  }
  const shouldNormalize = normalize !== false;
  const encode = vector => quantizeEmbeddingVectorUint8(vector,
    quantization.minVal ?? -1, quantization.maxVal ?? 1, quantization.levels ?? 256, { normalize: shouldNormalize });
  const quantizedCode = code.length ? encode(code) : new Uint8Array(0);
  const quantizedDoc = doc.length ? encode(doc) : new Uint8Array(0);
  let quantizedMerged;
  if (!code.length || !doc.length) {
    const single = code.length ? code : doc;
    const encoded = code.length ? quantizedCode : quantizedDoc;
    // A legacy unnormalized merged row rounds to Float32 even if its source
    // channel was a plain array/Float64 row. Preserve that distinction.
    quantizedMerged = shouldNormalize || single instanceof Float32Array || !single.length
      ? encoded.slice() : encode(Float32Array.from(single));
  } else {
    quantizedMerged = encode(mergeEmbeddingVectors({ codeVector: code, docVector: doc }));
  }
  return { quantizedCode, quantizedDoc, quantizedMerged };
};
