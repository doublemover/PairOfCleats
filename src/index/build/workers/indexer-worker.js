import { MessageChannel, parentPort as nativeParentPort, threadId as nativeThreadId, workerData as nativeWorkerData } from 'node:worker_threads';
import { executeTokenizeBatch } from './tokenize-batch.js';
import { observeWorkerHeap } from '../../../shared/workers/heap-contract.js';
import { createWorkerObserver, createWorkerTaskError, withWorkerTaskObservation, WORKER_OBSERVATION_VERSION } from './observation.js';
import { installWorkerFatalPolicy } from './fatal-policy.js';
import { quantizeVec } from '../../embedding.js';
import { resolveEmbeddingQuantizationSpec } from '../../../shared/embedding-quantization-spec.js';
import {
  createTokenizationBuffers,
  createTokenizationContext,
  tokenizeChunkText
} from '../tokenization.js';
import { createSharedDictionaryView } from '../../../shared/dictionary.js';
import {
  normalizeCodeDictLanguage,
  normalizeCodeDictLanguages
} from '../../../shared/code-dictionaries.js';

const workerData = nativeWorkerData || globalThis.__indexerTaskProcessData;
const threadId = nativeParentPort ? nativeThreadId : process.pid;
const parentPort = nativeParentPort || (globalThis.__indexerTaskProcessData ? {
  postMessage: (message, onError = () => {}) => process.send?.({ ...message, generation: globalThis.__indexerTaskProcessGeneration }, onError)
} : null);
const runtimeObservation = nativeParentPort ? observeWorkerHeap() : globalThis.__indexerTaskProcessObservation;
runtimeObservation.workerAttemptId = runtimeObservation.processInstanceId;
runtimeObservation.parentAttemptId = workerData?.runtimeAttemptId || null;
runtimeObservation.buildId = workerData?.buildId || null;
// Piscina owns parentPort's incoming bootstrap protocol. Acknowledgments use
// this worker's independent bounded observation channel, including while idle.
const observationChannel = nativeParentPort ? new MessageChannel() : null;
if (observationChannel) nativeParentPort.postMessage({ type: 'indexer-observation-port',
  version: WORKER_OBSERVATION_VERSION, threadId, port: observationChannel.port2 }, [observationChannel.port2]);
const observer = createWorkerObserver({ send: (message, onError) => observationChannel
  ? observationChannel.port1.postMessage(message) : parentPort?.postMessage(message, onError) });
const acknowledge = message => observer.acknowledge(message);
if (observationChannel) {
  observationChannel.port1.on('message', acknowledge);
  observationChannel.port1.unref();
}
else if (parentPort) process.on('message', acknowledge);
const fatalPolicy = installWorkerFatalPolicy({ threadId, observer,
  send: message => parentPort?.postMessage(message) });
globalThis.__indexerWorkerPoisoned = fatalPolicy.isPoisoned;
observer.emit({ type: 'worker-runtime', threadId, observation: runtimeObservation });
if (!runtimeObservation.resourceLimitAcknowledged) {
  throw new Error('Worker V8 heap exceeds its reported resource limits; refusing work.');
}

const dictShared = createSharedDictionaryView(workerData?.dictShared);
const dictWords = dictShared || new Set(Array.isArray(workerData?.dictWords) ? workerData.dictWords : []);
const dictConfig = workerData?.dictConfig || {};
const postingsConfig = workerData?.postingsConfig || {};
const codeDictWords = new Set(Array.isArray(workerData?.codeDictWords) ? workerData.codeDictWords : []);
const codeDictWordsByLanguage = new Map();
if (workerData?.codeDictWordsByLanguage && typeof workerData.codeDictWordsByLanguage === 'object') {
  for (const [lang, words] of Object.entries(workerData.codeDictWordsByLanguage)) {
    const normalized = normalizeCodeDictLanguage(lang);
    if (!normalized) continue;
    const list = Array.isArray(words) ? words.filter((entry) => typeof entry === 'string') : [];
    if (list.length) {
      codeDictWordsByLanguage.set(normalized, new Set(list));
    }
  }
}
const codeDictLanguages = workerData?.codeDictLanguages == null
  ? null
  : normalizeCodeDictLanguages(workerData.codeDictLanguages);
const tokenContext = createTokenizationContext({
  dictWords,
  dictConfig,
  // Tree-sitter classification runs on the main thread so parser caches are not
  // multiplied by worker threads. Workers still tokenize for throughput.
  postingsConfig: {
    ...postingsConfig,
    tokenClassification: { enabled: false }
  },
  codeDictWords,
  codeDictWordsByLanguage,
  codeDictLanguages,
  treeSitter: null
});

// Reuse tokenization scratch buffers to reduce per-task allocations and GC pressure.
// Piscina runs one task at a time per worker thread, so this shared instance is safe.
const tokenBuffers = createTokenizationBuffers();

