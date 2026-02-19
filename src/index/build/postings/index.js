import { DEFAULT_STUB_DIMS } from '../../../shared/embedding.js';
import { normalizePostingsConfig } from '../../../shared/postings-config.js';
import {
  DEFAULT_COOPERATIVE_YIELD_EVERY,
  DEFAULT_COOPERATIVE_YIELD_MIN_INTERVAL_MS,
  DEFAULT_PHRASE_SPILL_MAX_UNIQUE,
  createCooperativeYield,
  resolvePositiveInt,
  resolveTokenCount,
  tuneBM25Params
} from './constants.js';
import { buildDenseVectors } from './dense-vectors.js';
import { resolveMinhashOutputs } from './minhash.js';
import { normalizeTfPostingList } from './id-lists.js';
import { buildPhraseAndChargramPostings } from './phrase-chargram.js';
import { createSpillHelpers, compareChargramRows } from './spill.js';
import { buildTokenAndFieldPostings } from './token-field.js';

/**
 * Build postings and vector artifacts for the index.
 *
 * @param {{
 *   chunks: object[],
 *   df: Map<string, number>,
 *   tokenPostings: Map<string, Array<[number, number]>>,
 *   tokenIdMap?: Map<string, string>,
 *   docLengths: number[],
 *   fieldPostings?: object,
 *   fieldDocLengths?: object,
 *   phrasePost?: Map<string, number[]>,
 *   phrasePostHashBuckets?: Map<string, number[]>|null,
 *   triPost?: Map<string, number[]>,
 *   postingsConfig?: object,
 *   postingsGuard?: object|null,
 *   buildRoot?: string|null,
 *   plannerCacheDir?: string|null,
 *   modelId?: string,
 *   useStubEmbeddings?: boolean,
 *   log?: (message:string)=>void,
 *   workerPool?: object,
 *   quantizePool?: object,
 *   embeddingsEnabled?: boolean,
 *   buildStage?: string|null
 * }} input
 * @returns {object}
 */
