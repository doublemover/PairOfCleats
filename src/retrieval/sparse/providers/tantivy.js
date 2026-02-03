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
      const info = idx?.tantivy || null;
      if (!info?.available) return { hits: [], type: 'tantivy' };
      const dir = info.dir;
      if (!dir) return { hits: [], type: 'tantivy' };
      const handle = openIndex(dir);
      if (!handle) return { hits: [], type: 'tantivy' };
      const query = Array.isArray(queryTokens) ? queryTokens.join(' ') : '';
      if (!query) return { hits: [], type: 'tantivy' };
      const candidateSet = allowedIds && getBitmapSize(allowedIds) ? allowedIds : null;
      const overfetch = candidateSet
        ? Math.min(getBitmapSize(candidateSet), Math.max(topN, Math.min(topN * 3, 2000)))
        : topN;
      let rows = [];
      try {
        rows = adapter.searchIndex(handle, query, overfetch, mode) || [];
      } catch {
        return { hits: [], type: 'tantivy' };
      }
      let hits = normalizeHits(rows);
      if (candidateSet) {
        hits = hits.filter((hit) => bitmapHas(candidateSet, hit.idx));
      }
      hits.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
      if (hits.length > topN) hits = hits.slice(0, topN);
      return { hits, type: 'tantivy' };
    }
  };
}
