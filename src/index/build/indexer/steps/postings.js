import { log as sharedLog } from '../../../../shared/progress.js';
import { buildPostings } from '../../postings.js';
import { applyTokenRetention, appendChunk, normalizeTokenRetention } from '../../state.js';

export const createTokenRetentionState = ({ runtime, totalFiles, log = sharedLog }) => {
  const tokenizationStats = {
    chunks: 0,
    tokens: 0,
    seq: 0,
    ngrams: 0,
    chargrams: 0
  };
  const indexingConfig = runtime.userConfig?.indexing || {};
  const tokenModeRaw = indexingConfig.chunkTokenMode || 'auto';
  const tokenMode = ['auto', 'full', 'sample', 'none'].includes(tokenModeRaw)
    ? tokenModeRaw
    : 'auto';
  const tokenMaxFiles = Number.isFinite(Number(indexingConfig.chunkTokenMaxFiles))
    ? Math.max(0, Number(indexingConfig.chunkTokenMaxFiles))
    : 5000;
  const tokenMaxTotalRaw = Number(indexingConfig.chunkTokenMaxTokens);
  const tokenMaxTotal = Number.isFinite(tokenMaxTotalRaw) && tokenMaxTotalRaw > 0
    ? Math.floor(tokenMaxTotalRaw)
    : 5000000;
  const tokenSampleSize = Number.isFinite(Number(indexingConfig.chunkTokenSampleSize))
    ? Math.max(1, Math.floor(Number(indexingConfig.chunkTokenSampleSize)))
    : 32;
  const resolvedTokenMode = tokenMode === 'auto'
    ? (totalFiles <= tokenMaxFiles ? 'full' : 'sample')
    : tokenMode;
  const tokenRetention = normalizeTokenRetention({
    mode: resolvedTokenMode,
    sampleSize: tokenSampleSize
  });
  const tokenRetentionAuto = tokenMode === 'auto';
  let tokenTotal = 0;

  const applyRetentionToState = (target) => {
    if (!target?.chunks) return;
    for (const chunk of target.chunks) {
      applyTokenRetention(chunk, tokenRetention);
    }
  };

  const appendChunkWithRetention = (stateRef, chunk, mainState) => {
    const seqLen = Array.isArray(chunk.seq) && chunk.seq.length
      ? chunk.seq.length
      : (Array.isArray(chunk.tokens) ? chunk.tokens.length : 0);
    tokenTotal += seqLen;
    appendChunk(stateRef, { ...chunk }, runtime.postingsConfig, tokenRetention);
    if (tokenRetentionAuto && tokenRetention.mode === 'full'
      && tokenMaxTotal
      && tokenTotal > tokenMaxTotal) {
      tokenRetention.mode = 'sample';
      applyRetentionToState(mainState);
      if (stateRef !== mainState) applyRetentionToState(stateRef);
      log(`Chunk token mode auto -> sample (token budget ${tokenTotal} > ${tokenMaxTotal}).`);
    }
  };

  return {
    tokenizationStats,
    appendChunkWithRetention
  };
};

export const buildIndexPostings = async ({ runtime, state }) => {
  const postings = await buildPostings({
    chunks: state.chunks,
    df: state.df,
    tokenPostings: state.tokenPostings,
    docLengths: state.docLengths,
    fieldPostings: state.fieldPostings,
    fieldDocLengths: state.fieldDocLengths,
    phrasePost: state.phrasePost,
    triPost: state.triPost,
    postingsConfig: runtime.postingsConfig,
    modelId: runtime.modelId,
    useStubEmbeddings: runtime.useStubEmbeddings,
    log: sharedLog,
    workerPool: runtime.workerPool,
    quantizePool: runtime.quantizePool,
    embeddingsEnabled: runtime.embeddingEnabled
  });

  // Reduce peak memory before artifact writing.
  // Dense vectors are now quantized and stored in `postings`.
  // Keeping float embeddings on every chunk can double/triple RSS and trigger V8 OOM.
  if (Array.isArray(state?.chunks)) {
    for (const chunk of state.chunks) {
      if (!chunk || typeof chunk !== 'object') continue;
      delete chunk.embedding;
      delete chunk.embed_code;
      delete chunk.embed_doc;
    }
  }

  return postings;
};
