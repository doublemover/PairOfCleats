import { extractNgrams, tri } from '../../shared/tokenize.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';

const DEFAULT_POSTINGS_CONFIG = normalizePostingsConfig();

/**
 * Create the mutable state for index building.
 * @returns {object}
 */
export function createIndexState() {
  return {
    df: new Map(),
    chunks: [],
    tokenPostings: new Map(),
    fieldPostings: {
      name: new Map(),
      signature: new Map(),
      doc: new Map(),
      body: new Map()
    },
    docLengths: [],
    fieldDocLengths: {
      name: [],
      signature: [],
      doc: [],
      body: []
    },
    fieldTokens: [],
    triPost: new Map(),
    phrasePost: new Map(),
    scannedFiles: [],
    scannedFilesTimes: [],
    skippedFiles: [],
    totalTokens: 0,
    fileRelations: new Map()
  };
}

/**
 * Append a processed chunk into global index structures.
 * @param {object} state
 * @param {object} chunk
 */
export function appendChunk(state, chunk, postingsConfig = DEFAULT_POSTINGS_CONFIG) {
  const tokens = Array.isArray(chunk.tokens) ? chunk.tokens : [];
  const seq = Array.isArray(chunk.seq) && chunk.seq.length ? chunk.seq : tokens;
  if (!seq.length) return;

  const phraseEnabled = postingsConfig?.enablePhraseNgrams !== false;
  const chargramEnabled = postingsConfig?.enableChargrams !== false;
  const fieldedEnabled = postingsConfig?.fielded !== false;
  const chargramMaxTokenLength = postingsConfig?.chargramMaxTokenLength == null
    ? null
    : Math.max(2, Math.floor(Number(postingsConfig.chargramMaxTokenLength)));

  state.totalTokens += seq.length;
  const ngrams = phraseEnabled
    ? (Array.isArray(chunk.ngrams) && chunk.ngrams.length
      ? chunk.ngrams
      : extractNgrams(seq, postingsConfig.phraseMinN, postingsConfig.phraseMaxN))
    : [];

  const charSet = new Set();
  if (chargramEnabled) {
    const chargrams = Array.isArray(chunk.chargrams) && chunk.chargrams.length
      ? chunk.chargrams
      : null;
    if (chargrams) {
      chargrams.forEach((g) => charSet.add(g));
    } else {
      seq.forEach((w) => {
        if (chargramMaxTokenLength && w.length > chargramMaxTokenLength) return;
        for (let n = postingsConfig.chargramMinN; n <= postingsConfig.chargramMaxN; ++n) {
          tri(w, n).forEach((g) => charSet.add(g));
        }
      });
    }
  }

  const freq = {};
  tokens.forEach((t) => {
    freq[t] = (freq[t] || 0) + 1;
  });
  const chunkId = state.chunks.length;

  state.docLengths[chunkId] = tokens.length;
  for (const [tok, count] of Object.entries(freq)) {
    let postings = state.tokenPostings.get(tok);
    if (!postings) {
      postings = [];
      state.tokenPostings.set(tok, postings);
    }
    postings.push([chunkId, count]);
  }

  if (phraseEnabled) {
    for (const ng of ngrams) {
      if (!state.phrasePost.has(ng)) state.phrasePost.set(ng, new Set());
      state.phrasePost.get(ng).add(chunkId);
    }
  }
  if (chargramEnabled) {
    for (const tg of charSet) {
      if (!state.triPost.has(tg)) state.triPost.set(tg, new Set());
      state.triPost.get(tg).add(chunkId);
    }
  }

  const uniqueTokens = new Set(tokens);
  uniqueTokens.forEach((t) => state.df.set(t, (state.df.get(t) || 0) + 1));
  if (fieldedEnabled) {
    const fields = chunk.fieldTokens || {};
    const fieldNames = ['name', 'signature', 'doc', 'body'];
    for (const field of fieldNames) {
      const fieldTokens = Array.isArray(fields[field]) ? fields[field] : [];
      state.fieldDocLengths[field][chunkId] = fieldTokens.length;
      state.fieldTokens[chunkId] = state.fieldTokens[chunkId] || {};
      state.fieldTokens[chunkId][field] = fieldTokens;
      if (!fieldTokens.length) continue;
      const fieldFreq = {};
      fieldTokens.forEach((tok) => {
        fieldFreq[tok] = (fieldFreq[tok] || 0) + 1;
      });
      for (const [tok, count] of Object.entries(fieldFreq)) {
        let postings = state.fieldPostings[field].get(tok);
        if (!postings) {
          postings = [];
          state.fieldPostings[field].set(tok, postings);
        }
        postings.push([chunkId, count]);
      }
    }
  }
  chunk.id = chunkId;
  if (chunk.fieldTokens) delete chunk.fieldTokens;
  state.chunks.push(chunk);
}
