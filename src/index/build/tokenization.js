import { SimpleMinHash } from '../minhash.js';
import { STOP, SYN } from '../constants.js';
import { extractNgrams, extractPunctuationTokens, splitId, splitWordsWithDict, stem, tri } from '../../shared/tokenize.js';

const normalizeRange = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Build a tokenization context shared across chunks.
 * @param {{dictWords:Set<string>|string[]|{size:number,has:function},dictConfig:object,postingsConfig:object}} input
 * @returns {object}
 */
export function createTokenizationContext(input) {
  const dictWordsRaw = input?.dictWords || new Set();
  let dictWords = null;
  if (dictWordsRaw && typeof dictWordsRaw.has === 'function' && typeof dictWordsRaw.size === 'number') {
    dictWords = dictWordsRaw;
  } else if (dictWordsRaw instanceof Set) {
    dictWords = dictWordsRaw;
  } else if (Array.isArray(dictWordsRaw)) {
    dictWords = new Set(dictWordsRaw);
  } else {
    dictWords = new Set();
  }
  const dictConfig = input?.dictConfig || {};
  const postingsConfig = input?.postingsConfig || {};
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
    dictConfig,
    phraseMinN,
    phraseMaxN,
    chargramMinN,
    chargramMaxN,
    chargramMaxTokenLength,
    chargramSource,
    phraseEnabled: postingsConfig.enablePhraseNgrams !== false,
    chargramEnabled: postingsConfig.enableChargrams !== false
  };
}

export function createTokenizationBuffers() {
  return {
    tokens: [],
    seq: [],
    scratch: [],
    scratch2: [],
    chargramSet: new Set(),
    minhash: new SimpleMinHash()
  };
}

const normalizeToken = (value) => {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 127) return value.normalize('NFKD');
  }
  return value;
};

export function buildTokenSequence({ text, mode, ext, dictWords, dictConfig, buffers = null }) {
  const useBuffers = !!buffers;
  const tokensOut = useBuffers ? buffers.tokens : [];
  const seqOut = useBuffers ? buffers.seq : [];
  const scratch = useBuffers ? buffers.scratch : [];
  const scratch2 = useBuffers ? buffers.scratch2 : [];
  if (useBuffers) {
    tokensOut.length = 0;
    seqOut.length = 0;
    scratch.length = 0;
    scratch2.length = 0;
  }

  const baseTokens = splitId(text);
  for (const token of baseTokens) {
    scratch.push(normalizeToken(token));
  }
  if (mode === 'code') {
    const punctuation = extractPunctuationTokens(text);
    for (const token of punctuation) scratch.push(token);
  }

  let working = scratch;
  if (!(mode === 'prose' && ext === '.md')) {
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

  for (const w of tokensOut) {
    seqOut.push(w);
    if (SYN[w]) seqOut.push(SYN[w]);
  }

  return {
    tokens: useBuffers ? tokensOut.slice() : tokensOut,
    seq: useBuffers ? seqOut.slice() : seqOut
  };
}

export function buildChargramsFromTokens(tokens, options, buffers = null) {
  const { chargramMinN, chargramMaxN, chargramMaxTokenLength } = options;
  const charSet = buffers?.chargramSet || new Set();
  if (buffers?.chargramSet) {
    charSet.clear();
  }
  const maxLen = Number.isFinite(chargramMaxTokenLength) ? chargramMaxTokenLength : null;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (maxLen && token.length > maxLen) continue;
    for (let n = chargramMinN; n <= chargramMaxN; ++n) {
      tri(token, n).forEach((g) => charSet.add(g));
    }
  }
  const out = Array.from(charSet);
  if (buffers?.chargramSet) {
    charSet.clear();
  }
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
 * Tokenize chunk text into tokens, ngrams, chargrams, and minhash signature.
 * @param {{text:string,mode:'code'|'prose',ext:string,context:object}} input
 * @returns {{tokens:string[],seq:string[],ngrams:string[]|null,chargrams:string[]|null,minhashSig:number[],stats:object}}
 */
export function tokenizeChunkText(input) {
  const { text, mode, ext, context, buffers = null } = input;
  const {
    dictWords,
    dictConfig,
    phraseMinN,
    phraseMaxN,
    chargramMinN,
    chargramMaxN,
    chargramMaxTokenLength,
    phraseEnabled,
    chargramEnabled
  } = context;

  const { tokens, seq } = buildTokenSequence({
    text,
    mode,
    ext,
    dictWords,
    dictConfig,
    buffers
  });

  const ngrams = phraseEnabled ? extractNgrams(seq, phraseMinN, phraseMaxN) : null;
  let chargrams = null;
  if (chargramEnabled) {
    const sourceTokens = Array.isArray(input.chargramTokens) && input.chargramTokens.length
      ? input.chargramTokens
      : seq;
    chargrams = buildChargramsFromTokens(sourceTokens, {
      chargramMinN,
      chargramMaxN,
      chargramMaxTokenLength
    }, buffers);
  }

  const mh = buffers?.minhash || new SimpleMinHash();
  if (buffers?.minhash) mh.reset();
  for (let i = 0; i < tokens.length; i += 1) {
    mh.update(tokens[i]);
  }

  return {
    tokens,
    seq,
    ngrams,
    chargrams,
    minhashSig: buffers?.minhash ? mh.hashValues.slice() : mh.hashValues,
    stats: computeTokenStats(tokens)
  };
}