const cloneScanDefaults = { maxDepth: 4, maxItems: 40, tailItems: 3 };
const isPrimitive = (value) => value == null
  || typeof value === 'string'
  || typeof value === 'number'
  || typeof value === 'boolean'
  || typeof value === 'bigint';
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

  // Fast path: avoid copying when the array already contains only strings.
  for (let i = 0; i < value.length; i += 1) {
    if (typeof value[i] !== 'string') {
      const out = [];
      for (const entry of value) {
        if (typeof entry === 'string') out.push(entry);
      }
      return out;
    }
  }
  return value;
};

const normalizeNumberArray = (value) => {
  if (Array.isArray(value)) {
    // Fast path: avoid copying when already numeric.
    for (let i = 0; i < value.length; i += 1) {
      if (typeof value[i] !== 'number') return value.map((entry) => Number(entry));
    }
    return value;
  }
  if (ArrayBuffer.isView(value)) return Array.from(value, (entry) => Number(entry));
  return [];
};

const sanitizeTokenizeResult = (result) => {
  const stats = result && typeof result.stats === 'object' ? result.stats : {};
  const output = {
    tokens: normalizeStringArray(result?.tokens),
    tokenIds: normalizeStringArray(result?.tokenIds),
    seq: normalizeStringArray(result?.seq),
    ngrams: Array.isArray(result?.ngrams) ? normalizeStringArray(result.ngrams) : undefined,
    chargrams: Array.isArray(result?.chargrams) ? normalizeStringArray(result.chargrams) : undefined,
    minhashSig: normalizeNumberArray(result?.minhashSig),
    minhashHashIdentity: result?.minhashHashIdentity ?? null,
    stats: {
      unique: Number(stats.unique) || 0,
      entropy: Number.isFinite(Number(stats.entropy)) ? Number(stats.entropy) : 0,
      sum: Number(stats.sum) || 0
    }
  };
  if (stats.punctuation) {
    output.stats.punctuation = { limit: stats.punctuation.limit, emitted: stats.punctuation.emitted,
      truncated: stats.punctuation.truncated };
  }
  if (Array.isArray(result?.identifierTokens)) {
    output.identifierTokens = normalizeStringArray(result.identifierTokens);
  }
  if (Array.isArray(result?.keywordTokens)) {
    output.keywordTokens = normalizeStringArray(result.keywordTokens);
  }
  if (Array.isArray(result?.operatorTokens)) {
    output.operatorTokens = normalizeStringArray(result.operatorTokens);
  }
  if (Array.isArray(result?.literalTokens)) {
    output.literalTokens = normalizeStringArray(result.literalTokens);
  }
  return output;
};

const withWorkerError = (fn, label) => withWorkerTaskObservation(async input => {
  if (fatalPolicy.isPoisoned()) throw new Error('Poisoned worker cannot execute another task.');
  try {
    validateCloneable(input, label + ' payload');
    const result = await fn(input);
    if (fatalPolicy.isPoisoned()) throw new Error('Poisoned worker cannot publish a result.');
    validateCloneable(result, label + ' result');
    return result;
  } catch (error) { throw createWorkerTaskError(error, label); }
}, { observer, threadId,
  task: label.startsWith('tokenize') ? 'tokenize' : label === 'quantizeVectors' ? 'quantize' : 'analyze' });

const resolveTaskTokenContext = input => input && (input.dictConfig || input.postingsConfig)
  ? createTokenizationContext({ dictWords, dictConfig: input.dictConfig || dictConfig,
    postingsConfig: { ...(input.postingsConfig || postingsConfig), tokenClassification: { enabled: false } },
    codeDictWords, codeDictWordsByLanguage, codeDictLanguages, treeSitter: null })
  : tokenContext;
const tokenizeOne = (input, context = resolveTaskTokenContext(input)) =>
  sanitizeTokenizeResult(tokenizeChunkText({ ...input, context, buffers: tokenBuffers }));
export const tokenizeChunk = withWorkerError(tokenizeOne, 'tokenizeChunk');
export const tokenizeBatch = withWorkerError(input => {
  let context = null;
  return executeTokenizeBatch(input, item => {
    // Batch admission proves one policy; dictionary runtime is prepared only once.
    context ||= resolveTaskTokenContext(item);
    return tokenizeOne(item, context);
  });
}, 'tokenizeBatch');

// Lazy loading avoids paying compiler/lint initialization or parser-cache
// memory in token-only workers. The existing worker heap and lifecycle own it.
export const analyzeFile = withWorkerError(async input => {
  const { executeFileAnalysis } = await import('./file-analysis-task.js');
  return executeFileAnalysis(input, { dictWords, codeDictWords, codeDictWordsByLanguage, codeDictLanguages,
    backend: nativeParentPort ? 'worker' : 'process', tokenize: tokenizeOne });
}, 'analyzeFile');

export const quantizeVectors = withWorkerError((input) => {
  const { vectors = [] } = input || {};
  const spec = resolveEmbeddingQuantizationSpec(input?.quantization || input);
  return vectors.map((vec) => quantizeVec(vec, spec.minVal, spec.maxVal, spec.levels));
}, 'quantizeVectors');
