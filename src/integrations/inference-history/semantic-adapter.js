import { historyError } from './common.js';
/** Trusted host owns and vets both callbacks; this is not a network/model loader. */
export function createLocalHistorySemanticAdapter({
  modelId, modelVersion, indexGenerationRef, dimensions, encodeQuery, searchIndex, rerank = null
}) {
  if (![modelId,modelVersion].every(value=>typeof value==='string' && value.length>0 && value.length<=200)
    || !/^[a-f0-9]{64}$/.test(indexGenerationRef ?? '') || !Number.isSafeInteger(dimensions)
    || dimensions<1 || dimensions>4096 || typeof encodeQuery!=='function' || typeof searchIndex!=='function'
    || (rerank!==null && typeof rerank!=='function')) throw new TypeError('Versioned local model/index callbacks required.');
  return Object.freeze({
    kind:'local',modelId,modelVersion,indexGenerationRef,dimensions,rerank,
    async search({query,top,generationRef}, {signal,reauthorize}) {
      if (generationRef!==indexGenerationRef) throw historyError('ERR_INFERENCE_HISTORY_STALE','Semantic index generation differs.');
      signal?.throwIfAborted();
      const vector = await encodeQuery(query,{signal});
      if ((!Array.isArray(vector) && !ArrayBuffer.isView(vector)) || vector.length!==dimensions
        || !Array.from(vector).every(Number.isFinite)) throw historyError('ERR_INFERENCE_HISTORY_INPUT','Invalid query embedding.');
      await reauthorize(); signal?.throwIfAborted();
      const result = await searchIndex(vector,{top,signal});
      await reauthorize(); signal?.throwIfAborted();
      if (!result || !Array.isArray(result.candidates) || result.candidates.length>top
        || typeof result.complete!=='boolean') throw historyError('ERR_INFERENCE_HISTORY_INPUT','Invalid bounded semantic result.');
      return result;
    }
  });
}
