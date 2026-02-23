import { SimpleMinHash } from '../minhash.js';
import { STOP } from '../constants.js';
import { extractPunctuationTokens, splitId, splitWordsWithDict, stem } from '../../shared/tokenize.js';
import { hashTokenId } from '../../shared/token-id.js';
import { buildChargramHashSet } from '../../shared/chargram-hash.js';
import {
  normalizeCodeDictByLanguage,
  normalizeCodeDictLanguages,
  normalizeDictWords,
  normalizeRange,
  resolveTokenDictWords as resolveTokenDictWordsInternal
} from './tokenization/dictionary-normalization.js';
import {
  classifyTokenBucketsInternal,
  createTokenClassificationRuntime as createTokenClassificationRuntimeInternal
} from './tokenization/classification-helpers.js';
import {
  buildSequenceFromTokens,
  createFileLineTokenStreamInternal,
  sliceFileLineTokenStreamInternal
} from './tokenization/stream-helpers.js';

const normalizeToken = (value) => {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 127) return value.normalize('NFKD');
  }
  return value;
};

const PROSE_DICT_SPLIT_BYPASS_EXTS = new Set([
  '.html',
  '.htm',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.css',
  '.scss',
  '.less',
  '.map',
  '.json',
  '.jsonc',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.xml'
]);

export const createTokenClassificationRuntime = createTokenClassificationRuntimeInternal;

/**
 * Classify token list into identifier/keyword/operator/literal buckets.
 * @param {{text:string,tokens:string[],languageId?:string,ext?:string,dictWords:Set<string>|{size:number,has:function},dictConfig:object,context?:object}} input
 * @returns {{identifierTokens:string[],keywordTokens:string[],operatorTokens:string[],literalTokens:string[]}}
 */
export const classifyTokenBuckets = (input) => classifyTokenBucketsInternal(input, buildTokenSequence);

/**
 * Build a tokenization context shared across chunks.
 * @param {{dictWords:Set<string>|string[]|{size:number,has:function},dictConfig:object,postingsConfig:object}} input
 * @returns {object}
 */
export function createTokenizationContext(input) {
  const dictWords = normalizeDictWords(input?.dictWords);
  const codeDictWords = normalizeDictWords(input?.codeDictWords);
  const codeDictWordsByLanguage = normalizeCodeDictByLanguage(input?.codeDictWordsByLanguage);
  const codeDictLanguages = input?.codeDictLanguages == null
    ? null
    : normalizeCodeDictLanguages(input.codeDictLanguages);
  const dictConfig = input?.dictConfig || {};
  const postingsConfig = input?.postingsConfig || {};
  const tokenClassification = postingsConfig?.tokenClassification && typeof postingsConfig.tokenClassification === 'object'
    ? postingsConfig.tokenClassification
    : { enabled: false };
  const treeSitter = input?.treeSitter || null;
  const phraseMinN = normalizeRange(postingsConfig.phraseMinN, 2);
  const phraseMaxN = Math.max(phraseMinN, normalizeRange(postingsConfig.phraseMaxN, 4));
  const chargramMinN = normalizeRange(postingsConfig.chargramMinN, 3);
  const chargramMaxN = Math.max(chargramMinN, normalizeRange(postingsConfig.chargramMaxN, 5));
  const chargramMaxTokenLength = postingsConfig.chargramMaxTokenLength == null
    ? null
    : Math.max(2, Math.floor(Number(postingsConfig.chargramMaxTokenLength)));
  const chargramSourceRaw = typeof postingsConfig.chargramSource === 'string'
    ? postingsConfig.chargramSource.trim().toLowerCase()
    : '';
  const chargramSource = ['full', 'fields'].includes(chargramSourceRaw)
    ? chargramSourceRaw
    : 'fields';
  return {
    dictWords,
    codeDictWords,
    codeDictWordsByLanguage,
    codeDictLanguages,
    codeDictCache: new Map(),
    dictConfig,
    phraseMinN,
    phraseMaxN,
    chargramMinN,
    chargramMaxN,
    chargramMaxTokenLength,
    chargramSource,
    phraseEnabled: postingsConfig.enablePhraseNgrams !== false,
    chargramEnabled: postingsConfig.enableChargrams !== false,
    tokenClassification,
    treeSitter
  };
}

