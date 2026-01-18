import { normalizeVec, quantizeVec } from '../../src/index/embedding.js';
import { resolveQuantizationParams } from '../../src/storage/sqlite/vector.js';

const isVectorLike = (value) => {
  if (Array.isArray(value)) return true;
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
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
  quantization
}) => {
  const embedCode = isVectorLike(codeVector) ? codeVector : [];
  const embedDoc = isVectorLike(docVector) ? docVector : zeroVector;
  const resolved = resolveQuantizationParams(quantization);
  const length = embedCode.length || embedDoc.length || 0;
  const merged = length ? new Float32Array(length) : new Float32Array(0);
  if (embedCode.length) {
    for (let i = 0; i < merged.length; i += 1) {
      merged[i] = (embedCode[i] + (embedDoc[i] ?? 0)) / 2;
    }
  } else if (embedDoc.length) {
    for (let i = 0; i < merged.length; i += 1) {
      merged[i] = embedDoc[i] ?? 0;
    }
  }
  const normalized = normalizeVec(merged);
  if (addHnswVector && normalized.length) {
    addHnswVector(chunkIndex, normalized);
  }
  const quantizedCode = embedCode.length
    ? quantizeVec(embedCode, resolved.minVal, resolved.maxVal, resolved.levels)
    : [];
  const quantizedDoc = embedDoc.length
    ? quantizeVec(embedDoc, resolved.minVal, resolved.maxVal, resolved.levels)
    : [];
  const quantizedMerged = normalized.length
    ? quantizeVec(normalized, resolved.minVal, resolved.maxVal, resolved.levels)
    : [];
  return { quantizedCode, quantizedDoc, quantizedMerged };
};

export const fillMissingVectors = (vectorList, dims) => {
  const fallback = new Array(dims).fill(0);
  for (let i = 0; i < vectorList.length; i += 1) {
    if (!isVectorLike(vectorList[i]) || vectorList[i].length !== dims) {
      vectorList[i] = fallback;
    }
  }
};
