import { quantizeVecUint8 } from '../../../src/index/embedding.js';
import { mergeEmbeddingVectors, normalizeEmbeddingVector } from '../../../src/shared/embedding-utils.js';
import { resolveQuantizationParams } from '../../../src/storage/sqlite/quantization.js';

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

/**
 * Run embedding requests in deterministic batches and optionally report batch
 * completion telemetry to callers.
 *
 * @param {{
 *   texts:string[],
 *   batchSize:number,
 *   maxBatchTokens?:number,
 *   estimateTokens?:(text:string)=>number,
 *   tokenEstimates?:number[]|null,
 *   embed:(batch:string[])=>Promise<Array<ArrayLike<number>>>,
 *   onBatch?:(input:{batchIndex:number,batchCount:number,batchSize:number,batchTokens:number,completed:number,total:number,durationMs:number})=>void
 * }} input
 * @returns {Promise<Array<ArrayLike<number>>>}
 */
export const runBatched = async ({
  texts,
  batchSize,
  maxBatchTokens = 0,
  estimateTokens = null,
  tokenEstimates = null,
  embed,
  onBatch = null
}) => {
  if (!texts.length) return [];
  const observer = typeof onBatch === 'function' ? onBatch : null;
  const maxItems = Number.isFinite(Number(batchSize)) && Number(batchSize) > 0
    ? Math.max(1, Math.floor(Number(batchSize)))
    : Number.MAX_SAFE_INTEGER;
  const tokenBudget = Number.isFinite(Number(maxBatchTokens)) && Number(maxBatchTokens) > 0
    ? Math.max(1, Math.floor(Number(maxBatchTokens)))
    : 0;
  const tokenEstimator = typeof estimateTokens === 'function'
    ? estimateTokens
    : (text) => {
      const chars = typeof text === 'string' ? text.length : 0;
      return Math.max(1, Math.ceil(chars / 4));
    };
  const normalizedTokenEstimates = Array.isArray(tokenEstimates) && tokenEstimates.length === texts.length
    ? tokenEstimates.map((value) => Math.max(1, Math.floor(Number(value) || 1)))
    : null;
  const resolveTokenEstimate = (text, index) => {
    if (normalizedTokenEstimates) return normalizedTokenEstimates[index] || 1;
    return Math.max(1, Math.floor(Number(tokenEstimator(text)) || 1));
  };
  const batches = [];
  if (!tokenBudget && maxItems === Number.MAX_SAFE_INTEGER) {
    batches.push(texts);
  } else if (!tokenBudget) {
    for (let i = 0; i < texts.length; i += maxItems) {
      batches.push(texts.slice(i, i + maxItems));
    }
  } else {
    let current = [];
    let currentTokens = 0;
    for (let i = 0; i < texts.length; i += 1) {
      const text = texts[i];
      const estimated = resolveTokenEstimate(text, i);
      const wouldExceedTokens = current.length > 0 && (currentTokens + estimated) > tokenBudget;
      const wouldExceedItems = current.length >= maxItems;
      if (wouldExceedTokens || wouldExceedItems) {
        batches.push(current);
        current = [];
        currentTokens = 0;
      }
      current.push(text);
      currentTokens += estimated;
    }
    if (current.length) batches.push(current);
  }
  if (batches.length === 1) {
    const singleBatch = batches[0] || texts;
    let batchTokens = 0;
    for (let i = 0; i < singleBatch.length; i += 1) {
      batchTokens += resolveTokenEstimate(singleBatch[i], i);
    }
    const startedAt = Date.now();
    const vectors = await embed(singleBatch);
    observer?.({
      batchIndex: 1,
      batchCount: 1,
      batchSize: singleBatch.length,
      batchTokens,
      completed: singleBatch.length,
      total: texts.length,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
    return vectors;
  }
  const out = [];
  const batchCount = batches.length;
  let completed = 0;
  let completedTokenEstimateOffset = 0;
  for (let batchIndex = 1; batchIndex <= batchCount; batchIndex += 1) {
    const slice = batches[batchIndex - 1] || [];
    let batchTokens = 0;
    for (let i = 0; i < slice.length; i += 1) {
      batchTokens += resolveTokenEstimate(slice[i], completedTokenEstimateOffset + i);
    }
    completedTokenEstimateOffset += slice.length;
    const startedAt = Date.now();
    const batch = await embed(slice);
    out.push(...batch);
    completed += slice.length;
    observer?.({
      batchIndex,
      batchCount,
      batchSize: slice.length,
      batchTokens,
      completed: Math.min(texts.length, completed),
      total: texts.length,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
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
