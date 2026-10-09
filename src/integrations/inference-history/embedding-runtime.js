import path from 'node:path';
import { ARTIFACT_PROJECTION_VERSION } from './artifact-projection.js';
import { ARCHIVE_ASSET_POLICY_VERSION } from './embedded-assets.js';
import { HISTORY_SEMANTIC_CHUNKER_VERSION } from './semantic-values.js';
import { ARCHIVE_CLASSIFICATION_VERSION, ARCHIVE_CONTEXT_VERSION } from './archive-structure.js';
import { createEg2WorkerRuntime } from './eg2-worker-runtime.js';
import { normalizeEg2SessionOptions } from '../../shared/embedding-prepared.js';
import { EMBEDDING_GEMMA2_REVISION, resolveEmbeddingModelProfile } from '../../shared/embedding-model-profile.js';
import { digest, historyError } from './common.js';

export const ARCHIVE_EG2_MODEL = 'onnx-community/embeddinggemma-2-ONNX';
export const ARCHIVE_EG2_QUERY_PREFIX = 'task: search result | query: ';
export const ARCHIVE_EG2_PASSAGE_PREFIX = 'title: {context} | text: ';

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
  const documentIdentity = Object.freeze({ schema: 'history-eg2-document.v4', modelId,
    profile: fullProfile, graphSha256, modelFileName, tokenizerIdentity, numericalRecipe,
    passagePrefix: ARCHIVE_EG2_PASSAGE_PREFIX, chunkChars, overlapChars,
    projectionVersion: ARTIFACT_PROJECTION_VERSION, assetPolicy: ARCHIVE_ASSET_POLICY_VERSION, chunker: HISTORY_SEMANTIC_CHUNKER_VERSION, classification: ARCHIVE_CLASSIFICATION_VERSION, context: ARCHIVE_CONTEXT_VERSION, sourceScope: 'latest-snapshot.v1', normalization: 'full_768_l2' });
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

let workerFactory = createEg2WorkerRuntime;

/** Test transport injection; production always uses the owned child process. */
export const __setArchiveWorkerFactoryForTests = factory => {
  workerFactory = typeof factory === 'function' ? factory : createEg2WorkerRuntime;
};

export function createArchiveEmbeddingRuntime(options) {
  return workerFactory(resolveArchiveEmbeddingOptions(options));
}




