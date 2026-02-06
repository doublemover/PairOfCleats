import { quantizeVecUint8 } from '../../../src/index/embedding.js';
import { mergeEmbeddingVectors, normalizeEmbeddingVector } from '../../../src/shared/embedding-utils.js';
import { resolveQuantizationParams } from '../../../src/storage/sqlite/vector.js';

const isVectorLike = (value) => {
  if (Array.isArray(value)) return true;
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
};

export const assertVectorArrays = (vectors, count, label) => {
  if (!Array.isArray(vectors) || vectors.length !== count) {
    throw new Error(
      `[embeddings] ${label} embedding batch size mismatch (expected ${count}, got ${vectors?.length ?? 0}).`
    );
  }
  for (let i = 0; i < vectors.length; i += 1) {
    const vec = vectors[i];
    if (!isVectorLike(vec) || !vec.length) {
      throw new Error(
        `[embeddings] ${label} embedding output invalid at index ${i} (non-vector).`
      );
    }
  }
};

export const runBatched = async ({ texts, batchSize, embed }) => {
  if (!texts.length) return [];
  if (!batchSize || texts.length <= batchSize) {
    return embed(texts);
  }
  const out = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const slice = texts.slice(i, i + batchSize);
    const batch = await embed(slice);
    out.push(...batch);
  }
  return out;
};

export const ensureVectorArrays = (vectors, count) => {
  if (Array.isArray(vectors) && vectors.length === count) return vectors;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(isVectorLike(vectors?.[i]) ? vectors[i] : []);
  }
  return out;
};

export const createDimsValidator = ({ mode, configuredDims }) => {
  let dims = 0;
  const assertDims = (length) => {
    if (!length) return;
    if (configuredDims && configuredDims !== length) {
      throw new Error(
        `[embeddings] ${mode} embedding dims mismatch (configured=${configuredDims}, observed=${length}).`
      );
    }
    if (dims && dims !== length) {
      throw new Error(
        `[embeddings] ${mode} embedding dims mismatch (configured=${dims}, observed=${length}).`
      );
    }
    if (!dims) dims = length;
  };
  const getDims = () => dims;
  return { assertDims, getDims };
};

export const isDimsMismatch = (err) =>
  err?.message?.includes('embedding dims mismatch');

export const validateCachedDims = ({ vectors, expectedDims, mode }) => {
  if (!expectedDims || !Array.isArray(vectors)) return;
  for (const vec of vectors) {
    if (!isVectorLike(vec) || !vec.length) continue;
    if (vec.length !== expectedDims) {
      throw new Error(
        `[embeddings] ${mode} embedding dims mismatch (configured=${expectedDims}, observed=${vec.length}).`
      );
    }
  }
};

export const buildQuantizedVectors = ({
  chunkIndex,
  codeVector,
  docVector,
  zeroVector,
  addHnswVector,
  addHnswVectors,
  quantization,
  normalize = true
}) => {
  const embedCode = isVectorLike(codeVector) ? codeVector : [];
  const embedDoc = isVectorLike(docVector) ? docVector : zeroVector;
  const resolved = resolveQuantizationParams(quantization);
  const merged = mergeEmbeddingVectors({ codeVector: embedCode, docVector: embedDoc });
  const shouldNormalize = normalize !== false;
  const mergedVec = shouldNormalize ? normalizeEmbeddingVector(merged) : merged;
  const codeVec = embedCode.length
    ? (shouldNormalize ? normalizeEmbeddingVector(embedCode) : embedCode)
    : [];
  const docVec = embedDoc.length
    ? (shouldNormalize ? normalizeEmbeddingVector(embedDoc) : embedDoc)
    : [];
  const mergedHook = addHnswVectors?.merged || addHnswVector;
  const docHook = addHnswVectors?.doc || null;
  const codeHook = addHnswVectors?.code || null;
  if (mergedHook && mergedVec.length) mergedHook(chunkIndex, mergedVec);
  if (docHook && docVec.length) docHook(chunkIndex, docVec);
  if (codeHook && codeVec.length) codeHook(chunkIndex, codeVec);
  const quantizedCode = codeVec.length
    ? quantizeVecUint8(codeVec, resolved.minVal, resolved.maxVal, resolved.levels)
    : new Uint8Array(0);
  const quantizedDoc = docVec.length
    ? quantizeVecUint8(docVec, resolved.minVal, resolved.maxVal, resolved.levels)
    : new Uint8Array(0);
  const quantizedMerged = mergedVec.length
    ? quantizeVecUint8(mergedVec, resolved.minVal, resolved.maxVal, resolved.levels)
    : new Uint8Array(0);
  return { quantizedCode, quantizedDoc, quantizedMerged };
};

export const fillMissingVectors = (vectorList, dims) => {
  for (let i = 0; i < vectorList.length; i += 1) {
    if (!isVectorLike(vectorList[i]) || vectorList[i].length !== dims) {
      vectorList[i] = new Uint8Array(dims);
    }
  }
};
