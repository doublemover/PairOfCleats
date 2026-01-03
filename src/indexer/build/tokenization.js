import { SimpleMinHash } from '../minhash.js';
import { STOP, SYN } from '../constants.js';
import { extractNgrams, splitId, splitWordsWithDict, stem, tri } from '../../shared/tokenize.js';

const normalizeRange = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Build a tokenization context shared across chunks.
 * @param {{dictWords:Set<string>|string[],dictConfig:object,postingsConfig:object}} input
 * @returns {object}
 */
export function createTokenizationContext(input) {
  const dictWordsRaw = input?.dictWords || new Set();
  const dictWords = dictWordsRaw instanceof Set ? dictWordsRaw : new Set(dictWordsRaw);
  const dictConfig = input?.dictConfig || {};
  const postingsConfig = input?.postingsConfig || {};
  const phraseMinN = normalizeRange(postingsConfig.phraseMinN, 2);
  const phraseMaxN = Math.max(phraseMinN, normalizeRange(postingsConfig.phraseMaxN, 4));
  const chargramMinN = normalizeRange(postingsConfig.chargramMinN, 3);
  const chargramMaxN = Math.max(chargramMinN, normalizeRange(postingsConfig.chargramMaxN, 5));
  return {
    dictWords,
    dictConfig,
    phraseMinN,
    phraseMaxN,
    chargramMinN,
    chargramMaxN,
    phraseEnabled: postingsConfig.enablePhraseNgrams !== false,
    chargramEnabled: postingsConfig.enableChargrams !== false
  };
}

const computeTokenStats = (tokens) => {
  const freq = {};
  tokens.forEach((t) => {
    freq[t] = (freq[t] || 0) + 1;
  });
  const unique = Object.keys(freq).length;
  const counts = Object.values(freq);
  const sum = counts.reduce((a, b) => a + b, 0);
  const entropy = sum
    ? -counts.reduce((e, c) => e + (c / sum) * Math.log2(c / sum), 0)
    : 0;
  return { unique, entropy, sum };
};

/**
 * Tokenize chunk text into tokens, ngrams, chargrams, and minhash signature.
 * @param {{text:string,mode:'code'|'prose',ext:string,context:object}} input
 * @returns {{tokens:string[],seq:string[],ngrams:string[]|null,chargrams:string[]|null,minhashSig:number[],stats:object}}
 */
export function tokenizeChunkText(input) {
  const { text, mode, ext, context } = input;
  const {
    dictWords,
    dictConfig,
    phraseMinN,
    phraseMaxN,
    chargramMinN,
    chargramMaxN,
    phraseEnabled,
    chargramEnabled
  } = context;

  let tokens = splitId(text);
  tokens = tokens.map((t) => t.normalize('NFKD'));

  if (!(mode === 'prose' && ext === '.md')) {
    tokens = tokens.flatMap((t) => splitWordsWithDict(t, dictWords, dictConfig));
  }

  if (mode === 'prose') {
    tokens = tokens.filter((w) => !STOP.has(w));
    tokens = tokens.flatMap((w) => [w, stem(w)]);
  }

  const seq = [];
  for (const w of tokens) {
    seq.push(w);
    if (SYN[w]) seq.push(SYN[w]);
  }

  const ngrams = phraseEnabled ? extractNgrams(seq, phraseMinN, phraseMaxN) : null;
  let chargrams = null;
  if (chargramEnabled) {
    const charSet = new Set();
    seq.forEach((w) => {
      for (let n = chargramMinN; n <= chargramMaxN; ++n) tri(w, n).forEach((g) => charSet.add(g));
    });
    chargrams = Array.from(charSet);
  }

  const mh = new SimpleMinHash();
  tokens.forEach((t) => mh.update(t));

  return {
    tokens,
    seq,
    ngrams,
    chargrams,
    minhashSig: mh.hashValues,
    stats: computeTokenStats(tokens)
  };
}
