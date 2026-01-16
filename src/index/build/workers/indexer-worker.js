import { parentPort, threadId, workerData } from 'node:worker_threads';
import util from 'node:util';
import { quantizeVec } from '../../embedding.js';
import { createTokenizationContext, tokenizeChunkText } from '../tokenization.js';
import { createSharedDictionaryView } from '../../../shared/dictionary.js';

const dictShared = createSharedDictionaryView(workerData?.dictShared);
const dictWords = dictShared || new Set(Array.isArray(workerData?.dictWords) ? workerData.dictWords : []);
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

const cloneScanDefaults = { maxDepth: 4, maxItems: 40, tailItems: 3 };
const cloneScanCrash = { maxDepth: 6, maxItems: 80, tailItems: 6 };
const isPrimitive = (value) => value == null
  || typeof value === 'string'
  || typeof value === 'number'
  || typeof value === 'boolean'
  || typeof value === 'bigint';
const isCloneError = (err) => err?.name === 'DataCloneError'
  || /could not be cloned|DataCloneError/i.test(err?.message || '');
const isTypedArray = (value) => ArrayBuffer.isView(value);
const findNonCloneable = (value, path = '$', depth = 0, limits = cloneScanDefaults, seen = new Set()) => {
  if (typeof value === 'function') {
    return { path, type: 'function', name: value.name || 'anonymous' };
  }
  if (typeof value === 'symbol') {
    return { path, type: 'symbol', name: value.description || value.toString() };
  }
  if (isPrimitive(value)) return null;
  if (!value || typeof value !== 'object') return null;
  if (seen.has(value)) return null;
  if (depth >= limits.maxDepth) return null;
  seen.add(value);
  if (isTypedArray(value) || value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) return null;
  const tag = Object.prototype.toString.call(value);
  if (tag === '[object Promise]') return { path, type: 'promise' };
  if (tag === '[object WeakMap]') return { path, type: 'weakmap' };
  if (tag === '[object WeakSet]') return { path, type: 'weakset' };
  if (tag === '[object WeakRef]') return { path, type: 'weakref' };
  if (tag === '[object Date]' || tag === '[object RegExp]' || tag === '[object URL]' || tag === '[object Error]') {
    return null;
  }
  if (Array.isArray(value)) {
    const limit = Math.min(value.length, limits.maxItems);
    for (let i = 0; i < limit; i += 1) {
      const entry = value[i];
      if (typeof entry === 'function' || typeof entry === 'symbol' || (entry && typeof entry === 'object')) {
        const issue = findNonCloneable(entry, `${path}[${i}]`, depth + 1, limits, seen);
        if (issue) return issue;
      }
    }
    if (value.length > limit) {
      const tailStart = Math.max(limit, value.length - limits.tailItems);
      for (let i = tailStart; i < value.length; i += 1) {
        const entry = value[i];
        if (typeof entry === 'function' || typeof entry === 'symbol' || (entry && typeof entry === 'object')) {
          const issue = findNonCloneable(entry, `${path}[${i}]`, depth + 1, limits, seen);
          if (issue) return issue;
        }
      }
    }
    return null;
  }
  if (tag === '[object Map]') {
    let idx = 0;
    for (const [key, val] of value.entries()) {
      if (idx >= limits.maxItems) break;
      const keyIssue = findNonCloneable(key, `${path}.<mapKey:${idx}>`, depth + 1, limits, seen);
      if (keyIssue) return keyIssue;
      const valueIssue = findNonCloneable(val, `${path}.<mapValue:${idx}>`, depth + 1, limits, seen);
      if (valueIssue) return valueIssue;
      idx += 1;
    }
    return null;
  }
  if (tag === '[object Set]') {
    let idx = 0;
    for (const entry of value.values()) {
      if (idx >= limits.maxItems) break;
      const issue = findNonCloneable(entry, `${path}.<set:${idx}>`, depth + 1, limits, seen);
      if (issue) return issue;
      idx += 1;
    }
    return null;
  }
  const keys = Object.keys(value);
  for (let i = 0; i < Math.min(keys.length, limits.maxItems); i += 1) {
    const key = keys[i];
    const issue = findNonCloneable(value[key], `${path}.${key}`, depth + 1, limits, seen);
    if (issue) return issue;
  }
  const symbols = Object.getOwnPropertySymbols(value);
  for (let i = 0; i < Math.min(symbols.length, limits.maxItems); i += 1) {
    const sym = symbols[i];
    const issue = findNonCloneable(value[sym], `${path}[${sym.toString()}]`, depth + 1, limits, seen);
    if (issue) return issue;
  }
  return null;
};

const validateCloneable = (value, label) => {
  const issue = findNonCloneable(value, '$', 0, cloneScanDefaults, new Set());
  if (!issue) return;
  const detail = issue.name ? `${issue.type} (${issue.name})` : issue.type;
  throw new Error(`[${label}] non-cloneable ${detail} at ${issue.path}`);
};

