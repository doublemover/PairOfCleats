import { normalizePostingsConfig } from '../../shared/postings-config.js';
import { forEachRollingChargramHash } from '../../shared/chargram-hash.js';
import { registerTokenIdInvariant } from '../../shared/invariants.js';
import { isLexiconStopword } from '../../lang/lexicon/index.js';
import { isDocsPath, isFixturePath, shouldPreferInfraProse } from './mode-routing.js';
import {
  createTypedTokenPostingMap,
  formatHash64,
  hashTokenId64Window
} from '../../shared/token-id.js';

const DEFAULT_POSTINGS_CONFIG = normalizePostingsConfig();
const TOKEN_RETENTION_MODES = new Set(['full', 'sample', 'none']);
const POSTINGS_GUARD_SAMPLES = 5;
const TOKEN_ID_COLLISION_SAMPLE_SIZE = 5;
const POSTINGS_GUARDS = {
  phrase: { maxUnique: 1000000, maxPerChunk: 20000 },
  chargram: { maxUnique: 2000000, maxPerChunk: 50000 }
};
const POSTINGS_GUARD_TIER_MAX_PER_CHUNK = Object.freeze({
  docs: { phrase: 12000, chargram: 24000 },
  fixtures: { phrase: 6000, chargram: 12000 }
});

const resolvePostingsGuardTier = (file) => {
  if (!file || typeof file !== 'string') return null;
  if (isFixturePath(file)) return 'fixtures';
  if (isDocsPath(file)) return 'docs';
  return null;
};

const getLowerBasename = (fileLower) => {
  if (!fileLower || typeof fileLower !== 'string') return null;
  const slashIndex = Math.max(fileLower.lastIndexOf('/'), fileLower.lastIndexOf('\\'));
  return slashIndex >= 0 ? fileLower.slice(slashIndex + 1) : fileLower;
};

const getLowerExtension = (baseNameLower) => {
  if (!baseNameLower || typeof baseNameLower !== 'string') return '';
  const dotIndex = baseNameLower.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === (baseNameLower.length - 1)) return '';
  return baseNameLower.slice(dotIndex);
};

const GENERATED_DOC_BASENAME_SET = new Set([
  'mkdocs.yml',
  'antora.yml',
  'manual.txt',
  'docbook-entities.txt',
  'idnamappingtable.txt'
]);
const GENERATED_DOC_EXT_SET = new Set(['.html', '.htm']);
const LICENSE_LIKE_RE = /(^|[-_.])(license|licence|copying|copyright|notice)([-_.]|$)/i;
const RFC_TXT_RE = /^rfc\d+\.txt$/i;

const hasLicenseBoilerplateTags = (tags) => {
  if (!Array.isArray(tags) || !tags.length) return false;
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const normalized = tag.trim().toLowerCase();
    if (!normalized) continue;
    if (normalized === 'boilerplate:license') return true;
    if (normalized.startsWith('license:')) return true;
  }
  return false;
};

const hasLicenseLikePath = (fileLower, baseNameLower) => {
  if (!fileLower || !baseNameLower) return false;
  if (LICENSE_LIKE_RE.test(baseNameLower)) return true;
  if (fileLower.startsWith('licenses/') || fileLower.startsWith('licenses\\')) return true;
  if (fileLower.includes('/licenses/') || fileLower.includes('\\licenses\\')) return true;
  return false;
};

const hasGeneratedDocPath = (fileLower, baseNameLower) => {
  if (!fileLower || !baseNameLower) return false;
  const ext = getLowerExtension(baseNameLower);
  if (isDocsPath(fileLower) && GENERATED_DOC_EXT_SET.has(ext)) return true;
  if (GENERATED_DOC_BASENAME_SET.has(baseNameLower)) return true;
  if (isDocsPath(fileLower) && RFC_TXT_RE.test(baseNameLower)) return true;
  return false;
};

export const shouldSkipPhrasePostingsForChunk = (chunk, fileLower) => {
  const baseNameLower = getLowerBasename(fileLower);
  if (baseNameLower === 'cmakelists.txt') return true;
  if (isFixturePath(fileLower)) return true;
  if (shouldPreferInfraProse({ relPath: fileLower })) return true;
  if (hasLicenseLikePath(fileLower, baseNameLower)) return true;
  if (hasGeneratedDocPath(fileLower, baseNameLower)) return true;
  const chunkTags = Array.isArray(chunk?.docmeta?.boilerplateTags) ? chunk.docmeta.boilerplateTags : null;
  if (hasLicenseBoilerplateTags(chunkTags)) return true;
  const metaTags = Array.isArray(chunk?.metaV2?.docmeta?.boilerplateTags)
    ? chunk.metaV2.docmeta.boilerplateTags
    : null;
  return hasLicenseBoilerplateTags(metaTags);
};

