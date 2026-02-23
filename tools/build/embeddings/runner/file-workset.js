import { sha1 } from '../../../../src/shared/hash.js';
import { buildChunkHashesFingerprint } from '../cache.js';
import { reuseVectorsFromPriorCacheEntry } from './cache-orchestration.js';

/**
 * Allocate sparse reuse slots for one file.
 *
 * We intentionally keep these arrays sparse (no `.fill(null)`) because both
 * reuse checks and downstream vector checks already treat missing values as
 * "not reused", which avoids an O(n) initialization pass in the hot path.
 *
 * @param {number} chunkCount
 * @returns {{code:any[],doc:any[],merged:any[]}}
 */
const createReuseSlots = (chunkCount) => ({
  code: new Array(chunkCount),
  doc: new Array(chunkCount),
  merged: new Array(chunkCount)
});

/**
 * Resolve the doc payload associated with a chunk for embedding/hash inputs.
 *
 * Semantics match the inline runner behavior: whitespace-only docs are treated
 * as empty, while non-empty docs keep their original text (including spacing).
 *
 * @param {object|null|undefined} chunk
 * @returns {string}
 */
const resolveChunkDocText = (chunk) => {
  const docText = typeof chunk?.docmeta?.doc === 'string' ? chunk.docmeta.doc : '';
  return docText.trim() ? docText : '';
};

/**
 * Parse one numeric chunk boundary while preserving historical slice behavior.
 *
 * We intentionally do not clamp or round here. JavaScript `String#slice` already
 * normalizes floating/negative values, and stage3 has long relied on that
 * behavior for malformed legacy ranges in old bundle snapshots.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
const resolveChunkBoundary = (value, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

/**
 * Precompute per-chunk code/doc payloads and their stable hash inputs.
 *
 * This helper is reused by stage3 workset assembly so hashing, cache fingerprint
 * checks, and embedding payload generation all share the exact same source text
 * normalization rules.
 *
 * @param {{text:string,items:Array<{chunk?:object}>}} input
 * @returns {{chunkCodeTexts:string[],chunkDocTexts:string[],chunkHashes:string[]}}
 */
export const buildChunkEmbeddingInputs = ({ text, items }) => {
  const chunkCount = Array.isArray(items) ? items.length : 0;
  const chunkHashes = new Array(chunkCount);
  const chunkCodeTexts = new Array(chunkCount);
  const chunkDocTexts = new Array(chunkCount);
  for (let i = 0; i < chunkCount; i += 1) {
    const chunk = items[i]?.chunk || null;
    const start = resolveChunkBoundary(chunk?.start, 0);
    const end = resolveChunkBoundary(chunk?.end, start);
    const codeText = text.slice(start, end);
    const docText = resolveChunkDocText(chunk);
    chunkCodeTexts[i] = codeText;
    chunkDocTexts[i] = docText;
    chunkHashes[i] = sha1(`${codeText}\n${docText}`);
  }
  return {
    chunkCodeTexts,
    chunkDocTexts,
    chunkHashes
  };
};

/**
 * Build per-file embedding workset with cache-aware chunk reuse.
 *
 * Control-flow contract:
 * 1. Hash every chunk first so prior-cache reuse can use the fingerprint gate.
 * 2. Apply prior-cache reuse against the full chunk hash list.
 * 3. Materialize compute payloads only for unresolved chunks.
 *
 * This ordering preserves reuse correctness while avoiding repeated array
 * growth in the hot path by pre-sizing pending payload arrays.
 *
 * @param {{
 *   text:string,
 *   items:Array<{chunk?:object}>,
 *   cacheState:object,
 *   cacheKey:string|null,
 *   normalizedRel:string,
 *   scheduleIo:(worker:()=>Promise<any>)=>Promise<any>,
 *   reuseVectorsFromPriorCacheEntryImpl?:(input:{
 *     cacheState:object,
 *     cacheKey:string|null,
 *     normalizedRel:string,
 *     chunkHashes:string[],
 *     chunkHashesFingerprint:string|null,
 *     reuse:{code:any[],doc:any[],merged:any[]},
 *     scheduleIo:(worker:()=>Promise<any>)=>Promise<any>
 *   })=>Promise<void>
 * }} input
 * @returns {Promise<{
 *   chunkHashes:string[],
 *   chunkHashesFingerprint:string|null,
 *   reuse:{code:any[],doc:any[],merged:any[]},
 *   codeTexts:string[],
 *   docTexts:string[],
 *   codeMapping:number[],
 *   docMapping:number[]
 * }>}
 */
export const prepareFileEmbeddingWorkset = async ({
  text,
  items,
  cacheState,
  cacheKey,
  normalizedRel,
  scheduleIo,
  reuseVectorsFromPriorCacheEntryImpl = reuseVectorsFromPriorCacheEntry
}) => {
  const chunkCount = Array.isArray(items) ? items.length : 0;
  const {
    chunkCodeTexts,
    chunkDocTexts,
    chunkHashes
  } = buildChunkEmbeddingInputs({
    text,
    items
  });
  const chunkHashesFingerprint = buildChunkHashesFingerprint(chunkHashes);
  const reuse = createReuseSlots(chunkCount);
  await reuseVectorsFromPriorCacheEntryImpl({
    cacheState,
    cacheKey,
    normalizedRel,
    chunkHashes,
    chunkHashesFingerprint,
    reuse,
    scheduleIo
  });

  const codeTexts = new Array(chunkCount);
  const docTexts = new Array(chunkCount);
  const mapping = new Array(chunkCount);
  const reuseCode = reuse.code;
  const reuseDoc = reuse.doc;
  const reuseMerged = reuse.merged;
  let pendingCount = 0;
  for (let i = 0; i < chunkCount; i += 1) {
    if (reuseCode[i] && reuseDoc[i] && reuseMerged[i]) {
      continue;
    }
    mapping[pendingCount] = i;
    codeTexts[pendingCount] = chunkCodeTexts[i];
    docTexts[pendingCount] = chunkDocTexts[i];
    pendingCount += 1;
  }
  mapping.length = pendingCount;
  codeTexts.length = pendingCount;
  docTexts.length = pendingCount;

  return {
    chunkHashes,
    chunkHashesFingerprint,
    reuse,
    codeTexts,
    docTexts,
    codeMapping: mapping,
    docMapping: mapping
  };
};
