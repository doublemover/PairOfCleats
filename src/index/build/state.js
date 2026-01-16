import { tri } from '../../shared/tokenize.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';

const DEFAULT_POSTINGS_CONFIG = normalizePostingsConfig();
const TOKEN_RETENTION_MODES = new Set(['full', 'sample', 'none']);

// Postings maps can be extremely large (especially phrase n-grams and chargrams).
// Storing posting lists as `Set`s is extremely memory-expensive when the vast
// majority of terms are singletons (df=1).
//
// We store posting lists in a compact representation:
//   - number: a single docId
//   - number[]: a list of docIds in insertion order (typically increasing)
//
// This avoids allocating one `Set` per term.
function appendDocIdToPostingsMap(map, key, docId) {
  if (!map) return;
  const current = map.get(key);
  if (current === undefined) {
    map.set(key, docId);
    return;
  }
  if (typeof current === 'number') {
    if (current !== docId) map.set(key, [current, docId]);
    return;
  }
  if (Array.isArray(current)) {
    const last = current[current.length - 1];
    if (last !== docId) current.push(docId);
    return;
  }
  // Back-compat: if older states used Sets, continue supporting them.
  if (current && typeof current.add === 'function') {
    current.add(docId);
  }
}

/**
 * Appends phrase n-grams for a token sequence to a postings map without
 * materializing the full n-gram array.
 *
 * This significantly reduces transient allocation pressure compared to
 * `extractNgrams(...)`, especially for long token sequences.
 */
function appendPhraseNgramsToPostingsMap(map, tokens, docId, minN, maxN) {
  if (!map) return;
  if (!Array.isArray(tokens) || tokens.length === 0) return;
  const min = Number.isFinite(minN) ? minN : 2;
  const max = Number.isFinite(maxN) ? maxN : 4;
  if (min < 1 || max < min) return;

  const len = tokens.length;
  // For very short token sequences, nothing to do.
  if (len < min) return;

  const sep = '\u0001';
  const maxSpan = Math.min(max, len);

  for (let i = 0; i < len; i += 1) {
    // Build incrementally: token[i], token[i]␁token[i+1], ...
    let key = '';
    for (let n = 1; n <= maxSpan; n += 1) {
      const j = i + n - 1;
      if (j >= len) break;
      const tok = tokens[j];
      if (tok == null || tok === '') {
        // Reset on empty tokens so we don't emit malformed n-grams.
        key = '';
        continue;
      }
      key = key ? `${key}${sep}${tok}` : String(tok);
      if (n >= min) {
        appendDocIdToPostingsMap(map, key, docId);
      }
    }
  }
}

function *iteratePostingDocIds(posting) {
  if (posting == null) return;
  if (typeof posting === 'number') {
    yield posting;
    return;
  }
  if (Array.isArray(posting)) {
    for (const id of posting) yield id;
    return;
  }
  if (typeof posting[Symbol.iterator] === 'function') {
    // eslint-disable-next-line no-restricted-syntax
    for (const id of posting) yield id;
  }
}

export function normalizeTokenRetention(raw = {}) {
  if (!raw || typeof raw !== 'object') {
    return { mode: 'full', sampleSize: 32 };
  }
  const modeRaw = typeof raw.mode === 'string' ? raw.mode.trim().toLowerCase() : 'full';
  const mode = TOKEN_RETENTION_MODES.has(modeRaw) ? modeRaw : 'full';
  const sampleSize = Number.isFinite(Number(raw.sampleSize))
    ? Math.max(1, Math.floor(Number(raw.sampleSize)))
    : 32;
  return { mode, sampleSize };
}

