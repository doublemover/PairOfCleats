import { forEachRollingChargramHash } from '../../../shared/chargram-hash.js';
import { formatHash64, hashTokenId64Window } from '../../../shared/token-id.js';
import { recordGuardSample } from './postings-guards.js';

// Postings maps can be extremely large (especially phrase n-grams and chargrams).
// Storing posting lists as `Set`s is extremely memory-expensive when the vast
// majority of terms are singletons (df=1).
//
// We store posting lists in a compact representation:
//   - number: a single docId
//   - number[]: a list of docIds in insertion order (typically increasing)
//
// This avoids allocating one `Set` per term.
export function appendDocIdToPostingsMap(map, key, docId, guard = null, context = null) {
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
export function appendPhraseNgramsToPostingsMap(
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
          if (guard) {
            guard.truncatedChunks += 1;
            recordGuardSample(guard, context);
          }
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

export const ALLOWED_CHARGRAM_FIELDS = new Set(['name', 'signature', 'doc', 'comment', 'body']);

const phraseIdsEqual = (leftIds, rightIds, start) => {
  if (!Array.isArray(leftIds) || !Array.isArray(rightIds)) return false;
  if (!Number.isFinite(start) || start < 0) return false;
  if ((start + leftIds.length) > rightIds.length) return false;
  for (let i = 0; i < leftIds.length; i += 1) {
    if (leftIds[i] !== rightIds[start + i]) return false;
  }
  return true;
};

export function appendPhraseNgramsToHashBuckets({
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

export function appendChargramsToSet(
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

export function *iteratePostingDocIds(posting) {
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
