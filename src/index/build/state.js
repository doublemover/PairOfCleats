import { normalizePostingsConfig } from '../../shared/postings-config.js';

const DEFAULT_POSTINGS_CONFIG = normalizePostingsConfig();
const TOKEN_RETENTION_MODES = new Set(['full', 'sample', 'none']);
const POSTINGS_GUARD_SAMPLES = 5;
const POSTINGS_GUARDS = {
  phrase: { maxUnique: 1000000, maxPerChunk: 20000 },
  chargram: { maxUnique: 2000000, maxPerChunk: 50000 }
};

const createGuardEntry = (label, limits) => ({
  label,
  maxUnique: limits.maxUnique,
  maxPerChunk: limits.maxPerChunk,
  disabled: false,
  reason: null,
  dropped: 0,
  truncatedChunks: 0,
  peakUnique: 0,
  samples: []
});

const recordGuardSample = (guard, context) => {
  if (!guard || !context) return;
  if (guard.samples.length >= POSTINGS_GUARD_SAMPLES) return;
  guard.samples.push({
    file: context.file || null,
    chunkId: context.chunkId ?? null
  });
};

// Postings maps can be extremely large (especially phrase n-grams and chargrams).
// Storing posting lists as `Set`s is extremely memory-expensive when the vast
// majority of terms are singletons (df=1).
//
// We store posting lists in a compact representation:
//   - number: a single docId
//   - number[]: a list of docIds in insertion order (typically increasing)
//
// This avoids allocating one `Set` per term.
function appendDocIdToPostingsMap(map, key, docId, guard = null, context = null) {
  if (!map) return;
  const current = map.get(key);
  if (current === undefined) {
    if (guard?.maxUnique && map.size >= guard.maxUnique) {
      if (!guard.disabled) {
        guard.disabled = true;
        guard.reason = guard.reason || 'max-unique';
        recordGuardSample(guard, context);
      }
      guard.dropped += 1;
      return;
    }
    map.set(key, docId);
    if (guard) {
      guard.peakUnique = Math.max(guard.peakUnique || 0, map.size);
    }
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
function appendPhraseNgramsToPostingsMap(map, tokens, docId, minN, maxN, guard = null, context = null) {
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

  let emitted = 0;
  const maxPerChunk = guard?.maxPerChunk || 0;
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
        if (maxPerChunk && emitted >= maxPerChunk) {
          guard.truncatedChunks += 1;
          recordGuardSample(guard, context);
          return;
        }
        appendDocIdToPostingsMap(map, key, docId, guard, context);
        emitted += 1;
      }
    }
  }
}

