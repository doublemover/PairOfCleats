import { isVectorLike } from './embedding-vector-utils.js';
import { planEmbeddingBatches } from './embedding-batch-plan.js';
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
    if (vec.length !== vectors[0].length) {
      throw new Error(`[embeddings] ${label} embedding dimensions differ at index ${i}.`);
    }
    for (let column = 0; column < vec.length; column++) {
      if (typeof vec[column] !== 'number' || !Number.isFinite(vec[column])) {
        throw new Error(`[embeddings] ${label} embedding output invalid at index ${i}, element ${column} (non-finite number).`);
      }
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
  let observedDims = null;
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
    if (observedDims !== null && vectors[0].length !== observedDims) {
      throw new Error('[embeddings] grouped batch embedding dimensions changed between batches.');
    }
    observedDims = vectors[0].length;
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


