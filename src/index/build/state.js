import { normalizePostingsConfig } from '../../shared/postings-config.js';
import { registerTokenIdInvariant } from '../../shared/invariants.js';
import { isLexiconStopword } from '../../lang/lexicon/index.js';
import { createTypedTokenPostingMap } from '../../shared/token-id.js';
import { shouldSkipPhrasePostingsForChunk } from './state/phrase-postings.js';
import { normalizeTokenRetention, applyTokenRetention } from './state/token-retention.js';
import {
  ALLOWED_CHARGRAM_FIELDS,
  appendDocIdToPostingsMap,
  appendPhraseNgramsToHashBuckets,
  appendPhraseNgramsToPostingsMap,
  appendChargramsToSet
} from './state/postings-helpers.js';
import {
  POSTINGS_GUARDS,
  createGuardEntry,
  getPostingsGuardWarnings,
  recordGuardSample,
  resolveGuardMaxPerChunk,
  resolvePostingsGuardTier
} from './state/postings-guards.js';
import {
  mergeCompactPostingsMapWithOffset,
  mergeFrequencyPostingsMapWithOffset,
  mergeLengthsWithOffset
} from './state/merge-helpers.js';

const DEFAULT_POSTINGS_CONFIG = normalizePostingsConfig();
const TOKEN_ID_COLLISION_SAMPLE_SIZE = 5;

export { shouldSkipPhrasePostingsForChunk };
export { normalizeTokenRetention, applyTokenRetention };
export { getPostingsGuardWarnings };

/**
 * Create the mutable state for index building.
 * @returns {object}
 */
export function createIndexState(options = {}) {
  const postingsConfig = normalizePostingsConfig(options?.postingsConfig || {});
  const useTypedTokenPostings = postingsConfig.typed === true;
  return {
    df: new Map(),
    chunks: [],
    tokenPostings: useTypedTokenPostings ? createTypedTokenPostingMap() : new Map(),
    tokenIdMap: new Map(),
    tokenIdCollisions: [],
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
    phrasePostHashBuckets: new Map(),
    phrasePostHashUnique: 0,
    phraseHashStats: {
      collisions: 0,
      buckets: 0
    },
    discoveredFiles: [],
    discoveryHash: null,
    fileListHash: null,
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
    lexiconRelationFilterByFile: new Map(),
    fileInfoByPath: new Map(),
    fileDetailsByPath: new Map(),
    chunkUidToFile: new Map(),
    vfsManifestRows: [],
    vfsManifestCollector: null,
    vfsManifestStats: null,
    importResolutionGraph: null,
    chargramBuffers: {
      set: new Set(),
      window: []
    },
    tokenBuffers: {
      freq: new Map(),
      fieldFreq: new Map()
    },
    postingsQueueStats: null,
    postingsGuard: {
      phrase: createGuardEntry('phrase', POSTINGS_GUARDS.phrase),
      chargram: createGuardEntry('chargram', POSTINGS_GUARDS.chargram)
    },
    features: {
      postingsTyped: useTypedTokenPostings
    }
  };
}

const normalizeTokenIdCollisionSample = (entry) => ({
  id: entry?.id || null,
  existing: entry?.existing || null,
  token: entry?.token || null
});

export const getTokenIdCollisionSummary = (
  state,
  { sampleSize = TOKEN_ID_COLLISION_SAMPLE_SIZE } = {}
) => {
  const collisions = Array.isArray(state?.tokenIdCollisions) ? state.tokenIdCollisions : [];
  const resolvedSampleSize = Number.isFinite(Number(sampleSize))
    ? Math.max(0, Math.floor(Number(sampleSize)))
    : TOKEN_ID_COLLISION_SAMPLE_SIZE;
  const sample = collisions
    .slice(0, resolvedSampleSize || 0)
    .map((entry) => normalizeTokenIdCollisionSample(entry));
  return {
    policy: 'fail',
    count: collisions.length,
    sample
  };
};

