import path from 'node:path';
import { HISTORY_SEMANTIC_CHUNKER_VERSION } from './semantic-values.js';
import { getEmbeddingAdapter } from '../../shared/embedding-adapter.js';
import { EMBEDDING_GEMMA2_REVISION, resolveEmbeddingModelProfile } from '../../shared/embedding-model-profile.js';
import { digest, historyError } from './common.js';

export const ARCHIVE_EG2_MODEL = 'onnx-community/embeddinggemma-2-ONNX';
export const ARCHIVE_EG2_QUERY_PREFIX = 'task: search result | query: ';
export const ARCHIVE_EG2_PASSAGE_PREFIX = 'title: none | text: ';

/** Archive opt-in defaults are independent of ordinary code-search defaults. */
export function resolveArchiveEmbeddingOptions(options) {
  const keys = ['modelId','revision','dtype','dimensions','modelsDir','allowDownloads','batchSize','chunkChars','overlapChars','task'];
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some(key => !keys.includes(key))
    || typeof options.modelsDir !== 'string' || !path.isAbsolute(options.modelsDir)
    || (options.allowDownloads !== undefined && typeof options.allowDownloads !== 'boolean')) {
    throw historyError('ERR_INFERENCE_HISTORY_INPUT', 'Explicit archive model directory required.');
  }
  const modelId = options.modelId ?? ARCHIVE_EG2_MODEL;
  if(typeof modelId!=='string'||modelId.length<1||modelId.length>200)throw historyError('ERR_INFERENCE_HISTORY_INPUT','Invalid archive model identity.');
  const profile = resolveEmbeddingModelProfile(modelId, {
    revision: options.revision ?? EMBEDDING_GEMMA2_REVISION,
    dtype: options.dtype ?? 'fp32', dimensions: options.dimensions ?? 768
  });
  if (!profile) throw historyError('ERR_INFERENCE_HISTORY_INPUT', 'Archive embeddings require an EG2 model.');
  const batchSize = options.batchSize ?? 4, chunkChars = options.chunkChars ?? 1000;
  const overlapChars = options.overlapChars ?? 200;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 64
    || !Number.isSafeInteger(chunkChars) || chunkChars < 80 || chunkChars > 4000
    || !Number.isSafeInteger(overlapChars) || overlapChars < 0 || overlapChars >= chunkChars) {
    throw historyError('ERR_INFERENCE_HISTORY_INPUT', 'Invalid archive embedding bounds.');
  }
  const task=options.task??'search';
  const queryPrefixes={search:ARCHIVE_EG2_QUERY_PREFIX,code:'task: code retrieval | query: ','question-answering':'task: question answering | query: '};
  if(typeof task!=='string'||!Object.hasOwn(queryPrefixes,task))throw historyError('ERR_INFERENCE_HISTORY_INPUT','Archive embedding task must be search, code, or question-answering.');
  Object.freeze(profile);
  const identity = {schema:'history-eg2.v1',modelId,profile,task,
    queryPrefix:queryPrefixes[task],passagePrefix:ARCHIVE_EG2_PASSAGE_PREFIX,
    chunkChars,overlapChars,chunker:HISTORY_SEMANTIC_CHUNKER_VERSION,normalization:'truncate_then_l2'};
  return Object.freeze({ ...identity, identityKey:digest(JSON.stringify(identity)),
    modelsDir:path.resolve(options.modelsDir),localFilesOnly:options.allowDownloads !== true,batchSize });
}

export function createArchiveEmbeddingRuntime(options) {
  const config = resolveArchiveEmbeddingOptions(options);
  const adapter = getEmbeddingAdapter({
    provider:'xenova',modelId:config.modelId,modelsDir:config.modelsDir,
    modelProfile:config.profile,normalize:true,localFilesOnly:config.localFilesOnly
  });
  return Object.freeze({
    config,
    async encodeBatch(texts,{signal}={}) {
      signal?.throwIfAborted();
      let result;
      try{result=await adapter.embed(texts.map(text=>config.passagePrefix+text));}catch(error){
        if(signal?.aborted)throw signal.reason;
        throw historyError('ERR_INFERENCE_HISTORY_UNAVAILABLE','Archive EG2 encoder unavailable; provision the pinned runtime and selected model cache.');
      }
      signal?.throwIfAborted();
      return result;
    },
    async encodeQuery(query,{signal}={}) {
      signal?.throwIfAborted();
      let result;
      try{result=await adapter.embedOne(config.queryPrefix+query);}catch(error){
        if(signal?.aborted)throw signal.reason;
        throw historyError('ERR_INFERENCE_HISTORY_UNAVAILABLE','Archive EG2 encoder unavailable; provision the pinned runtime and selected model cache.');
      }
      signal?.throwIfAborted();
      return result;
    }
  });
}
