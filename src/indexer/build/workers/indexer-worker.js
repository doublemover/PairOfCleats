import { workerData } from 'node:worker_threads';
import { quantizeVec } from '../../embedding.js';
import { createTokenizationContext, tokenizeChunkText } from '../tokenization.js';

const dictWords = new Set(Array.isArray(workerData?.dictWords) ? workerData.dictWords : []);
const dictConfig = workerData?.dictConfig || {};
const postingsConfig = workerData?.postingsConfig || {};
const tokenContext = createTokenizationContext({
  dictWords,
  dictConfig,
  postingsConfig
});

export function tokenizeChunk(input) {
  return tokenizeChunkText({ ...input, context: tokenContext });
}

export function quantizeVectors(input) {
  const { vectors = [], minVal = -1, maxVal = 1, levels = 256 } = input || {};
  return vectors.map((vec) => quantizeVec(vec, minVal, maxVal, levels));
}
