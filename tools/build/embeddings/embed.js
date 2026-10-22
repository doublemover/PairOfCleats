import { postprocessEmbeddingChannels } from '../../../src/shared/embedding-postprocess.js';
import { resolveQuantizationParams } from '../../../src/storage/sqlite/quantization.js';
export { assertVectorArrays, runBatched } from '../../../src/shared/embedding-batches.js';

const isVectorLike = (value) => {
  if (Array.isArray(value)) return true;
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
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
  codeVector,
  docVector,
  quantization,
  normalize = true
}) => {
  const resolved = resolveQuantizationParams(quantization);
  return postprocessEmbeddingChannels({ codeVector, docVector, normalize, quantization: resolved });
};

export const fillMissingVectors = (vectorList, dims) => {
  for (let i = 0; i < vectorList.length; i += 1) {
    if (isVectorLike(vectorList[i]) && vectorList[i].length && vectorList[i].length !== dims) {
      throw new Error(`Embedding row ${i} has ${vectorList[i].length} dimensions; expected ${dims}.`);
    }
    if (!isVectorLike(vectorList[i]) || !vectorList[i].length) {
      vectorList[i] = new Uint8Array(0);
    }
  }
};
