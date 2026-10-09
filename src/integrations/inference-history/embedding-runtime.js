import path from 'node:path';
import { HISTORY_SEMANTIC_CHUNKER_VERSION, normalizeHistoryVector } from './semantic-values.js';
import { getEmbeddingAdapter } from '../../shared/embedding-adapter.js';
import { normalizeEg2SessionOptions } from '../../shared/embedding-prepared.js';
import { EMBEDDING_GEMMA2_REVISION, resolveEmbeddingModelProfile } from '../../shared/embedding-model-profile.js';
import { digest, historyError } from './common.js';

export const ARCHIVE_EG2_MODEL = 'onnx-community/embeddinggemma-2-ONNX';
export const ARCHIVE_EG2_QUERY_PREFIX = 'task: search result | query: ';
export const ARCHIVE_EG2_PASSAGE_PREFIX = 'title: none | text: ';

const invalid = message => historyError('ERR_INFERENCE_HISTORY_INPUT', message);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

/** Document computation, query policy and vector representation have independent identities. */
export function resolveArchiveEmbeddingOptions(options) {
  const keys = ['modelId', 'revision', 'dtype', 'dimensions', 'modelsDir', 'allowDownloads',
    'batchSize', 'chunkChars', 'overlapChars', 'task', 'sessionOptions', 'graphSha256',
    'tokenizerIdentity', 'numericalRecipe', 'modelFileName', 'lookahead', 'maxPaddedTokens', 'maxAttentionTokens', 'maxCacheInputs', 'maxCacheBytes'];
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some(key => !keys.includes(key))
    || typeof options.modelsDir !== 'string' || !path.isAbsolute(options.modelsDir)
    || (options.allowDownloads !== undefined && typeof options.allowDownloads !== 'boolean')) {
    throw invalid('Explicit archive model directory required.');
  }
  const modelId = options.modelId ?? ARCHIVE_EG2_MODEL;
  if (typeof modelId !== 'string' || modelId.length < 1 || modelId.length > 200) {
    throw invalid('Invalid archive model identity.');
  }
  const profile = resolveEmbeddingModelProfile(modelId, {
    revision: options.revision ?? EMBEDDING_GEMMA2_REVISION,
    dtype: options.dtype ?? 'fp32', dimensions: options.dimensions ?? 768
  });
  if (!profile) throw invalid('Archive embeddings require an EG2 model.');
  const batchSize = options.batchSize ?? 4, chunkChars = options.chunkChars ?? 1000;
  const overlapChars = options.overlapChars ?? 200;
  const lookahead = options.lookahead ?? Math.min(256, batchSize * 8);
  const maxPaddedTokens = options.maxPaddedTokens ?? 32768;
  const maxAttentionTokens = options.maxAttentionTokens ?? 67108864;
  const maxCacheInputs = options.maxCacheInputs ?? 1000000;
  const maxCacheBytes = options.maxCacheBytes ?? 8589934592;
  if (!integer(batchSize, 1, 64) || !integer(chunkChars, 80, 4000)
    || !integer(overlapChars, 0, chunkChars - 1) || !integer(lookahead, batchSize, 256)
    || !integer(maxPaddedTokens, 1, 524288)
    || !integer(maxAttentionTokens, 1, 4294967296)
    || !integer(maxCacheInputs, 1, 10000000)
    || !integer(maxCacheBytes, 3072, 68719476736)) {
    throw invalid('Invalid archive embedding bounds.');
  }
  const task = options.task ?? 'search';
  const queryPrefixes = { search: ARCHIVE_EG2_QUERY_PREFIX,
    code: 'task: code retrieval | query: ',
    'question-answering': 'task: question answering | query: ' };
  if (typeof task !== 'string' || !Object.hasOwn(queryPrefixes, task)) {
    throw invalid('Archive embedding task must be search, code, or question-answering.');
  }
  const graphSha256 = options.graphSha256 ?? null;
  if (graphSha256 !== null && (typeof graphSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(graphSha256))) {
    throw invalid('Trial graph identity must be a SHA256.');
  }
  const modelFileName = options.modelFileName ?? null;
  if (modelFileName !== null && (typeof modelFileName !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(modelFileName) || graphSha256 === null)) throw invalid('Custom graph file requires a verified graph SHA256.');
  const tokenizerIdentity = options.tokenizerIdentity ?? modelId + '@' + profile.revision;
  const numericalRecipe = options.numericalRecipe ?? 'published-' + profile.dtype;
  if (typeof tokenizerIdentity !== 'string' || tokenizerIdentity.length < 1 || tokenizerIdentity.length > 512
    || typeof numericalRecipe !== 'string' || numericalRecipe.length < 1 || numericalRecipe.length > 200
    || (numericalRecipe !== 'published-' + profile.dtype && graphSha256 === null)) {
    throw invalid('Explicit transformed graph identity required for an alternate numerical recipe.');
  }
  let sessionOptions;
  try { sessionOptions = normalizeEg2SessionOptions(options.sessionOptions); }
  catch { throw invalid('Invalid CPU archive session options.'); }
  const fullProfile = Object.freeze({ ...profile, dimensions: 768 });
  Object.freeze(profile);
  const documentIdentity = Object.freeze({ schema: 'history-eg2-document.v2', modelId,
    profile: fullProfile, graphSha256, modelFileName, tokenizerIdentity, numericalRecipe,
    passagePrefix: ARCHIVE_EG2_PASSAGE_PREFIX, chunkChars, overlapChars,
    chunker: HISTORY_SEMANTIC_CHUNKER_VERSION, normalization: 'full_768_l2' });
  const documentIdentityKey = digest(JSON.stringify(documentIdentity));
  const queryIdentity = Object.freeze({ schema: 'history-eg2-query.v2', documentIdentityKey,
    task, queryPrefix: queryPrefixes[task] });
  const representationIdentity = Object.freeze({ schema: 'history-eg2-representation.v2',
    documentIdentityKey, dimensions: profile.dimensions, encoding: 'float32le', normalization: 'truncate_then_l2' });
  return Object.freeze({ schema: 'history-eg2.v2', modelId, profile, fullProfile, fullDimensions: 768,
    task, queryPrefix: queryPrefixes[task], passagePrefix: ARCHIVE_EG2_PASSAGE_PREFIX,
    chunkChars, overlapChars, chunker: HISTORY_SEMANTIC_CHUNKER_VERSION,
    normalization: 'truncate_then_l2', documentIdentity, documentIdentityKey,
    queryIdentity, queryIdentityKey: digest(JSON.stringify(queryIdentity)),
    representationIdentity, representationIdentityKey: digest(JSON.stringify(representationIdentity)),
    identityKey: documentIdentityKey, modelsDir: path.resolve(options.modelsDir),
    localFilesOnly: options.allowDownloads !== true, batchSize, lookahead,
    maxPaddedTokens, maxAttentionTokens, maxCacheInputs, maxCacheBytes, sessionOptions, modelFileName });
}