/**
 * Allocate reusable buffers for tokenization to reduce allocations.
 * @returns {{tokens:string[],seq:string[],scratch:string[],scratch2:string[],chargramSet:Set<string>,minhash:SimpleMinHash}}
 */
export function createTokenizationBuffers() {
  return {
    tokens: [],
    seq: [],
    tokenIds: [],
    scratch: [],
    scratch2: [],
    chargramSet: new Set(),
    minhash: new SimpleMinHash()
  };
}

/**
 * Resolve dictionary words for tokenization based on mode/language.
 * @param {{context:object,mode:string,languageId?:string|null}} input
 * @returns {{size:number,has:function}|Set<string>}
 */
export function resolveTokenDictWords(input) {
  return resolveTokenDictWordsInternal(input);
}

/**
 * Pre-tokenize an entire file into per-line token arrays for cheap window slicing.
 * @param {{text:string,mode:'code'|'prose',ext?:string,dictWords:Set<string>|{size:number,has:function},dictConfig:object}} input
 * @returns {{lineTokens:string[][],linePunctuationTokens:string[][]|null}}
 */
export const createFileLineTokenStream = (input) => createFileLineTokenStreamInternal(input, buildTokenSequence);

/**
 * Slice a pre-tokenized file-line stream into one chunk token payload.
 * @param {{stream:{lineTokens:string[][],linePunctuationTokens?:string[][]|null},startLine:number,endLine:number}} input
 * @returns {{tokens:string[],seq:string[]}|null}
 */
export const sliceFileLineTokenStream = (input) => sliceFileLineTokenStreamInternal(input);

/**
 * Build tokens and optional synonym-expanded sequence for indexing.
 * @param {{text:string,mode:'code'|'prose',ext?:string,dictWords:Set<string>|{size:number,has:function},dictConfig:object,buffers?:object,includeSeq?:boolean}} input
 * @returns {{tokens:string[],seq:string[]}}
 */
export function buildTokenSequence({
  text,
  mode,
  ext,
  dictWords,
  dictConfig,
  buffers = null,
  includeCodePunctuation = true,
  includeSeq = true
}) {
  const useBuffers = !!buffers;
  const tokensOut = useBuffers ? buffers.tokens : [];
  const seqOut = includeSeq ? (useBuffers ? buffers.seq : []) : null;
  const scratch = useBuffers ? buffers.scratch : [];
  const scratch2 = useBuffers ? buffers.scratch2 : [];
  if (useBuffers) {
    tokensOut.length = 0;
    if (buffers.seq) buffers.seq.length = 0;
    scratch.length = 0;
    scratch2.length = 0;
  }

  const baseTokens = splitId(text);
  for (const token of baseTokens) {
    scratch.push(normalizeToken(token));
  }
  if (mode === 'code' && includeCodePunctuation) {
    const punctuation = extractPunctuationTokens(text);
    for (const token of punctuation) scratch.push(token);
  }

  let working = scratch;
  const normalizedExt = typeof ext === 'string' ? ext.toLowerCase() : '';
  const skipDictSegmentation = mode === 'prose'
    && (normalizedExt === '.md' || PROSE_DICT_SPLIT_BYPASS_EXTS.has(normalizedExt));
  if (!skipDictSegmentation) {
    for (const token of working) {
      const parts = splitWordsWithDict(token, dictWords, dictConfig);
      if (Array.isArray(parts) && parts.length) {
        for (const part of parts) scratch2.push(part);
      }
    }
    working = scratch2;
  }

  if (mode === 'prose') {
    for (const token of working) {
      if (STOP.has(token)) continue;
      tokensOut.push(token);
      tokensOut.push(stem(token));
    }
  } else {
    for (const token of working) tokensOut.push(token);
  }

  // When buffers are supplied we still return cloned output arrays so callers
  // can retain per-chunk token lists without being mutated by the next chunk.
  const tokens = useBuffers ? tokensOut.slice() : tokensOut;
  if (!includeSeq) {
    return { tokens, seq: [] };
  }
  const seq = buildSequenceFromTokens(tokens, seqOut);
  return {
    tokens,
    seq
  };
}

