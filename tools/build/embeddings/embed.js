import { quantizeVecUint8 } from '../../../src/index/embedding.js';
import { mergeEmbeddingVectors, normalizeEmbeddingVector } from '../../../src/shared/embedding-utils.js';
import { resolveQuantizationParams } from '../../../src/storage/sqlite/quantization.js';
import { planEmbeddingBatches } from './batch-plan.js';

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
 *   groups?:Array<{groupId:string,chunkId?:string|number,kind?:string}>|null,
 *   embed:(batch:string[])=>Promise<Array<ArrayLike<number>>>,
 *   onBatch?:(input:{batchIndex:number,batchCount:number,batchSize:number,batchTokens:number,targetBatchTokens:number,batchTokenBudget:number,batchFillRatio:number,underfilledTokens:number,completed:number,total:number,durationMs:number})=>void
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
  onBatch = null,
  groups = null
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
  const resolveBatchTargets = (batchTokens) => {
    const tokenCount = Math.max(0, Math.floor(Number(batchTokens) || 0));
    const budget = tokenBudget > 0 ? tokenBudget : 0;
    const targetBatchTokens = budget > 0 ? budget : Math.max(1, tokenCount);
    const underfilledTokens = budget > 0
      ? Math.max(0, targetBatchTokens - tokenCount)
      : 0;
    const batchFillRatio = targetBatchTokens > 0
      ? Math.max(0, Math.min(1, tokenCount / targetBatchTokens))
      : 1;
    return {
      batchTokenBudget: budget,
      targetBatchTokens,
      underfilledTokens,
      batchFillRatio
    };
  };
  // Global admission already bounds the window in bytes and requests. Within
  // that window keep code/doc siblings from each file together inside coarse
  // length buckets, avoiding padding a tiny chunk to an unrelated huge chunk.
  const grouped = Array.isArray(groups) && groups.length === texts.length;
  const estimates = texts.map((text, index) => resolveTokenEstimate(text, index));
  const plan = planEmbeddingBatches({ estimates, maxItems, tokenBudget, groups });
  const { batches } = plan;
  const out = new Array(texts.length);
  let completed = 0;
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const indices = batches[batchIndex];
    const slice = indices.map((index) => texts[index]);
    const batchTokens = indices.reduce((sum, index) => sum + estimates[index], 0);
    const groupTokens = new Map();
    if (grouped) for (const index of indices) {
      const id = groups[index]?.groupId;
      groupTokens.set(id, (groupTokens.get(id) || 0) + estimates[index]);
    }
    const startedAt = Date.now();
    const vectors = await embed(slice);
    assertVectorArrays(vectors, indices.length, 'grouped batch');
    indices.forEach((index, slot) => { out[index] = vectors[slot]; });
    completed += indices.length;
    observer?.({
      batchIndex: batchIndex + 1,
      batchCount: batches.length,
      batchSize: indices.length,
      batchTokens,
      batchPlanStrategy: plan.strategy,
      plannedPaddedTokens: plan.paddedTokens,
      baselinePaddedTokens: plan.baselinePaddedTokens,
      paddedTokens: indices.reduce((max, index) => Math.max(max, estimates[index]), 0) * indices.length,
      groupTokens: [...groupTokens],
      groups: groupTokens.size,
      ...resolveBatchTargets(batchTokens),
      completed,
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
  codeVector,
  docVector,
  zeroVector,
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