const resolveGuardMaxPerChunk = (guard, kind, tier) => {
  const base = Number.isFinite(guard?.maxPerChunk) ? Math.max(0, Math.floor(guard.maxPerChunk)) : 0;
  if (!base || !tier) return base;
  const tierCap = Number.isFinite(POSTINGS_GUARD_TIER_MAX_PER_CHUNK[tier]?.[kind])
    ? Math.max(0, Math.floor(POSTINGS_GUARD_TIER_MAX_PER_CHUNK[tier][kind]))
    : 0;
  if (!tierCap) return base;
  return Math.min(base, tierCap);
};

const createGuardEntry = (label, limits) => ({
  label,
  maxUnique: limits.maxUnique,
  maxPerChunk: limits.maxPerChunk,
  effectiveMaxPerChunk: limits.maxPerChunk,
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
function appendPhraseNgramsToPostingsMap(
  map,
  tokens,
  docId,
  minN,
  maxN,
  guard = null,
  context = null,
  maxPerChunkOverride = null
) {
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
  const maxPerChunk = Number.isFinite(maxPerChunkOverride)
    ? Math.max(0, Math.floor(maxPerChunkOverride))
    : (guard?.maxPerChunk || 0);
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

const appendDocIdToPostingValue = (posting, docId) => {
  if (posting == null) return docId;
  if (typeof posting === 'number') {
    return posting === docId ? posting : [posting, docId];
  }
  if (Array.isArray(posting)) {
    const last = posting[posting.length - 1];
    if (last !== docId) posting.push(docId);
    return posting;
  }
  if (posting && typeof posting.add === 'function') {
    posting.add(docId);
    return posting;
  }
  return posting;
};
const ALLOWED_CHARGRAM_FIELDS = new Set(['name', 'signature', 'doc', 'comment', 'body']);

const phraseIdsEqual = (leftIds, rightIds, start) => {
  if (!Array.isArray(leftIds) || !Array.isArray(rightIds)) return false;
  if (!Number.isFinite(start) || start < 0) return false;
  if ((start + leftIds.length) > rightIds.length) return false;
  for (let i = 0; i < leftIds.length; i += 1) {
    if (leftIds[i] !== rightIds[start + i]) return false;
  }
  return true;
};

function appendPhraseNgramsToHashBuckets({
  bucketMap,
  tokenIds,
  docId,
  minN,
  maxN,
  guard = null,
  context = null,
  state = null,
  maxPerChunk = null
}) {
  if (!bucketMap || typeof bucketMap.get !== 'function' || typeof bucketMap.set !== 'function') return;
  if (!Array.isArray(tokenIds) || !tokenIds.length) return;
  const min = Number.isFinite(minN) ? minN : 2;
  const max = Number.isFinite(maxN) ? maxN : 4;
  if (min < 1 || max < min) return;
  const len = tokenIds.length;
  if (len < min) return;
  const maxSpan = Math.min(max, len);
  let emitted = 0;
  const resolvedMaxPerChunk = Number.isFinite(maxPerChunk)
    ? Math.max(0, Math.floor(maxPerChunk))
    : (guard?.maxPerChunk || 0);
  for (let i = 0; i < len; i += 1) {
    for (let n = min; n <= maxSpan; n += 1) {
      if ((i + n) > len) break;
      if (resolvedMaxPerChunk && emitted >= resolvedMaxPerChunk) {
        if (guard) {
          guard.truncatedChunks += 1;
          recordGuardSample(guard, context);
        }
        return;
      }
      const hash = formatHash64(hashTokenId64Window(tokenIds, i, n));
      const bucket = bucketMap.get(hash);
      if (!bucket) {
        if (guard?.maxUnique && Number(state?.phrasePostHashUnique || 0) >= guard.maxUnique) {
          if (!guard.disabled) {
            guard.disabled = true;
            guard.reason = guard.reason || 'max-unique';
            recordGuardSample(guard, context);
          }
          guard.dropped += 1;
          emitted += 1;
          continue;
        }
        bucketMap.set(hash, {
          kind: 'single',
          ids: tokenIds.slice(i, i + n),
          posting: docId
        });
        if (state) {
          state.phrasePostHashUnique = Number(state.phrasePostHashUnique || 0) + 1;
          if (state.phraseHashStats && typeof state.phraseHashStats === 'object') {
            state.phraseHashStats.buckets = bucketMap.size;
          }
        }
        if (guard) {
          guard.peakUnique = Math.max(guard.peakUnique || 0, Number(state?.phrasePostHashUnique || 0));
        }
        emitted += 1;
        continue;
      }
      if (bucket.kind === 'single') {
        if (phraseIdsEqual(bucket.ids, tokenIds, i)) {
          bucket.posting = appendDocIdToPostingValue(bucket.posting, docId);
        } else {
          if (guard?.maxUnique && Number(state?.phrasePostHashUnique || 0) >= guard.maxUnique) {
            if (!guard.disabled) {
              guard.disabled = true;
              guard.reason = guard.reason || 'max-unique';
              recordGuardSample(guard, context);
            }
            guard.dropped += 1;
            emitted += 1;
            continue;
          }
          const prior = { ids: bucket.ids, posting: bucket.posting };
          bucket.kind = 'collision';
          bucket.entries = [
            prior,
            { ids: tokenIds.slice(i, i + n), posting: docId }
          ];
          delete bucket.ids;
          delete bucket.posting;
          if (state) {
            state.phrasePostHashUnique = Number(state.phrasePostHashUnique || 0) + 1;
            if (state.phraseHashStats && typeof state.phraseHashStats === 'object') {
              state.phraseHashStats.collisions = Number(state.phraseHashStats.collisions || 0) + 1;
            }
          }
        }
        emitted += 1;
        continue;
      }
      if (!Array.isArray(bucket.entries)) bucket.entries = [];
      let matched = false;
      for (const entry of bucket.entries) {
        if (!phraseIdsEqual(entry?.ids, tokenIds, i)) continue;
        entry.posting = appendDocIdToPostingValue(entry.posting, docId);
        matched = true;
        break;
      }
      if (!matched) {
        if (guard?.maxUnique && Number(state?.phrasePostHashUnique || 0) >= guard.maxUnique) {
          if (!guard.disabled) {
            guard.disabled = true;
            guard.reason = guard.reason || 'max-unique';
            recordGuardSample(guard, context);
          }
          guard.dropped += 1;
          emitted += 1;
          continue;
        }
        bucket.entries.push({
          ids: tokenIds.slice(i, i + n),
          posting: docId
        });
        if (state) {
          state.phrasePostHashUnique = Number(state.phrasePostHashUnique || 0) + 1;
        }
      }
      emitted += 1;
    }
  }
}

function appendChargramsToSet(
  token,
  minN,
  maxN,
  set,
  maxPerChunk = 0,
  _buffer = null,
  { maxTokenLength = null } = {}
) {
  if (!token) return;
  forEachRollingChargramHash(token, minN, maxN, { maxTokenLength }, (hash) => {
    set.add(hash);
    if (maxPerChunk && set.size >= maxPerChunk) return false;
    return true;
  });
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

/**
 * Normalize token retention options to a stable shape.
 * @param {object} [raw]
 * @returns {{mode:'full'|'sample'|'none',sampleSize:number}}
 */
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

/**
 * Apply token retention rules to a chunk in-place.
 * @param {object} chunk
 * @param {{mode:'full'|'sample'|'none',sampleSize:number}} retention
 */
export function applyTokenRetention(chunk, retention) {
  if (!chunk || !retention || retention.mode === 'full') return;
  if (retention.mode === 'none') {
    if (chunk.tokens) delete chunk.tokens;
    if (chunk.tokenIds) delete chunk.tokenIds;
    if (chunk.ngrams) delete chunk.ngrams;
    return;
  }
  if (retention.mode === 'sample') {
    if (Array.isArray(chunk.tokens) && chunk.tokens.length > retention.sampleSize) {
      chunk.tokens = chunk.tokens.slice(0, retention.sampleSize);
    }
    if (Array.isArray(chunk.tokenIds) && chunk.tokenIds.length > retention.sampleSize) {
      chunk.tokenIds = chunk.tokenIds.slice(0, retention.sampleSize);
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

const formatGuardSample = (sample) => {
  if (!sample) return null;
  const file = sample.file || 'unknown';
  const chunkId = Number.isFinite(sample.chunkId) ? `#${sample.chunkId}` : '';
  return `${file}${chunkId}`;
};

/**
 * Build warning messages from postings guard counters.
 * @param {object} state
 * @returns {string[]}
 */
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
    const effectiveMaxPerChunk = Number.isFinite(guard.effectiveMaxPerChunk)
      ? guard.effectiveMaxPerChunk
      : guard.maxPerChunk;
    if (guard.truncatedChunks && effectiveMaxPerChunk) {
      warnings.push(
        `[postings] ${guard.label} postings truncated for ${guard.truncatedChunks} chunk(s) (limit ${effectiveMaxPerChunk} per chunk).${sampleSuffix}`
      );
    }
  }
  return warnings;
}
