import { workerData } from 'node:worker_threads';
import util from 'node:util';
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

const normalizeEmptyMessage = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === '{}' || trimmed === '[object Object]') return null;
  if (/^Error:?\s*\{\}$/i.test(trimmed)) return null;
  if (/^Error:?\s*\[object Object\]$/i.test(trimmed)) return null;
  return value;
};

const formatWorkerError = (err, label) => {
  const name = err?.name || 'Error';
  const rawMessage = err?.message || (typeof err === 'string' ? err : null) || String(err);
  const message = normalizeEmptyMessage(rawMessage) || 'unhelpful worker error';
  const stack = typeof err?.stack === 'string' ? err.stack : '';
  let detail = '';
  if (err?.cause) {
    if (typeof err.cause === 'string') {
      detail = err.cause;
    } else if (typeof err.cause?.message === 'string') {
      detail = err.cause.message;
    } else {
      try {
        detail = JSON.stringify(err.cause);
      } catch {
        detail = String(err.cause);
      }
    }
  }
  if (!detail && err && typeof err === 'object') {
    try {
      detail = util.inspect(err, { depth: 3, breakLength: 120 });
    } catch {
      // ignore
    }
  }
  const lines = [
    `[${label}] ${name}: ${message}`,
    stack ? `Stack: ${stack}` : '',
    detail ? `Cause: ${detail}` : ''
  ].filter(Boolean);
  return new Error(lines.join('\n'));
};

const withWorkerError = (fn, label) => (input) => {
  try {
    return fn(input);
  } catch (err) {
    throw formatWorkerError(err, label);
  }
};

export const tokenizeChunk = withWorkerError(
  (input) => {
    const hasOverrides = input && (input.dictConfig || input.postingsConfig);
    const context = hasOverrides
      ? createTokenizationContext({
        dictWords,
        dictConfig: input.dictConfig || dictConfig,
        postingsConfig: input.postingsConfig || postingsConfig
      })
      : tokenContext;
    return tokenizeChunkText({ ...input, context });
  },
  'tokenizeChunk'
);

export const quantizeVectors = withWorkerError((input) => {
  const { vectors = [], minVal = -1, maxVal = 1, levels = 256 } = input || {};
  return vectors.map((vec) => quantizeVec(vec, minVal, maxVal, levels));
}, 'quantizeVectors');