export const enforceTokenIdCollisionPolicy = (
  state,
  { sampleSize = TOKEN_ID_COLLISION_SAMPLE_SIZE } = {}
) => {
  const summary = getTokenIdCollisionSummary(state, { sampleSize });
  if (!summary.count) return summary;
  const sampleText = summary.sample
    .map((entry) => `${entry.id}:${entry.existing}->${entry.token}`)
    .join(', ');
  const suffix = sampleText ? ` Samples: ${sampleText}` : '';
  const err = new Error(`ERR_TOKEN_ID_COLLISION tokenId collisions detected (${summary.count}).${suffix}`);
  err.code = 'ERR_TOKEN_ID_COLLISION';
  err.count = summary.count;
  err.collisions = summary.sample;
  throw err;
};

/**
 * Append a processed chunk into global index structures.
 * @param {object} state
 * @param {object} chunk
 * @param {object} [postingsConfig=DEFAULT_POSTINGS_CONFIG]
 * @param {object|null} [tokenRetention=null]
 * @param {{sparsePostingsEnabled?:boolean}|null} [options=null]
 * When `sparsePostingsEnabled=false`, sparse postings/token statistics are
 * intentionally skipped (vector-only profile), while chunk/token payloads are
 * still retained for downstream filtering/query-AST matching.
 */
