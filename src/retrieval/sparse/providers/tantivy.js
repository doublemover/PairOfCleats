import { tryRequire } from '../../../shared/optional-deps.js';
import { SPARSE_PROVIDER_IDS } from '../types.js';
import { bitmapHas, getBitmapSize } from '../../bitmap.js';
import { createTopKReducer } from '../../pipeline/topk.js';
import { resolveTantivyAdapter } from './tantivy-adapter.js';

const unavailable = message => Object.assign(new Error(message), { code: 'ERR_TANTIVY_UNAVAILABLE' });
const invalidResponse = () => Object.assign(new Error('Tantivy returned an invalid ranked response.'), { code: 'ERR_TANTIVY_RESPONSE' });

const normalizeHits = (rows) => {
  if (!Array.isArray(rows)) throw invalidResponse();
  const seen = new Set();
  return rows
    .map((row) => {
      const id = row?.idx ?? row?.id ?? row?.docId;
      const score = Number(row?.score ?? row?.sim ?? 0);
      if (!Number.isSafeInteger(id) || id < 0 || !Number.isFinite(score) || seen.has(id)) throw invalidResponse();
      seen.add(id);
      return { idx: id, score };
    });
};

/** @returns {import('../types.js').SparseProvider<import('../types.js').SparseSearchParams,import('../types.js').SparseRankedResult> & {available:boolean}} */
export function createTantivyProvider({ verbose = false, logger } = {}) {
  const result = tryRequire('tantivy', { verbose, logger });
  const adapter = resolveTantivyAdapter(result.ok ? result.mod : null);
  const cache = new Map();

  const openIndex = (dir) => {
    if (!dir) throw unavailable('Tantivy index directory is missing.');
    if (cache.has(dir)) return cache.get(dir);
    const handle = adapter.openIndex(dir);
    if (!handle) throw unavailable('Tantivy could not open the selected index.');
    cache.set(dir, handle);
    return handle;
  };

  return {
    id: SPARSE_PROVIDER_IDS.TANTIVY,
    available: Boolean(adapter),
    capabilities: Object.freeze({ booleanUniverse: 'eligible-id-completion' }),
    search: ({ idx, queryTokens, mode, topN, allowedIds, includeZeroScores = false, work = null, throwIfAborted = null }) => {
      throwIfAborted?.();
      const candidateSet = allowedIds ?? null;
      if (candidateSet && getBitmapSize(candidateSet) === 0) return { hits: [], type: 'tantivy' };
      if (!adapter) throw result.error || unavailable('Tantivy has no compatible synchronous open/search adapter.');
      const info = idx?.tantivy || null;
      if (!info?.available) throw unavailable('Tantivy artifacts are unavailable for the selected mode/generation.');
      const dir = info.dir;
      if (!dir) throw unavailable('Tantivy index directory is missing.');
      const query = Array.isArray(queryTokens) ? queryTokens.join(' ') : '';
      if (!query && !includeZeroScores) return { hits: [], type: 'tantivy' };
      if (includeZeroScores && !Array.isArray(idx.chunkMeta)) throw unavailable('Tantivy complement queries require the admitted document domain.');
      // The adapter ranks globally and filtering happens below. Eligible-set
      // cardinality cannot bound the rank of its first eligible document.
      let overfetch = candidateSet
        ? Math.max(topN, Math.min(topN * 3, 2000))
        : topN;
      const maxWindow = Math.max(overfetch, Array.isArray(idx?.chunkMeta) ? idx.chunkMeta.length : 1_000_000);
      let hits = [];
      const handle = query ? openIndex(dir) : null;
      for (; query;) {
        throwIfAborted?.();
        const rows = adapter.searchIndex(handle, query, overfetch, mode);
        hits = normalizeHits(rows);
        throwIfAborted?.();
        if (candidateSet) hits = hits.filter(hit => bitmapHas(candidateSet, hit.idx));
        if (!candidateSet || hits.length >= topN || rows.length < overfetch) break;
        if (overfetch >= maxWindow) {
          if (Array.isArray(idx?.chunkMeta)) break;
          throw Object.assign(new Error('Tantivy filtered search exhausted its bounded global scan before proving complete eligible results.'), {
            code: 'ERR_SPARSE_FILTER_BUDGET'
          });
        }
        overfetch = Math.min(maxWindow, Math.max(overfetch + 1, overfetch * 2));
      }
      hits.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
      if (hits.length > topN) hits = hits.slice(0, topN);
      if (includeZeroScores) {
        const known = new Set(hits.map(hit => hit.idx));
        const reducer = createTopKReducer({ k: topN, score: hit => hit.score, id: hit => hit.idx });
        for (const hit of hits) reducer.push(hit);
        const domain = candidateSet instanceof Set || typeof candidateSet?.[Symbol.iterator] === 'function'
          ? candidateSet : idx.chunkMeta.keys();
        let scanned = 0;
        for (const id of domain) {
          if (scanned++ % 128 === 0) throwIfAborted?.();
          if (!Number.isSafeInteger(id) || id < 0 || id >= idx.chunkMeta.length || !idx.chunkMeta[id]
            || candidateSet && !bitmapHas(candidateSet, id) || known.has(id)) continue;
          reducer.push({ idx: id, score: 0 });
        }
        throwIfAborted?.();
        hits = reducer.finish();
        if (work) { work.universeRows = scanned; work.completion = 'eligible-id-zero-score'; }
      }
      return { hits, type: 'tantivy' };
    }
  };
}
