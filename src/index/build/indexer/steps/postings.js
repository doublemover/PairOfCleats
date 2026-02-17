import { log as sharedLog } from '../../../../shared/progress.js';
import { buildPostings } from '../../postings.js';
import {
  applyTokenRetention,
  appendChunk,
  enforceTokenIdCollisionPolicy,
  getPostingsGuardWarnings,
  normalizeTokenRetention
} from '../../state.js';
import { quantizeVecUint8 } from '../../../embedding.js';
import { isVectorLike } from '../../../../shared/embedding-utils.js';
import { INDEX_PROFILE_VECTOR_ONLY } from '../../../../contracts/index-profile.js';

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

  // Shared empty vector marker used to represent missing doc embeddings without
  // allocating a new empty TypedArray for every chunk.
  const EMPTY_U8 = new Uint8Array(0);

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
    const chunkCopy = { ...chunk };
    // Early quantization: keep uint8 vectors in-memory and drop float embeddings.
    // Float embeddings on every chunk are one of the largest retained heap consumers
    // during indexing (especially with many languages / chunk counts), and they are
    // not needed once we have the uint8 representation.
    if (runtime.embeddingEnabled && chunkCopy && typeof chunkCopy === 'object') {
      // If a cached bundle already includes pre-quantized vectors (e.g. from a
      // prior run or a cross-file bundle rewrite), coerce them back into Uint8Array
      // instances so we don't lose dense vectors when building postings.
      const isU8View = (v) => !!(
        v && typeof v === 'object'
        && typeof v.length === 'number'
        && ArrayBuffer.isView(v)
        && !(v instanceof DataView)
        && v.BYTES_PER_ELEMENT === 1
        && !(typeof Buffer !== 'undefined' && Buffer.isBuffer(v))
      );

      const coerceU8 = (v, { allowEmptyMarker = false } = {}) => {
        if (isU8View(v)) return v.length ? v : (allowEmptyMarker ? EMPTY_U8 : null);
        if (Array.isArray(v)) {
          if (v.length === 0) return allowEmptyMarker ? EMPTY_U8 : null;
          return Uint8Array.from(v);
        }
        return null;
      };

      const existingMergedU8 = coerceU8(chunkCopy.embedding_u8);
      // Doc vectors may intentionally use an empty marker to mean "no doc".
      const existingDocU8 = coerceU8(chunkCopy.embed_doc_u8, { allowEmptyMarker: true });
      const existingCodeU8 = coerceU8(chunkCopy.embed_code_u8);

      if (existingMergedU8) {
        chunkCopy.embedding_u8 = existingMergedU8;

        // Preserve dense-vector mode semantics:
        // - doc vectors: explicit empty marker => zero-vector during postings build
        // - code vectors: when missing, fall back to merged
        if (existingDocU8 !== null) {
          chunkCopy.embed_doc_u8 = existingDocU8;
        } else {
          const rawDoc = chunkCopy.embed_doc;
          const hasDoc = isVectorLike(rawDoc) && rawDoc.length;
          chunkCopy.embed_doc_u8 = hasDoc ? quantizeVecUint8(rawDoc) : EMPTY_U8;
        }

        if (existingCodeU8) {
          chunkCopy.embed_code_u8 = existingCodeU8;
        } else {
          const rawCode = chunkCopy.embed_code;
          const hasCode = isVectorLike(rawCode) && rawCode.length;
          chunkCopy.embed_code_u8 = hasCode ? quantizeVecUint8(rawCode) : existingMergedU8;
        }
      } else {
        // Early quantization: keep uint8 vectors in-memory and drop float embeddings.
        // Float embeddings on every chunk are one of the largest retained heap consumers
        // during indexing (especially with many languages / chunk counts), and they are
        // not needed once we have the uint8 representation.
        const merged = chunkCopy.embedding;
        const hasMerged = isVectorLike(merged) && merged.length;
        if (hasMerged) {
          const mergedU8 = quantizeVecUint8(merged);
          chunkCopy.embedding_u8 = mergedU8;

          const rawDoc = chunkCopy.embed_doc;
          const rawCode = chunkCopy.embed_code;
          const hasDoc = isVectorLike(rawDoc) && rawDoc.length;
          const hasCode = isVectorLike(rawCode) && rawCode.length;

          // Preserve dense-vector mode semantics:
          // - doc vectors: an empty marker means "no doc", which the postings builder
          //   will treat as a zero-vector (so doc-only search doesn't surface code-only chunks).
          // - code vectors: when missing, fall back to the merged vector.
          chunkCopy.embed_doc_u8 = hasDoc ? quantizeVecUint8(rawDoc) : EMPTY_U8;
          chunkCopy.embed_code_u8 = hasCode ? quantizeVecUint8(rawCode) : mergedU8;
        }
      }

      // Always drop floats if present; the bundle cache may still retain them.
      delete chunkCopy.embedding;
      delete chunkCopy.embed_doc;
      delete chunkCopy.embed_code;
    }
    appendChunk(stateRef, chunkCopy, runtime.postingsConfig, tokenRetention);
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
  const vectorOnlyProfile = runtime?.profile?.id === INDEX_PROFILE_VECTOR_ONLY;
  if (vectorOnlyProfile && runtime?.embeddingEnabled !== true && runtime?.embeddingService !== true) {
    throw new Error(
      'indexing.profile=vector_only requires embeddings to be available during index build. '
      + 'Enable inline/stub embeddings or service-mode embedding queueing and rebuild.'
    );
  }
  enforceTokenIdCollisionPolicy(state);
  const postings = await buildPostings({
    chunks: state.chunks,
    df: state.df,
    tokenPostings: state.tokenPostings,
    tokenIdMap: state.tokenIdMap,
    docLengths: state.docLengths,
    fieldPostings: state.fieldPostings,
    fieldDocLengths: state.fieldDocLengths,
    phrasePost: state.phrasePost,
    phrasePostHashBuckets: state.phrasePostHashBuckets,
    triPost: state.triPost,
    postingsConfig: runtime.postingsConfig,
    postingsGuard: state.postingsGuard,
    buildRoot: runtime.buildRoot,
    modelId: runtime.modelId,
    useStubEmbeddings: runtime.useStubEmbeddings,
    log: sharedLog,
    workerPool: runtime.workerPool,
    quantizePool: runtime.quantizePool,
    embeddingsEnabled: runtime.embeddingEnabled,
    buildStage: runtime.stage
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

  const guardWarnings = getPostingsGuardWarnings(state);
  for (const warning of guardWarnings) {
    sharedLog(warning);
  }
  if (state?.tokenPostings?.clear) state.tokenPostings.clear();
  if (state?.phrasePost?.clear) state.phrasePost.clear();
  if (state?.phrasePostHashBuckets?.clear) state.phrasePostHashBuckets.clear();
  if (state?.triPost?.clear) state.triPost.clear();
  if (state?.fieldPostings?.clear) state.fieldPostings.clear();
  if (state?.df?.clear) state.df.clear();

  if (vectorOnlyProfile) {
    postings.tokenVocab = [];
    postings.tokenVocabIds = [];
    postings.tokenPostingsList = [];
    postings.phraseVocab = [];
    postings.phrasePostings = [];
    postings.chargramVocab = [];
    postings.chargramPostings = [];
    postings.fieldPostings = null;
    postings.minhashSigs = [];
    postings.minhashStream = false;
  }

  return postings;
};
