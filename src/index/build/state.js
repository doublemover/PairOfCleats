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

/**
 * Merge a shard state into the main state with doc id offsets.
 * @param {object} target
 * @param {object} source
 */
export function mergeIndexState(target, source) {
  if (!target || !source) return;
  const offset = target.chunks.length;
  const srcChunks = Array.isArray(source.chunks) ? source.chunks : [];

  for (let i = 0; i < srcChunks.length; i += 1) {
    const chunk = srcChunks[i];
    if (!chunk) continue;
    const sourceId = Number.isFinite(chunk.id) ? chunk.id : i;
    target.chunks.push({ ...chunk, id: offset + sourceId });
  }

  const mergeLengths = (dest, src) => {
    if (!Array.isArray(src)) return;
    for (let i = 0; i < src.length; i += 1) {
      dest[offset + i] = src[i];
    }
  };

  mergeLengths(target.docLengths, source.docLengths);
  if (target.fieldDocLengths && source.fieldDocLengths) {
    for (const [field, lengths] of Object.entries(source.fieldDocLengths)) {
      if (!target.fieldDocLengths[field]) target.fieldDocLengths[field] = [];
      mergeLengths(target.fieldDocLengths[field], lengths);
    }
  }
  if (Array.isArray(source.fieldTokens)) {
    mergeLengths(target.fieldTokens, source.fieldTokens);
  }

  if (source.df && typeof source.df.entries === 'function') {
    for (const [token, count] of source.df.entries()) {
      target.df.set(token, (target.df.get(token) || 0) + count);
    }
  }

  if (source.tokenPostings && typeof source.tokenPostings.entries === 'function') {
    for (const [token, postings] of source.tokenPostings.entries()) {
      let dest = target.tokenPostings.get(token);
      if (!dest) {
        dest = [];
        target.tokenPostings.set(token, dest);
      }
      for (const entry of postings || []) {
        const docId = Array.isArray(entry) ? entry[0] : null;
        const tf = Array.isArray(entry) ? entry[1] : null;
        if (!Number.isFinite(docId)) continue;
        dest.push([docId + offset, tf]);
      }
    }
  }

  if (source.fieldPostings) {
    for (const [field, postingsMap] of Object.entries(source.fieldPostings)) {
      if (!target.fieldPostings[field]) target.fieldPostings[field] = new Map();
      if (!postingsMap || typeof postingsMap.entries !== 'function') continue;
      for (const [token, postings] of postingsMap.entries()) {
        let dest = target.fieldPostings[field].get(token);
        if (!dest) {
          dest = [];
          target.fieldPostings[field].set(token, dest);
        }
        for (const entry of postings || []) {
          const docId = Array.isArray(entry) ? entry[0] : null;
          const tf = Array.isArray(entry) ? entry[1] : null;
          if (!Number.isFinite(docId)) continue;
          dest.push([docId + offset, tf]);
        }
      }
    }
  }

  if (source.phrasePost && typeof source.phrasePost.entries === 'function') {
    for (const [phrase, postingSet] of source.phrasePost.entries()) {
      let dest = target.phrasePost.get(phrase);
      if (!dest) {
        dest = new Set();
        target.phrasePost.set(phrase, dest);
      }
      for (const docId of postingSet || []) {
        if (!Number.isFinite(docId)) continue;
        dest.add(docId + offset);
      }
    }
  }

  if (source.triPost && typeof source.triPost.entries === 'function') {
    for (const [gram, postingSet] of source.triPost.entries()) {
      let dest = target.triPost.get(gram);
      if (!dest) {
        dest = new Set();
        target.triPost.set(gram, dest);
      }
      for (const docId of postingSet || []) {
        if (!Number.isFinite(docId)) continue;
        dest.add(docId + offset);
      }
    }
  }

  if (Array.isArray(source.scannedFiles)) {
    target.scannedFiles.push(...source.scannedFiles);
  }
  if (Array.isArray(source.scannedFilesTimes)) {
    target.scannedFilesTimes.push(...source.scannedFilesTimes);
  }
  if (Array.isArray(source.skippedFiles)) {
    target.skippedFiles.push(...source.skippedFiles);
  }
  if (Number.isFinite(source.totalTokens)) {
    target.totalTokens += source.totalTokens;
  }
  if (source.fileRelations && typeof source.fileRelations.entries === 'function') {
    for (const [file, relations] of source.fileRelations.entries()) {
      target.fileRelations.set(file, relations);
    }
  }
}