export function appendChunk(
  state,
  chunk,
  postingsConfig = DEFAULT_POSTINGS_CONFIG,
  tokenRetention = null,
  options = null
) {
  const config = postingsConfig && typeof postingsConfig === 'object' ? postingsConfig : {};
  const sparseEnabled = options?.sparsePostingsEnabled !== false;
  const tokens = Array.isArray(chunk.tokens) ? chunk.tokens : [];
  const tokenIds = Array.isArray(chunk.tokenIds) ? chunk.tokenIds : null;
  const useTokenIds = tokenIds && tokenIds.length === tokens.length;
  const tokenKeys = useTokenIds ? tokenIds : tokens;
  const seq = Array.isArray(chunk.seq) && chunk.seq.length ? chunk.seq : tokens;

  const phraseEnabled = sparseEnabled && config.enablePhraseNgrams !== false;
  const phraseMinRaw = Number.isFinite(config.phraseMinN)
    ? Math.max(1, Math.floor(config.phraseMinN))
    : DEFAULT_POSTINGS_CONFIG.phraseMinN;
  const phraseMaxRaw = Number.isFinite(config.phraseMaxN)
    ? Math.max(1, Math.floor(config.phraseMaxN))
    : DEFAULT_POSTINGS_CONFIG.phraseMaxN;
  const phraseMinN = phraseMinRaw <= phraseMaxRaw ? phraseMinRaw : phraseMaxRaw;
  const phraseMaxN = phraseMaxRaw >= phraseMinRaw ? phraseMaxRaw : phraseMinRaw;
  const phraseSource = config.phraseSource === 'full' ? 'full' : 'fields';
  const phraseHashEnabled = config.phraseHash === true
    && phraseSource === 'full'
    && useTokenIds
    && state?.phrasePostHashBuckets
    && typeof state.phrasePostHashBuckets.set === 'function';

  const chargramEnabled = sparseEnabled && config.enableChargrams !== false;
  const fieldedEnabled = sparseEnabled && config.fielded !== false;
  const tokenClassificationEnabled = sparseEnabled && config.tokenClassification?.enabled === true;
  const chargramSource = config.chargramSource === 'full' ? 'full' : 'fields';
  const chargramStopwords = config.chargramStopwords === true;
  const chargramFieldsRaw = Array.isArray(config.chargramFields)
    ? config.chargramFields
    : [];
  const chargramFields = [];
  for (const entry of chargramFieldsRaw) {
    if (typeof entry !== 'string') continue;
    const normalized = entry.trim().toLowerCase();
    if (!normalized || !ALLOWED_CHARGRAM_FIELDS.has(normalized)) continue;
    if (chargramFields.includes(normalized)) continue;
    chargramFields.push(normalized);
  }
  if (!chargramFields.length) {
    chargramFields.push('name', 'doc');
  }
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
  const chunkFile = typeof chunk?.file === 'string'
    ? chunk.file
    : (typeof chunk?.metaV2?.file === 'string' ? chunk.metaV2.file : null);
  const chunkFileLower = typeof chunkFile === 'string' ? chunkFile.toLowerCase() : null;
  const guardContext = { file: chunkFile, chunkId };
  const phraseGuard = state.postingsGuard?.phrase || null;
  const chargramGuard = state.postingsGuard?.chargram || null;
  const postingsGuardTier = resolvePostingsGuardTier(chunkFile);
  const phraseMaxPerChunk = resolveGuardMaxPerChunk(phraseGuard, 'phrase', postingsGuardTier);
  const chargramMaxPerChunk = resolveGuardMaxPerChunk(chargramGuard, 'chargram', postingsGuardTier);
  const skipPhrasePostings = typeof chunk?.skipPhrasePostings === 'boolean'
    ? chunk.skipPhrasePostings
    : shouldSkipPhrasePostingsForChunk(chunk, chunkFileLower);
  if (phraseGuard && phraseMaxPerChunk > 0) {
    phraseGuard.effectiveMaxPerChunk = Math.min(
      Number.isFinite(phraseGuard.effectiveMaxPerChunk) ? phraseGuard.effectiveMaxPerChunk : phraseGuard.maxPerChunk,
      phraseMaxPerChunk
    );
  }
  if (chargramGuard && chargramMaxPerChunk > 0) {
    chargramGuard.effectiveMaxPerChunk = Math.min(
      Number.isFinite(chargramGuard.effectiveMaxPerChunk) ? chargramGuard.effectiveMaxPerChunk : chargramGuard.maxPerChunk,
      chargramMaxPerChunk
    );
  }

  const reuseSet = state.chargramBuffers?.set || null;
  const reuseWindow = state.chargramBuffers?.window || null;
  const charSet = reuseSet || new Set();
  if (reuseSet) reuseSet.clear();
  const chargramLanguageId = chunk?.lang
    || chunk?.metaV2?.lang
    || chunk?.metaV2?.effective?.languageId
    || null;
  if (chargramEnabled) {
    const maxChargramsPerChunk = chargramMaxPerChunk;
    const chargrams = Array.isArray(chunk.chargrams) && chunk.chargrams.length
      ? chunk.chargrams
      : null;
    const hasHashedChargrams = chargrams
      && typeof chargrams[0] === 'string'
      && chargrams[0].startsWith('h64:');
    const wantsLegacyChargrams = chargrams
      && hasHashedChargrams
      && (!chargramMaxTokenLength || Array.isArray(chunk.chargramTokens));
    if (wantsLegacyChargrams) {
      for (const g of chargrams) {
        if (maxChargramsPerChunk && charSet.size >= maxChargramsPerChunk) break;
        charSet.add(g);
      }
    } else {
      const addFromTokens = (tokenList) => {
        if (!Array.isArray(tokenList) || !tokenList.length) return;
        for (const w of tokenList) {
          if (chargramMaxTokenLength && w.length > chargramMaxTokenLength) continue;
          if (chargramStopwords && isLexiconStopword(chargramLanguageId, w, 'chargrams')) continue;
          appendChargramsToSet(
            w,
            chargramMinN,
            chargramMaxN,
            charSet,
            maxChargramsPerChunk,
            reuseWindow,
            { maxTokenLength: chargramMaxTokenLength }
          );
          if (maxChargramsPerChunk && charSet.size >= maxChargramsPerChunk) return;
        }
      };

      if (chargramSource === 'fields' && chunk.fieldTokens && typeof chunk.fieldTokens === 'object') {
        const fields = chunk.fieldTokens;
        // Historically we derived chargrams from "field" text (name + doc). Doing so
        // keeps the chargram vocab bounded even when indexing many languages.
        for (const field of chargramFields) {
          addFromTokens(fields[field]);
        }
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

  if (sparseEnabled && useTokenIds && state.tokenIdMap) {
    for (let i = 0; i < tokenIds.length; i += 1) {
      registerTokenIdInvariant({
        tokenIdMap: state.tokenIdMap,
        tokenIdCollisions: state.tokenIdCollisions,
        id: tokenIds[i],
        token: tokens[i]
      });
    }
  }

  if (sparseEnabled) {
    const freq = state.tokenBuffers?.freq || new Map();
    if (state.tokenBuffers?.freq) freq.clear();
    tokenKeys.forEach((t) => {
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
  }

  if (phraseEnabled && !skipPhrasePostings) {
    if (phraseHashEnabled) {
      appendPhraseNgramsToHashBuckets({
        bucketMap: state.phrasePostHashBuckets,
        tokenIds,
        docId: chunkId,
        minN: phraseMinN,
        maxN: phraseMaxN,
        guard: phraseGuard,
        context: guardContext,
        state,
        maxPerChunk: phraseMaxPerChunk
      });
    } else if (phraseSource === 'full') {
      appendPhraseNgramsToPostingsMap(
        state.phrasePost,
        seq,
        chunkId,
        phraseMinN,
        phraseMaxN,
        phraseGuard,
        guardContext,
        phraseMaxPerChunk
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
          guardContext,
          phraseMaxPerChunk
        );
      }
    }
  }
  if (chargramEnabled) {
    const maxChargrams = chargramMaxPerChunk;
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
      const fieldFreq = state.tokenBuffers?.fieldFreq || new Map();
      if (state.tokenBuffers?.fieldFreq) fieldFreq.clear();
      for (let i = 0; i < fieldTokens.length; i += 1) {
        const tok = fieldTokens[i];
        fieldFreq.set(tok, (fieldFreq.get(tok) || 0) + 1);
      }
      for (const [tok, count] of fieldFreq.entries()) {
        let postings = state.fieldPostings[field].get(tok);
        if (!postings) {
          postings = [];
          state.fieldPostings[field].set(tok, postings);
        }
        postings.push([chunkId, count]);
      }
      if (state.tokenBuffers?.fieldFreq) fieldFreq.clear();
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

  mergeLengthsWithOffset(target.docLengths, source.docLengths, offset);
  if (target.fieldDocLengths && source.fieldDocLengths) {
    for (const [field, lengths] of Object.entries(source.fieldDocLengths)) {
      if (!target.fieldDocLengths[field]) target.fieldDocLengths[field] = [];
      mergeLengthsWithOffset(target.fieldDocLengths[field], lengths, offset);
    }
  }
  if (Array.isArray(source.fieldTokens)) {
    mergeLengthsWithOffset(target.fieldTokens, source.fieldTokens, offset);
  }

  if (source.df && typeof source.df.entries === 'function') {
    for (const [token, count] of source.df.entries()) {
      target.df.set(token, (target.df.get(token) || 0) + count);
    }
  }

  mergeFrequencyPostingsMapWithOffset(target.tokenPostings, source.tokenPostings, offset);

  if (source.fieldPostings) {
    for (const [field, postingsMap] of Object.entries(source.fieldPostings)) {
      if (!target.fieldPostings[field]) target.fieldPostings[field] = new Map();
      mergeFrequencyPostingsMapWithOffset(target.fieldPostings[field], postingsMap, offset);
    }
  }

  mergeCompactPostingsMapWithOffset(target.phrasePost, source.phrasePost, offset);
  mergeCompactPostingsMapWithOffset(target.triPost, source.triPost, offset);

  if (Array.isArray(source.scannedFiles)) {
    target.scannedFiles.push(...source.scannedFiles);
  }
  if (Array.isArray(source.discoveredFiles) && source.discoveredFiles.length) {
    if (!Array.isArray(target.discoveredFiles) || target.discoveredFiles.length === 0) {
      target.discoveredFiles = source.discoveredFiles.slice();
    }
  }
  if (source.discoveryHash && !target.discoveryHash) {
    target.discoveryHash = source.discoveryHash;
  }
  if (source.fileListHash && !target.fileListHash) {
    target.fileListHash = source.fileListHash;
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
  if (source.lexiconRelationFilterByFile && typeof source.lexiconRelationFilterByFile.entries === 'function') {
    if (!target.lexiconRelationFilterByFile) target.lexiconRelationFilterByFile = new Map();
    for (const [file, stats] of source.lexiconRelationFilterByFile.entries()) {
      target.lexiconRelationFilterByFile.set(file, stats);
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
  if (source.fileDetailsByPath && typeof source.fileDetailsByPath.entries === 'function') {
    if (!target.fileDetailsByPath) target.fileDetailsByPath = new Map();
    for (const [file, info] of source.fileDetailsByPath.entries()) {
      if (!target.fileDetailsByPath.has(file)) {
        target.fileDetailsByPath.set(file, info);
      }
    }
  }
  if (source.chunkUidToFile && typeof source.chunkUidToFile.entries === 'function') {
    if (!target.chunkUidToFile) target.chunkUidToFile = new Map();
    for (const [chunkUid, file] of source.chunkUidToFile.entries()) {
      if (!target.chunkUidToFile.has(chunkUid)) {
        target.chunkUidToFile.set(chunkUid, file);
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