/**
 * Build hashed chargrams from tokens with configurable n-gram limits.
 * @param {string[]} tokens
 * @param {{chargramMinN:number,chargramMaxN:number,chargramMaxTokenLength?:number}} options
 * @param {{chargramSet:Set<string>}|null} [buffers]
 * @returns {string[]}
 */
export function buildChargramsFromTokens(tokens, options, buffers = null) {
  const { chargramMinN, chargramMaxN, chargramMaxTokenLength } = options;
  const charSet = buildChargramHashSet(tokens, {
    minN: chargramMinN,
    maxN: chargramMaxN,
    maxTokenLength: Number.isFinite(chargramMaxTokenLength) ? chargramMaxTokenLength : null
  }, buffers);
  const out = Array.from(charSet);
  if (buffers?.chargramSet) charSet.clear();
  return out;
}

const computeTokenStats = (tokens) => {
  const freq = Object.create(null);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    freq[token] = (freq[token] || 0) + 1;
  }
  const counts = Object.values(freq);
  const unique = counts.length;
  let sum = 0;
  for (let i = 0; i < counts.length; i += 1) sum += counts[i];
  let entropy = 0;
  if (sum) {
    for (let i = 0; i < counts.length; i += 1) {
      const ratio = counts[i] / sum;
      entropy -= ratio * Math.log2(ratio);
    }
  }
  return { unique, entropy, sum };
};

/**
 * Tokenize chunk text into tokens/sequence and a minhash signature.
 *
 * NOTE: We intentionally do not materialize phrase ngrams or chargrams here. Those are
 * derived (and often very large) and should only exist as short-lived locals during
 * postings construction to avoid retaining them on chunk payloads.
 * @param {{text:string,mode:'code'|'prose',ext:string,context:object}} input
 * @returns {{tokens:string[],seq:string[],minhashSig:number[],stats:object}}
 */
export function tokenizeChunkText(input) {
  const { text, mode, ext, context, buffers = null, languageId = null, pretokenized = null } = input;
  const dictConfig = context?.dictConfig || {};
  const dictWords = resolveTokenDictWords({ context, mode, languageId });
  const providedTokens = Array.isArray(pretokenized?.tokens) ? pretokenized.tokens : null;
  const providedSeq = Array.isArray(pretokenized?.seq) ? pretokenized.seq : null;
  const { tokens, seq } = providedTokens
    ? {
      tokens: providedTokens.slice(),
      seq: providedSeq && providedSeq.length
        ? providedSeq.slice()
        : buildSequenceFromTokens(providedTokens)
    }
    : buildTokenSequence({
      text,
      mode,
      ext,
      dictWords,
      dictConfig,
      buffers
    });

  const tokenIdsOut = buffers?.tokenIds || [];
  if (buffers?.tokenIds) tokenIdsOut.length = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    tokenIdsOut.push(hashTokenId(tokens[i]));
  }
  const tokenIds = buffers?.tokenIds ? tokenIdsOut.slice() : tokenIdsOut;

  const classificationEnabled = context?.tokenClassification?.enabled === true && mode === 'code';
  const classification = classificationEnabled
    ? classifyTokenBuckets({
      text,
      tokens,
      languageId,
      ext,
      dictWords,
      dictConfig,
      context
    })
    : null;

  // Phrase ngrams and chargrams are built in appendChunk() where they can be
  // immediately consumed to update postings maps and then discarded.

  const mh = buffers?.minhash || new SimpleMinHash();
  if (buffers?.minhash) mh.reset();
  for (let i = 0; i < tokens.length; i += 1) {
    mh.update(tokens[i]);
  }

  return {
    tokens,
    seq,
    tokenIds,
    minhashSig: buffers?.minhash ? mh.hashValues.slice() : mh.hashValues,
    stats: computeTokenStats(tokens),
    ...(classification ? {
      identifierTokens: classification.identifierTokens,
      keywordTokens: classification.keywordTokens,
      operatorTokens: classification.operatorTokens,
      literalTokens: classification.literalTokens
    } : {})
  };
}
