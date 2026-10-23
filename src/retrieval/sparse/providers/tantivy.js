import { tryRequire } from '../../../shared/optional-deps.js';
import { SPARSE_PROVIDER_IDS } from '../types.js';
import { bitmapHas, getBitmapSize } from '../../bitmap.js';

const normalizeHits = (rows) => {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (!row) return null;
      if (Number.isFinite(row.idx)) {
        return { idx: row.idx, score: Number(row.score ?? row.sim ?? 0) };
      }
      if (Number.isFinite(row.id)) {
        return { idx: row.id, score: Number(row.score ?? row.sim ?? 0) };
      }
      if (Number.isFinite(row.docId)) {
        return { idx: row.docId, score: Number(row.score ?? row.sim ?? 0) };
      }
      return null;
    })
    .filter(Boolean);
};

const resolveAdapter = (mod) => {
  if (!mod) return null;
  const api = mod.default && Object.keys(mod).length === 1 ? mod.default : mod;
  const openIndex = api.openIndex || api.open;
  const searchIndex = api.search || api.searchIndex;
  return openIndex && searchIndex ? { openIndex, searchIndex } : null;
};

/** @returns {import('../types.js').SparseProvider<import('../types.js').SparseSearchParams,import('../types.js').SparseRankedResult> & {available:boolean}} */
export function createTantivyProvider({ verbose = false, logger } = {}) {
  const result = tryRequire('tantivy', { verbose, logger });
  const adapter = resolveAdapter(result.ok ? result.mod : null);
  const cache = new Map();

  const openIndex = (dir) => {
    if (!dir) return null;
    if (cache.has(dir)) return cache.get(dir);
    try {
      const handle = adapter?.openIndex ? adapter.openIndex(dir) : null;
      if (handle) cache.set(dir, handle);
      return handle || null;
    } catch {
      return null;
    }
  };

  return {
    id: SPARSE_PROVIDER_IDS.TANTIVY,
    available: Boolean(adapter),
    search: ({ idx, queryTokens, mode, topN, allowedIds }) => {
      if (!adapter) return { hits: [], type: 'tantivy' };
      const candidateSet = allowedIds ?? null;
      if (candidateSet && getBitmapSize(candidateSet) === 0) return { hits: [], type: 'tantivy' };
      const info = idx?.tantivy || null;
      if (!info?.available) return { hits: [], type: 'tantivy' };
      const dir = info.dir;
      if (!dir) return { hits: [], type: 'tantivy' };
      const handle = openIndex(dir);
      if (!handle) return { hits: [], type: 'tantivy' };
      const query = Array.isArray(queryTokens) ? queryTokens.join(' ') : '';
      if (!query) return { hits: [], type: 'tantivy' };
      // The adapter ranks globally and filtering happens below. Eligible-set
      // cardinality cannot bound the rank of its first eligible document.
      let overfetch = candidateSet
        ? Math.max(topN, Math.min(topN * 3, 2000))
        : topN;
      const maxWindow = Math.max(overfetch, Array.isArray(idx?.chunkMeta) ? idx.chunkMeta.length : 1_000_000);
      let hits;
      for (;;) {
        let rows;
        try { rows = adapter.searchIndex(handle, query, overfetch, mode) || []; }
        catch { return { hits: [], type: 'tantivy' }; }
        hits = normalizeHits(rows);
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
      return { hits, type: 'tantivy' };
    }
  };
}
