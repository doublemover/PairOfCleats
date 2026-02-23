import { normalizePostingsConfig } from '../../shared/postings-config.js';
import { registerTokenIdInvariant } from '../../shared/invariants.js';
import { isLexiconStopword } from '../../lang/lexicon/index.js';
import { createTypedTokenPostingMap } from '../../shared/token-id.js';
import { shouldSkipPhrasePostingsForChunk } from './state/phrase-postings.js';
import { normalizeTokenRetention, applyTokenRetention } from './state/token-retention.js';
import {
  appendDocIdToPostingsMap,
  appendPhraseNgramsToHashBuckets,
  appendPhraseNgramsToPostingsMap,
  appendChargramsToSet
} from './state/postings-helpers.js';
import {
  BASE_FIELD_POSTINGS_FIELDS,
  CLASSIFIED_FIELD_POSTINGS_FIELDS,
  PHRASE_SOURCE_FIELDS,
  accumulateFrequency,
  appendFrequencyToPostingsMap,
  normalizeChargramFields,
  resolveBoundedNgramRange,
  resolveFieldTokenSampleSize
} from './state/append-chunk-helpers.js';
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
import {
  appendArrayProperty,
  copyArrayPropertyWhenTargetEmpty,
  copyScalarPropertyWhenMissing,
  mergeMapEntries,
  mergeMapEntriesIfMissing,
  mergeNumericObjectTotals
} from './state/merge-state.js';

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
 * @param {{mode:'full'|'sample'|'none',sampleSize:number}|null} [tokenRetention=null]
 * @param {{sparsePostingsEnabled?:boolean}|null} [options=null]
 * When `sparsePostingsEnabled=false`, sparse postings/token statistics are
 * intentionally skipped (vector-only profile), while chunk/token payloads are
 * still retained for downstream filtering/query-AST matching.
 *
 * Retention ordering is intentional:
 * 1. Build postings/doc-length counters from full in-memory token payloads.
 * 2. Apply retention policy to the chunk object before persistence in `state.chunks`.
 * This keeps scoring/postings stable across retention modes.
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
  const { min: phraseMinN, max: phraseMaxN } = resolveBoundedNgramRange(
    config.phraseMinN,
    config.phraseMaxN,
    { min: DEFAULT_POSTINGS_CONFIG.phraseMinN, max: DEFAULT_POSTINGS_CONFIG.phraseMaxN }
  );
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
  const chargramFields = normalizeChargramFields(config.chargramFields);
  const { min: chargramMinN, max: chargramMaxN } = resolveBoundedNgramRange(
    config.chargramMinN,
    config.chargramMaxN,
    { min: DEFAULT_POSTINGS_CONFIG.chargramMinN, max: DEFAULT_POSTINGS_CONFIG.chargramMaxN }
  );
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
    accumulateFrequency(freq, tokenKeys);

    state.docLengths[chunkId] = tokens.length;
    appendFrequencyToPostingsMap(state.tokenPostings, freq, chunkId);
    if (state.tokenBuffers?.freq) freq.clear();
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
      for (const field of PHRASE_SOURCE_FIELDS) {
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
      ? CLASSIFIED_FIELD_POSTINGS_FIELDS
      : BASE_FIELD_POSTINGS_FIELDS;
    const fieldTokenSampleSize = resolveFieldTokenSampleSize(tokenRetention);
    const fieldFreq = state.tokenBuffers?.fieldFreq || new Map();
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
      if (fieldFreq.clear) fieldFreq.clear();
      accumulateFrequency(fieldFreq, fieldTokens);
      if (!state.fieldPostings[field]) state.fieldPostings[field] = new Map();
      appendFrequencyToPostingsMap(state.fieldPostings[field], fieldFreq, chunkId);
    }
    if (state.tokenBuffers?.fieldFreq) fieldFreq.clear();
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
  // Retention applies to persisted chunk payload only; postings above already used full token data.
  applyTokenRetention(chunk, tokenRetention);
  if (chunk.seq) delete chunk.seq;
  if (chunk.chargrams) delete chunk.chargrams;
  if (chunk.fieldTokens) delete chunk.fieldTokens;
  // Phrase postings are authoritative; do not retain per-chunk n-grams in meta.
  if (chunk.ngrams) delete chunk.ngrams;
  state.chunks.push(chunk);
}

/**
 * Merge shard-local index state into a target aggregate, remapping doc ids by
 * the target's current chunk length (`offset`).
 *
 * Merge policy is intentionally asymmetric:
 * - postings/doc counters are additive and remapped by offset
 * - discovery snapshot metadata is first-writer-wins
 * - path metadata maps (`fileInfoByPath`, `fileDetailsByPath`, `chunkUidToFile`)
 *   are also first-writer-wins to preserve deterministic provenance
 *
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

  appendArrayProperty(target, 'scannedFiles', source.scannedFiles);
  copyArrayPropertyWhenTargetEmpty(target, 'discoveredFiles', source.discoveredFiles);
  copyScalarPropertyWhenMissing(target, 'discoveryHash', source.discoveryHash);
  copyScalarPropertyWhenMissing(target, 'fileListHash', source.fileListHash);
  appendArrayProperty(target, 'scannedFilesTimes', source.scannedFilesTimes);
  appendArrayProperty(target, 'skippedFiles', source.skippedFiles);
  if (Number.isFinite(source.totalTokens)) {
    target.totalTokens += source.totalTokens;
  }

  if (!target.fileRelations) target.fileRelations = new Map();
  mergeMapEntries(target.fileRelations, source.fileRelations);

  if (source.lexiconRelationFilterByFile && typeof source.lexiconRelationFilterByFile.entries === 'function') {
    if (!target.lexiconRelationFilterByFile) target.lexiconRelationFilterByFile = new Map();
    mergeMapEntries(target.lexiconRelationFilterByFile, source.lexiconRelationFilterByFile);
  }
  if (source.fileInfoByPath && typeof source.fileInfoByPath.entries === 'function') {
    if (!target.fileInfoByPath) target.fileInfoByPath = new Map();
    mergeMapEntriesIfMissing(target.fileInfoByPath, source.fileInfoByPath);
  }
  if (source.fileDetailsByPath && typeof source.fileDetailsByPath.entries === 'function') {
    if (!target.fileDetailsByPath) target.fileDetailsByPath = new Map();
    mergeMapEntriesIfMissing(target.fileDetailsByPath, source.fileDetailsByPath);
  }
  if (source.chunkUidToFile && typeof source.chunkUidToFile.entries === 'function') {
    if (!target.chunkUidToFile) target.chunkUidToFile = new Map();
    mergeMapEntriesIfMissing(target.chunkUidToFile, source.chunkUidToFile);
  }
  appendArrayProperty(target, 'vfsManifestRows', source.vfsManifestRows);
  mergeNumericObjectTotals(target, 'vfsManifestStats', source.vfsManifestStats);
}