function appendChargramsToSet(token, minN, maxN, set, maxPerChunk = 0, buffer = null) {
  if (!token) return;
  const sentinel = `\u27ec${token}\u27ed`;
  for (let n = minN; n <= maxN; n += 1) {
    if (sentinel.length < n) continue;
    if (buffer && Array.isArray(buffer)) {
      buffer.length = n;
      for (let i = 0; i < n; i += 1) buffer[i] = sentinel[i];
      let window = buffer.join('');
      set.add(window);
      if (maxPerChunk && set.size >= maxPerChunk) return;
      for (let i = n; i < sentinel.length; i += 1) {
        buffer[i % n] = sentinel[i];
        const start = (i + 1) % n;
        window = '';
        for (let j = 0; j < n; j += 1) {
          window += buffer[(start + j) % n];
        }
        set.add(window);
        if (maxPerChunk && set.size >= maxPerChunk) return;
      }
      continue;
    }
    let window = sentinel.slice(0, n);
    set.add(window);
    if (maxPerChunk && set.size >= maxPerChunk) return;
    for (let i = n; i < sentinel.length; i += 1) {
      window = window.slice(1) + sentinel[i];
      set.add(window);
      if (maxPerChunk && set.size >= maxPerChunk) return;
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
      body: new Map(),
      keyword: new Map(),
      operator: new Map(),
      literal: new Map()
    },
    docLengths: [],
    fieldDocLengths: {
      name: [],
      signature: [],
      doc: [],
      comment: [],
      body: [],
      keyword: [],
      operator: [],
      literal: []
    },
    fieldTokens: [],
    triPost: new Map(),
    phrasePost: new Map(),
    scannedFiles: [],
    scannedFilesTimes: [],
    riskSummaries: [],
    riskSummaryStats: null,
    riskSummaryTimingMs: 0,
    riskFlows: [],
    riskInterproceduralStats: null,
    riskFlowCallSiteIds: null,
    skippedFiles: [],
    totalTokens: 0,
    fileRelations: new Map(),
    fileInfoByPath: new Map(),
    vfsManifestRows: [],
    vfsManifestCollector: null,
    vfsManifestStats: null,
    importResolutionGraph: null,
    chargramBuffers: {
      set: new Set(),
      window: []
    },
    postingsGuard: {
      phrase: createGuardEntry('phrase', POSTINGS_GUARDS.phrase),
      chargram: createGuardEntry('chargram', POSTINGS_GUARDS.chargram)
    }
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
  const config = postingsConfig && typeof postingsConfig === 'object' ? postingsConfig : {};
  const tokens = Array.isArray(chunk.tokens) ? chunk.tokens : [];
  const seq = Array.isArray(chunk.seq) && chunk.seq.length ? chunk.seq : tokens;

  const phraseEnabled = config.enablePhraseNgrams !== false;
  const phraseMinRaw = Number.isFinite(config.phraseMinN)
    ? Math.max(1, Math.floor(config.phraseMinN))
    : DEFAULT_POSTINGS_CONFIG.phraseMinN;
  const phraseMaxRaw = Number.isFinite(config.phraseMaxN)
    ? Math.max(1, Math.floor(config.phraseMaxN))
    : DEFAULT_POSTINGS_CONFIG.phraseMaxN;
  const phraseMinN = phraseMinRaw <= phraseMaxRaw ? phraseMinRaw : phraseMaxRaw;
  const phraseMaxN = phraseMaxRaw >= phraseMinRaw ? phraseMaxRaw : phraseMinRaw;
  const phraseSource = config.phraseSource === 'full' ? 'full' : 'fields';

  const chargramEnabled = config.enableChargrams !== false;
  const fieldedEnabled = config.fielded !== false;
  const tokenClassificationEnabled = config.tokenClassification?.enabled === true;
  const chargramSource = config.chargramSource === 'full' ? 'full' : 'fields';
  const chargramMinRaw = Number.isFinite(config.chargramMinN)
    ? Math.max(1, Math.floor(config.chargramMinN))
    : DEFAULT_POSTINGS_CONFIG.chargramMinN;
  const chargramMaxRaw = Number.isFinite(config.chargramMaxN)
    ? Math.max(1, Math.floor(config.chargramMaxN))
    : DEFAULT_POSTINGS_CONFIG.chargramMaxN;
  const chargramMinN = chargramMinRaw <= chargramMaxRaw ? chargramMinRaw : chargramMaxRaw;
  const chargramMaxN = chargramMaxRaw >= chargramMinRaw ? chargramMaxRaw : chargramMinRaw;
  const chargramMaxTokenLength = config.chargramMaxTokenLength == null
    ? DEFAULT_POSTINGS_CONFIG.chargramMaxTokenLength
    : Math.max(2, Math.floor(Number(config.chargramMaxTokenLength)));

  state.totalTokens += seq.length;
  const chunkId = state.chunks.length;
  const guardContext = { file: chunk.file, chunkId };
  const phraseGuard = state.postingsGuard?.phrase || null;
  const chargramGuard = state.postingsGuard?.chargram || null;

  const reuseSet = state.chargramBuffers?.set || null;
  const reuseWindow = state.chargramBuffers?.window || null;
  const charSet = reuseSet || new Set();
  if (reuseSet) reuseSet.clear();
  if (chargramEnabled) {
    const maxChargramsPerChunk = chargramGuard?.maxPerChunk || 0;
    const chargrams = Array.isArray(chunk.chargrams) && chunk.chargrams.length
      ? chunk.chargrams
      : null;
    if (chargrams) {
      for (const g of chargrams) {
        if (maxChargramsPerChunk && charSet.size >= maxChargramsPerChunk) break;
        charSet.add(g);
      }
    } else {
      const addFromTokens = (tokenList) => {
        if (!Array.isArray(tokenList) || !tokenList.length) return;
        for (const w of tokenList) {
          if (chargramMaxTokenLength && w.length > chargramMaxTokenLength) continue;
          appendChargramsToSet(
            w,
            chargramMinN,
            chargramMaxN,
            charSet,
            maxChargramsPerChunk,
            reuseWindow
          );
          if (maxChargramsPerChunk && charSet.size >= maxChargramsPerChunk) return;
        }
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
      appendPhraseNgramsToPostingsMap(
        state.phrasePost,
        seq,
        chunkId,
        phraseMinN,
        phraseMaxN,
        phraseGuard,
        guardContext
      );
    } else {
      const fields = chunk.fieldTokens || {};
      // IMPORTANT: Do not fall back to the full token stream here. The entire
      // point of the field-based strategy is to keep phrase vocabulary bounded,
      // especially across many languages.
      const phraseFields = ['name', 'signature', 'doc', 'comment'];
      for (const field of phraseFields) {
        const fieldTokens = Array.isArray(fields[field]) ? fields[field] : null;
        if (!fieldTokens || !fieldTokens.length) continue;
        appendPhraseNgramsToPostingsMap(
          state.phrasePost,
          fieldTokens,
          chunkId,
          phraseMinN,
          phraseMaxN,
          phraseGuard,
          guardContext
        );
      }
    }
  }
  if (chargramEnabled) {
    const maxChargrams = chargramGuard?.maxPerChunk || 0;
    let added = 0;
    for (const tg of charSet) {
      if (maxChargrams && added >= maxChargrams) {
        if (chargramGuard) {
          chargramGuard.truncatedChunks += 1;
          recordGuardSample(chargramGuard, guardContext);
        }
        break;
      }
      appendDocIdToPostingsMap(state.triPost, tg, chunkId, chargramGuard, guardContext);
      added += 1;
    }
  }

  // NOTE: We intentionally do not maintain a separate `df` map here.
  // Document frequency can be derived from postings list lengths, and keeping
  // a second token->count map roughly doubles token-keyed memory.
  if (fieldedEnabled) {
    const fields = chunk.fieldTokens || {};
    const fieldNames = tokenClassificationEnabled
      ? ['name', 'signature', 'doc', 'comment', 'body', 'keyword', 'operator', 'literal']
      : ['name', 'signature', 'doc', 'comment', 'body'];
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
      if (field === 'body' && !tokenClassificationEnabled) {
        // Avoid retaining any additional body token material unless we need
        // identifier-only body postings for token classification weighting.
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
  if (source.fileInfoByPath && typeof source.fileInfoByPath.entries === 'function') {
    if (!target.fileInfoByPath) target.fileInfoByPath = new Map();
    for (const [file, info] of source.fileInfoByPath.entries()) {
      if (!target.fileInfoByPath.has(file)) {
        target.fileInfoByPath.set(file, info);
      }
    }
  }
  if (Array.isArray(source.vfsManifestRows)) {
    if (!Array.isArray(target.vfsManifestRows)) target.vfsManifestRows = [];
    target.vfsManifestRows.push(...source.vfsManifestRows);
  }
  if (source.vfsManifestStats && typeof source.vfsManifestStats === 'object') {
    if (!target.vfsManifestStats || typeof target.vfsManifestStats !== 'object') {
      target.vfsManifestStats = { ...source.vfsManifestStats };
    } else {
      for (const [key, value] of Object.entries(source.vfsManifestStats)) {
        if (Number.isFinite(value)) {
          target.vfsManifestStats[key] = (target.vfsManifestStats[key] || 0) + value;
        }
      }
    }
  }
}

const formatGuardSample = (sample) => {
  if (!sample) return null;
  const file = sample.file || 'unknown';
  const chunkId = Number.isFinite(sample.chunkId) ? `#${sample.chunkId}` : '';
  return `${file}${chunkId}`;
};

export function getPostingsGuardWarnings(state) {
  const guards = state?.postingsGuard;
  if (!guards) return [];
  const warnings = [];
  for (const guard of Object.values(guards)) {
    if (!guard) continue;
    const samples = (guard.samples || [])
      .map(formatGuardSample)
      .filter(Boolean);
    const sampleSuffix = samples.length ? ` Examples: ${samples.join(', ')}` : '';
    if (guard.disabled && guard.maxUnique) {
      warnings.push(
        `[postings] ${guard.label} postings capped at ${guard.maxUnique} unique terms; further entries skipped.${sampleSuffix}`
      );
    }
    if (guard.truncatedChunks && guard.maxPerChunk) {
      warnings.push(
        `[postings] ${guard.label} postings truncated for ${guard.truncatedChunks} chunk(s) (limit ${guard.maxPerChunk} per chunk).${sampleSuffix}`
      );
    }
  }
  return warnings;
}
