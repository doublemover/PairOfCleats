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
 * @typedef {object} BuildPostingsInput
 * @property {object[]} chunks
 * @property {Map<string, number>} df
 * @property {Map<string, Array<[number, number]>>} tokenPostings
 * @property {Map<string, string>} [tokenIdMap]
 * @property {number[]} docLengths
 * @property {Record<string, Map<string, Array<[number, number]>>>} [fieldPostings]
 * @property {Record<string, number[]>} [fieldDocLengths]
 * @property {Map<string, number[]>} [phrasePost]
 * @property {Map<string, any>|null} [phrasePostHashBuckets]
 * @property {Map<string, number[]>} [triPost]
 * @property {object} [postingsConfig]
 * @property {object|null} [postingsGuard]
 * @property {string|null} [buildRoot]
 * @property {string|null} [plannerCacheDir]
 * @property {string} [modelId]
 * @property {boolean} [useStubEmbeddings]
 * @property {(message: string) => void} [log]
 * @property {object} [workerPool]
 * @property {object} [quantizePool]
 * @property {boolean} [embeddingsEnabled=true]
 * @property {boolean} [sparsePostingsEnabled=true]
 * @property {string|null} [buildStage]
 */

/**
 * @typedef {object} BuildPostingsResult
 * @property {number} k1
 * @property {number} b
 * @property {number} avgChunkLen
 * @property {number} totalDocs
 * @property {object|null} fieldPostings
 * @property {string[]} phraseVocab
 * @property {number[][]} phrasePostings
 * @property {string[]} chargramVocab
 * @property {number[][]} chargramPostings
 * @property {object|null} chargramStats
 * @property {string[]} tokenVocab
 * @property {Array<string|number>|null} tokenVocabIds
 * @property {Array<Array<[number, number]>>} tokenPostingsList
 * @property {number} avgDocLen
 * @property {unknown[]} minhashSigs
 * @property {boolean} minhashStream
 * @property {object|null} minhashGuard
 * @property {number} dims
 * @property {Array<Uint8Array|number[]>} quantizedVectors
 * @property {Array<Uint8Array|number[]>} quantizedDocVectors
 * @property {Array<Uint8Array|number[]>} quantizedCodeVectors
 * @property {{ phrase: object|null, chargram: object|null }} [postingsMergeStats]
 */

/**
 * Build all postings/vector artifacts required by Stage 2 index output.
 *
 * The function centralizes:
 * - sparse token/field/phrase/chargram postings assembly,
 * - configurable spill/merge behavior for high-cardinality postings,
 * - dense vector quantization and minhash gating.
 *
 * @param {BuildPostingsInput} input
 * @returns {Promise<BuildPostingsResult>}
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
  const config = (postingsConfig && typeof postingsConfig === 'object') ? postingsConfig : {};
  const readNonNegativeInt = (key, fallback = 0) => resolvePositiveInt(config[key], fallback, 0);
  const minhashMaxDocs = readNonNegativeInt('minhashMaxDocs', 0);
  const minhashStream = config.minhashStream !== false;
  const phraseSpillMaxBytes = readNonNegativeInt('phraseSpillMaxBytes', 0);
  const phraseSpillMaxUnique = readNonNegativeInt(
    'phraseSpillMaxUnique',
    DEFAULT_PHRASE_SPILL_MAX_UNIQUE
  );
  const chargramSpillMaxBytes = readNonNegativeInt('chargramSpillMaxBytes', 0);
  const fieldedEnabled = resolvedConfig.fielded !== false;
  const phraseHashEnabled = resolvedConfig.phraseHash === true;
  /**
   * Build an empty-but-shaped field postings object for zero-document runs.
   *
   * @returns {{ fields: Record<string, {
   *   vocab: string[],
   *   postings: any[],
   *   docLengths: number[],
   *   avgDocLen: number,
   *   totalDocs: number
   * }> }|null}
   */
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

  const { mergeSpillRuns } = createSpillHelpers({
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