export async function buildPostings(input) {
  const {
    chunks,
    df,
    tokenPostings,
    tokenIdMap,
    docLengths,
    fieldPostings,
    fieldDocLengths,
    phrasePost,
    phrasePostHashBuckets = null,
    triPost,
    postingsConfig,
    postingsGuard = null,
    buildRoot = null,
    plannerCacheDir = null,
    modelId,
    useStubEmbeddings,
    log,
    workerPool,
    quantizePool,
    embeddingsEnabled = true,
    sparsePostingsEnabled = true,
    buildStage = null
  } = input;
  void df;
  const sparseEnabled = sparsePostingsEnabled !== false;

  const normalizedDocLengths = Array.isArray(docLengths)
    ? docLengths.map((len) => (Number.isFinite(len) ? len : 0))
    : [];

  const resolvedConfig = normalizePostingsConfig(postingsConfig || {});
  const cooperativeYieldEvery = resolvePositiveInt(
    postingsConfig?.cooperativeYieldEvery,
    DEFAULT_COOPERATIVE_YIELD_EVERY,
    128
  );
  const cooperativeYieldMinIntervalMs = resolvePositiveInt(
    postingsConfig?.cooperativeYieldMinIntervalMs,
    DEFAULT_COOPERATIVE_YIELD_MIN_INTERVAL_MS,
    25
  );
  const requestYield = createCooperativeYield({
    every: cooperativeYieldEvery,
    minIntervalMs: cooperativeYieldMinIntervalMs
  });
  const minhashMaxDocsRaw = postingsConfig && typeof postingsConfig === 'object'
    ? Number(postingsConfig.minhashMaxDocs)
    : NaN;
  const minhashMaxDocs = Number.isFinite(minhashMaxDocsRaw)
    ? Math.max(0, Math.floor(minhashMaxDocsRaw))
    : 0;
  const minhashStream = !(postingsConfig && typeof postingsConfig === 'object')
    || postingsConfig.minhashStream !== false;
  const phraseSpillMaxBytesRaw = postingsConfig && typeof postingsConfig === 'object'
    ? Number(postingsConfig.phraseSpillMaxBytes)
    : NaN;
  const phraseSpillMaxBytes = Number.isFinite(phraseSpillMaxBytesRaw)
    ? Math.max(0, Math.floor(phraseSpillMaxBytesRaw))
    : 0;
  const phraseSpillMaxUniqueRaw = postingsConfig && typeof postingsConfig === 'object'
    ? Number(postingsConfig.phraseSpillMaxUnique)
    : NaN;
  const phraseSpillMaxUnique = Number.isFinite(phraseSpillMaxUniqueRaw)
    ? Math.max(0, Math.floor(phraseSpillMaxUniqueRaw))
    : DEFAULT_PHRASE_SPILL_MAX_UNIQUE;
  const chargramSpillMaxBytesRaw = postingsConfig && typeof postingsConfig === 'object'
    ? Number(postingsConfig.chargramSpillMaxBytes)
    : NaN;
  const chargramSpillMaxBytes = Number.isFinite(chargramSpillMaxBytesRaw)
    ? Math.max(0, Math.floor(chargramSpillMaxBytesRaw))
    : 0;
  const fieldedEnabled = resolvedConfig.fielded !== false;
  const phraseHashEnabled = resolvedConfig.phraseHash === true;
  const buildEmptyFieldPostings = () => {
    if (!fieldedEnabled) return null;
    const fields = {};
    const fieldNames = new Set();
    if (fieldPostings && typeof fieldPostings === 'object') {
      Object.keys(fieldPostings).forEach((field) => fieldNames.add(field));
    }
    if (fieldDocLengths && typeof fieldDocLengths === 'object') {
      Object.keys(fieldDocLengths).forEach((field) => fieldNames.add(field));
    }
    if (!fieldNames.size) {
      ['name', 'signature', 'doc', 'comment', 'body'].forEach((field) => fieldNames.add(field));
    }
    for (const field of fieldNames) {
      const lengths = Array.isArray(fieldDocLengths?.[field])
        ? fieldDocLengths[field].map((len) => (Number.isFinite(len) ? len : 0))
        : [];
      fields[field] = {
        vocab: [],
        postings: [],
        docLengths: lengths,
        avgDocLen: 0,
        totalDocs: lengths.length
      };
    }
    return { fields };
  };

  if (!Array.isArray(chunks) || chunks.length === 0) {
    return {
      k1: 1.2,
      b: 0.75,
      avgChunkLen: 0,
      totalDocs: 0,
      fieldPostings: buildEmptyFieldPostings(),
      phraseVocab: [],
      phrasePostings: [],
      chargramVocab: [],
      chargramPostings: [],
      tokenVocab: [],
      tokenVocabIds: [],
      tokenPostingsList: [],
      avgDocLen: 0,
      minhashSigs: [],
      minhashStream: false,
      minhashGuard: null,
      dims: embeddingsEnabled ? DEFAULT_STUB_DIMS : 0,
      quantizedVectors: [],
      quantizedDocVectors: [],
      quantizedCodeVectors: []
    };
  }

  const phraseEnabled = sparseEnabled && resolvedConfig.enablePhraseNgrams !== false;
  const chargramEnabled = sparseEnabled && resolvedConfig.enableChargrams !== false;
  const chargramSpillMaxUnique = Number.isFinite(resolvedConfig.chargramSpillMaxUnique)
    ? Math.max(0, Math.floor(resolvedConfig.chargramSpillMaxUnique))
    : 0;
  const chargramMaxDf = Number.isFinite(resolvedConfig.chargramMaxDf)
    ? Math.max(0, Math.floor(resolvedConfig.chargramMaxDf))
    : 0;

  const { k1, b } = tuneBM25Params(chunks);
  const N = chunks.length;
  const avgChunkLen = chunks.reduce((sum, c) => sum + resolveTokenCount(c), 0) / Math.max(N, 1);

  const {
    mergeSpillRuns,
    shouldSpillByBytes
  } = createSpillHelpers({
    buildRoot,
    plannerCacheDir,
    requestYield
  });

  const {
    dims,
    quantizedVectors,
    quantizedDocVectors,
    quantizedCodeVectors
  } = await buildDenseVectors({
    chunks,
    embeddingsEnabled,
    useStubEmbeddings,
    modelId,
    log,
    workerPool,
    quantizePool,
    requestYield,
    buildStage
  });

  const {
    phraseVocab,
    phrasePostings,
    chargramVocab,
    chargramPostings,
    chargramStats,
    postingsMergeStats
  } = await buildPhraseAndChargramPostings({
    phraseEnabled,
    chargramEnabled,
    phraseHashEnabled,
    phrasePostHashBuckets,
    phrasePost,
    triPost,
    tokenIdMap,
    buildRoot,
    phraseSpillMaxBytes,
    phraseSpillMaxUnique,
    chargramSpillMaxBytes,
    chargramSpillMaxUnique,
    chargramMaxDf,
    postingsGuard,
    requestYield,
    mergeSpillRuns,
    shouldSpillByBytes,
    compareChargramRows
  });

  const {
    tokenVocab,
    tokenVocabIds,
    tokenPostingsList,
    avgDocLen,
    fieldPostingsResult
  } = await buildTokenAndFieldPostings({
    sparseEnabled,
    tokenPostings,
    tokenIdMap,
    fieldPostings,
    fieldDocLengths,
    normalizedDocLengths,
    requestYield,
    normalizeTfPostingList
  });

  const {
    allowMinhash,
    minhashSigs,
    minhashGuard
  } = resolveMinhashOutputs({
    sparseEnabled,
    minhashMaxDocs,
    minhashStream,
    chunks,
    log
  });

  return {
    k1,
    b,
    avgChunkLen,
    totalDocs: N,
    fieldPostings: fieldPostingsResult,
    phraseVocab,
    phrasePostings,
    chargramVocab,
    chargramPostings,
    chargramStats,
    tokenVocab,
    tokenVocabIds,
    tokenPostingsList,
    avgDocLen,
    minhashSigs,
    minhashStream: allowMinhash && minhashStream,
    minhashGuard,
    dims,
    quantizedVectors,
    quantizedDocVectors,
    quantizedCodeVectors,
    postingsMergeStats
  };
}
