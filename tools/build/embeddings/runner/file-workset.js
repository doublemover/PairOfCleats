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
  const chunkHashes = new Array(chunkCount);
  const chunkCodeTexts = new Array(chunkCount);
  for (let i = 0; i < chunkCount; i += 1) {
    const chunk = items[i]?.chunk || null;
    const start = Number.isFinite(Number(chunk?.start)) ? Number(chunk.start) : 0;
    const end = Number.isFinite(Number(chunk?.end)) ? Number(chunk.end) : start;
    const codeText = text.slice(start, end);
    const docText = resolveChunkDocText(chunk);
    chunkCodeTexts[i] = codeText;
    chunkHashes[i] = sha1(`${codeText}\n${docText}`);
  }
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
  let pendingCount = 0;
  for (let i = 0; i < chunkCount; i += 1) {
    if (reuse.code[i] && reuse.doc[i] && reuse.merged[i]) {
      continue;
    }
    mapping[pendingCount] = i;
    codeTexts[pendingCount] = chunkCodeTexts[i];
    docTexts[pendingCount] = resolveChunkDocText(items[i]?.chunk || null);
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