export function createArchiveEmbeddingRuntime(options) {
  const config = resolveArchiveEmbeddingOptions(options);
  const adapter = getEmbeddingAdapter({
    provider: 'xenova', modelId: config.modelId, modelsDir: config.modelsDir,
    modelProfile: config.fullProfile, normalize: true, localFilesOnly: config.localFilesOnly,
    sessionOptions: config.sessionOptions, modelFileName: config.modelFileName
  });
  let active = null;
  const effectiveInput = text => config.passagePrefix + text;
  const invoke = async (callback, signal) => {
    signal?.throwIfAborted();
    if (active) throw historyError('ERR_INFERENCE_HISTORY_LIMIT',
      'Native embedding work remains unsettled; no new submission is admitted.');
    const promise = Promise.resolve().then(callback);
    active = promise;
    try {
      const result = await promise;
      signal?.throwIfAborted();
      return result;
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error.code === 'ERR_INFERENCE_HISTORY_LIMIT') throw error;
      throw historyError('ERR_INFERENCE_HISTORY_UNAVAILABLE',
        'Archive EG2 encoder unavailable; inspect the pinned runtime and selected model cache.');
    } finally { if (active === promise) active = null; }
  };
  return Object.freeze({
    config, effectiveInput,
    async prepareBatch(texts, { signal } = {}) {
      signal?.throwIfAborted();
      if (typeof adapter.prepare !== 'function') {
        throw historyError('ERR_INFERENCE_HISTORY_UNAVAILABLE', 'Prepared EG2 tokenizer unavailable.');
      }
      const prepared = await adapter.prepare(texts.map(effectiveInput));
      signal?.throwIfAborted();
      return prepared;
    },
    encodePrepared(prepared, { signal } = {}) {
      return invoke(() => adapter.embedPrepared(prepared), signal);
    },
    encodeBatch(texts, { signal } = {}) {
      return invoke(() => adapter.embed(texts.map(effectiveInput)), signal);
    },
    async encodeQuery(query, { signal } = {}) {
      const vector = await invoke(() => adapter.embedOne(config.queryPrefix + query), signal);
      return normalizeHistoryVector(Array.from(vector).slice(0, config.profile.dimensions),
        config.profile.dimensions);
    },
    executionInfo() {
      return { ...adapter.executionInfo?.(), cpuOnly: true, activeNativeCalls: active ? 1 : 0,
        documentIdentityKey: config.documentIdentityKey, queryIdentityKey: config.queryIdentityKey,
        representationIdentityKey: config.representationIdentityKey };
    },
    waitForIdle() { return active ? Promise.allSettled([active]) : Promise.resolve(); },
    endProfiling() { return adapter.endProfiling?.(); }
  });
}