export function applyTokenRetention(chunk, retention) {
  if (!chunk || !retention || retention.mode === 'full') return;
  if (retention.mode === 'none') {
    if (chunk.tokens) delete chunk.tokens;
    if (chunk.ngrams) delete chunk.ngrams;
    return;
  }
  if (retention.mode === 'sample') {
    if (Array.isArray(chunk.tokens) && chunk.tokens.length > retention.sampleSize) {
      chunk.tokens = chunk.tokens.slice(0, retention.sampleSize);
    }
    if (Array.isArray(chunk.ngrams) && chunk.ngrams.length > retention.sampleSize) {
      chunk.ngrams = chunk.ngrams.slice(0, retention.sampleSize);
    }
  }
}

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
      comment: new Map(),
      body: new Map()
    },
    docLengths: [],
    fieldDocLengths: {
      name: [],
      signature: [],
      doc: [],
      comment: [],
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
export function appendChunk(
  state,
  chunk,
  postingsConfig = DEFAULT_POSTINGS_CONFIG,
  tokenRetention = null
) {
  const tokens = Array.isArray(chunk.tokens) ? chunk.tokens : [];
  const seq = Array.isArray(chunk.seq) && chunk.seq.length ? chunk.seq : tokens;
  if (!seq.length) return;

  const phraseEnabled = postingsConfig?.enablePhraseNgrams !== false;
  const phraseMinN = Number.isFinite(postingsConfig?.phraseMinN)
    ? postingsConfig.phraseMinN
    : 2;
  const phraseMaxN = Number.isFinite(postingsConfig?.phraseMaxN)
    ? postingsConfig.phraseMaxN
    : 4;
  const phraseSource = postingsConfig?.phraseSource === 'full' ? 'full' : 'fields';

  const chargramEnabled = postingsConfig?.enableChargrams !== false;
  const fieldedEnabled = postingsConfig?.fielded !== false;
  const chargramSource = postingsConfig?.chargramSource === 'full' ? 'full' : 'fields';
  const chargramMaxTokenLength = postingsConfig?.chargramMaxTokenLength == null
    ? null
    : Math.max(2, Math.floor(Number(postingsConfig.chargramMaxTokenLength)));

  state.totalTokens += seq.length;

  const charSet = new Set();
  if (chargramEnabled) {
    const chargrams = Array.isArray(chunk.chargrams) && chunk.chargrams.length
      ? chunk.chargrams
      : null;
    if (chargrams) {
      chargrams.forEach((g) => charSet.add(g));
    } else {
      const addFromTokens = (tokenList) => {
        if (!Array.isArray(tokenList) || !tokenList.length) return;
        tokenList.forEach((w) => {
          if (chargramMaxTokenLength && w.length > chargramMaxTokenLength) return;
          for (let n = postingsConfig.chargramMinN; n <= postingsConfig.chargramMaxN; ++n) {
            tri(w, n).forEach((g) => charSet.add(g));
          }
        });
      };

      if (chargramSource === 'fields' && chunk.fieldTokens && typeof chunk.fieldTokens === 'object') {
        const fields = chunk.fieldTokens;
        // Historically we derived chargrams from "field" text (name + doc). Doing so
        // keeps the chargram vocab bounded even when indexing many languages.
        addFromTokens(fields.name);
        addFromTokens(fields.doc);
        if (!charSet.size) {
          // Intentionally emit no chargrams when no field tokens exist.
          // Falling back to the full token stream defeats the purpose of
          // bounding the chargram vocabulary and can create extremely large
          // postings maps in multi-language repos.
        }
      } else {
        addFromTokens(seq);
      }
    }
  }

  const freq = new Map();
  tokens.forEach((t) => {
    freq.set(t, (freq.get(t) || 0) + 1);
  });
  const chunkId = state.chunks.length;

  state.docLengths[chunkId] = tokens.length;
  for (const [tok, count] of freq.entries()) {
    let postings = state.tokenPostings.get(tok);
    if (!postings) {
      postings = [];
      state.tokenPostings.set(tok, postings);
    }
    postings.push([chunkId, count]);
  }

  if (phraseEnabled) {
    if (phraseSource === 'full') {
      appendPhraseNgramsToPostingsMap(state.phrasePost, seq, chunkId, phraseMinN, phraseMaxN);
    } else {
      const fields = chunk.fieldTokens || {};
      // IMPORTANT: Do not fall back to the full token stream here. The entire
      // point of the field-based strategy is to keep phrase vocabulary bounded,
      // especially across many languages.
      const phraseFields = ['name', 'signature', 'doc', 'comment'];
      for (const field of phraseFields) {
        const fieldTokens = Array.isArray(fields[field]) ? fields[field] : null;
        if (!fieldTokens || !fieldTokens.length) continue;
        appendPhraseNgramsToPostingsMap(state.phrasePost, fieldTokens, chunkId, phraseMinN, phraseMaxN);
      }
    }
  }
  if (chargramEnabled) {
    for (const tg of charSet) {
      appendDocIdToPostingsMap(state.triPost, tg, chunkId);
    }
  }

  // NOTE: We intentionally do not maintain a separate `df` map here.
  // Document frequency can be derived from postings list lengths, and keeping
  // a second token->count map roughly doubles token-keyed memory.
  if (fieldedEnabled) {
    const fields = chunk.fieldTokens || {};
    const fieldNames = ['name', 'signature', 'doc', 'comment', 'body'];
    const fieldTokenSampleSize = Number.isFinite(Number(tokenRetention?.sampleSize))
      ? Math.max(1, Math.floor(Number(tokenRetention.sampleSize)))
      : 32;
    // Ensure a schema-valid object exists for each chunk (avoid array holes -> nulls).
    state.fieldTokens[chunkId] = state.fieldTokens[chunkId] || {};
    for (const field of fieldNames) {
      const fieldTokens = Array.isArray(fields[field]) ? fields[field] : [];
      state.fieldDocLengths[field][chunkId] = fieldTokens.length;

      // Always sample what we retain in-memory.
      if (fieldTokens.length <= fieldTokenSampleSize) {
        state.fieldTokens[chunkId][field] = fieldTokens;
      } else {
        state.fieldTokens[chunkId][field] = fieldTokens.slice(0, fieldTokenSampleSize);
      }

      // IMPORTANT:
      // - The unfielded token index already covers the chunk body.
      // - Building a second "body" postings map roughly doubles memory usage.
      // Treat "body" as an alias of the unfielded index at query time.
      if (field === 'body') {
        // Avoid retaining any additional body token material.
        state.fieldTokens[chunkId][field] = [];
        continue;
      }

      if (!fieldTokens.length) continue;
      const fieldFreq = new Map();
      fieldTokens.forEach((tok) => {
        fieldFreq.set(tok, (fieldFreq.get(tok) || 0) + 1);
      });
      for (const [tok, count] of fieldFreq.entries()) {
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
  chunk.tokenCount = tokens.length;
  const commentMeta = chunk.docmeta?.comments;
  if (Array.isArray(commentMeta)) {
    for (const entry of commentMeta) {
      if (!entry || entry.anchorChunkId != null) continue;
      entry.anchorChunkId = chunkId;
    }
  }
  applyTokenRetention(chunk, tokenRetention);
  if (chunk.seq) delete chunk.seq;
  if (chunk.chargrams) delete chunk.chargrams;
  if (chunk.fieldTokens) delete chunk.fieldTokens;
  // Phrase postings are authoritative; do not retain per-chunk n-grams in meta.
  if (chunk.ngrams) delete chunk.ngrams;
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
    for (const [phrase, posting] of source.phrasePost.entries()) {
      for (const docId of iteratePostingDocIds(posting)) {
        if (!Number.isFinite(docId)) continue;
        appendDocIdToPostingsMap(target.phrasePost, phrase, docId + offset);
      }
    }
  }

  if (source.triPost && typeof source.triPost.entries === 'function') {
    for (const [gram, posting] of source.triPost.entries()) {
      for (const docId of iteratePostingDocIds(posting)) {
        if (!Number.isFinite(docId)) continue;
        appendDocIdToPostingsMap(target.triPost, gram, docId + offset);
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