const normalizeStringArray = (value) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    if (typeof entry === 'string') out.push(entry);
  }
  return out;
};

const normalizeNumberArray = (value) => {
  if (Array.isArray(value)) return value.map((entry) => Number(entry));
  if (ArrayBuffer.isView(value)) return Array.from(value, (entry) => Number(entry));
  return [];
};

const sanitizeTokenizeResult = (result) => {
  const stats = result && typeof result.stats === 'object' ? result.stats : {};
  return {
    tokens: normalizeStringArray(result?.tokens),
    seq: normalizeStringArray(result?.seq),
    ngrams: Array.isArray(result?.ngrams) ? normalizeStringArray(result.ngrams) : null,
    chargrams: Array.isArray(result?.chargrams) ? normalizeStringArray(result.chargrams) : null,
    minhashSig: normalizeNumberArray(result?.minhashSig),
    stats: {
      unique: Number(stats.unique) || 0,
      entropy: Number.isFinite(Number(stats.entropy)) ? Number(stats.entropy) : 0,
      sum: Number(stats.sum) || 0
    }
  };
};

const reportTiming = (label, startedAt, status) => {
  if (!parentPort) return;
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  parentPort.postMessage({
    type: 'worker-task',
    task: label === 'tokenizeChunk' ? 'tokenize' : 'quantize',
    threadId,
    durationMs,
    status
  });
};

const reportWorkerCrash = (err, label, meta = null) => {
  if (!parentPort) return;
  const message = err?.message || (typeof err === 'string' ? err : null);
  const stack = typeof err?.stack === 'string' ? err.stack : null;
  const cause = err?.cause
    ? (err.cause?.stack || err.cause?.message || util.inspect(err.cause, { depth: 4, breakLength: 120 }))
    : null;
  parentPort.postMessage({
    type: 'worker-crash',
    label,
    threadId,
    name: err?.name || 'Error',
    message,
    stack,
    cause,
    raw: util.inspect(err, { depth: 5, breakLength: 120, showHidden: true, getters: true }),
    task: meta?.task || null,
    stage: meta?.stage || null,
    cloneIssue: meta?.cloneIssue || null
  });
};

process.on('uncaughtException', (err) => {
  const cloneIssue = isCloneError(err)
    ? findNonCloneable(lastStage === 'result' ? lastResult : lastPayload, '$', 0, cloneScanCrash, new Set())
    : null;
  reportWorkerCrash(err, 'uncaughtException', {
    task: lastTask,
    stage: lastStage,
    cloneIssue
  });
});

process.on('unhandledRejection', (reason) => {
  if (reason instanceof Error) {
    const cloneIssue = isCloneError(reason)
      ? findNonCloneable(lastStage === 'result' ? lastResult : lastPayload, '$', 0, cloneScanCrash, new Set())
      : null;
    reportWorkerCrash(reason, 'unhandledRejection', {
      task: lastTask,
      stage: lastStage,
      cloneIssue
    });
  } else {
    const wrapped = new Error(
      typeof reason === 'string'
        ? reason
        : util.inspect(reason, { depth: 4, breakLength: 120, showHidden: true, getters: true })
    );
    const cloneIssue = isCloneError(wrapped)
      ? findNonCloneable(lastStage === 'result' ? lastResult : lastPayload, '$', 0, cloneScanCrash, new Set())
      : null;
    reportWorkerCrash(wrapped, 'unhandledRejection', {
      task: lastTask,
      stage: lastStage,
      cloneIssue
    });
  }
});

let lastTask = null;
let lastStage = null;
let lastPayload = null;
let lastResult = null;

const withWorkerError = (fn, label) => (input) => {
  const startedAt = process.hrtime.bigint();
  lastTask = label;
  lastStage = 'payload';
  lastPayload = input;
  lastResult = null;

  try {
    validateCloneable(input, `${label} payload`);
    const result = fn(input);
    lastStage = 'result';
    lastResult = result;
    validateCloneable(result, `${label} result`);
    reportTiming(label, startedAt, 'ok');
    return result;
  } catch (err) {
    reportTiming(label, startedAt, 'error');
    throw formatWorkerError(err, label);
  } finally {
    // Avoid retaining references to large payloads/results between tasks.
    // These are only needed for crash diagnostics.
    lastPayload = null;
    lastResult = null;
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
    const result = tokenizeChunkText({ ...input, context });
    return sanitizeTokenizeResult(result);
  },
  'tokenizeChunk'
);

export const quantizeVectors = withWorkerError((input) => {
  const { vectors = [], minVal = -1, maxVal = 1, levels = 256 } = input || {};
  return vectors.map((vec) => quantizeVec(vec, minVal, maxVal, levels));
}, 'quantizeVectors');
