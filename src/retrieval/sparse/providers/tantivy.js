import { tryRequire } from '../../../shared/optional-deps.js';
import { SPARSE_PROVIDER_IDS } from '../types.js';
import { bitmapHas, getBitmapSize } from '../../bitmap.js';
import { createTopKReducer } from '../../pipeline/topk.js';
import { resolveTantivyAdapter } from './tantivy-adapter.js';
import { addStorageFailureContext } from '../../../shared/storage/operation-error.js';
import { observeStorageResource } from '../../../shared/storage/failure-observation.js';
import { types } from 'node:util';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let nativeStorage;
const getNativeStorage = () => nativeStorage ||= require('../../../shared/storage/native-reader.js');

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
  let disposing = null, disposalStarted = false, disposalFinished = false;

  const openIndex = (info) => {
    const { dir, storageContext } = info;
    if (disposalStarted) throw unavailable('Tantivy provider has begun disposal.');
    if (!dir) throw unavailable('Tantivy index directory is missing.');
    if (cache.has(dir)) {
      const entry = cache.get(dir);
      if (!entry.close) throw unavailable('Tantivy reader has no supported close operation.');
      for (const observation of entry.observations) observation.requireSettled();
      return entry.handle;
    }
    if (cache.size >= 16) throw unavailable('Tantivy native reader budget exceeded.');
    const entry = { handle: null, close: null, closePromise: null, closed: false, owner: null, observations: [], work: [], overflow: false };
    entry.owner = storageContext ? getNativeStorage().acquireNativeReaderStorage(dir, storageContext, () => entry.closed) : null;
    entry.owner?.start();
    let returned = false;
    try {
      entry.handle = adapter.openIndex(dir); returned = true;
      if (!entry.handle || typeof entry.handle.then === 'function') {
        if (types.isPromise(entry.handle)) entry.handle.catch(() => {});
        throw unavailable('Tantivy requires a synchronous native reader.');
      }
      // Capture the physical close before the first query. A later mutation of
      // handle.close cannot replace the native resource's original owner.
      const close = entry.handle.close;
      entry.close = typeof close === 'function' ? close.bind(entry.handle)
        : adapter.closeIndex ? () => adapter.closeIndex(entry.handle) : null;
      if (!entry.close) throw unavailable('Tantivy reader has no supported close operation.');
      if (entry.owner) getNativeStorage().registerNativeReaderStorage(entry.handle, entry.owner);
      cache.set(dir, entry);
      return entry.handle;
    } catch (error) {
      if (returned && entry.handle) {
        // A returned but unclosable/invalid native resource remains protected.
        cache.set(dir, entry);
        if (entry.owner) throw entry.owner.retainFailure(error);
      } else if (entry.owner) entry.owner.failedOpen(error);
      throw error;
    }
  };

  return {
    id: SPARSE_PROVIDER_IDS.TANTIVY,
    available: Boolean(adapter),
    capabilities: Object.freeze({ booleanUniverse: 'eligible-id-completion' }),
    dispose() {
      if (disposing && (!disposalFinished || cache.size === 0)) return disposing;
      disposalStarted = true; disposalFinished = false;
      disposing = (async () => {
        let failure, failed = false;
        for (const [dir, entry] of cache) {
          try {
            await Promise.all(entry.work);
            for (const observation of entry.observations) observation.requireSettled();
            if (!entry.close || entry.overflow) throw unavailable('Tantivy native reader closure remains unconfirmed.');
            // Reconciliation may continue after a previously pending query or
            // metadata failure. The physical close itself is never replayed.
            entry.closePromise ||= Promise.resolve().then(() => entry.close()).then(closed => {
              if (closed !== undefined && closed !== true) throw unavailable('Tantivy close did not confirm its supported completion result.');
              entry.closed = true;
            });
            await entry.closePromise;
            entry.owner?.releaseAfterClosure(); cache.delete(dir);
          } catch (error) {
            const current = entry.owner ? entry.owner.retainFailure(error) : error;
            failure = failed ? addStorageFailureContext(failure, {}, current, { secondaryPresent: true }) : current;
            failed = true;
          }
        }
        if (failed) throw failure;
      })();
      disposing.then(() => { disposalFinished = true; }, () => { disposalFinished = true; });
      return disposing;
    },
    search: ({ idx, queryTokens, mode, topN, allowedIds, includeZeroScores = false, work = null, throwIfAborted = null }) => {
      if (disposalStarted) throw unavailable('Tantivy provider has begun disposal.');
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
      const handle = query ? openIndex(info) : null;
      for (; query;) {
        throwIfAborted?.();
        let rows;
        try { rows = adapter.searchIndex(handle, query, overfetch, mode); }
        catch (error) {
          const entry = cache.get(dir), observation = observeStorageResource(error, { phase: 'tantivy-native-search' });
          if (entry.observations.length >= 128) entry.overflow = true;
          else entry.observations.push(observation);
          if (entry.owner) entry.owner.retainFailure(error);
          throw error;
        }
        if (rows && typeof rows.then === 'function') {
          const entry = cache.get(dir);
          if (types.isPromise(rows) && entry.work.length < 16) {
            let settled = false;
            const observation = observeStorageResource(Object.assign(invalidResponse(), {
              cacheOwnershipPending: true, cacheOwnershipReleased: () => settled
            }), { phase: 'tantivy-async-response' });
            entry.observations.push(observation);
            entry.work.push(rows.then(() => { settled = true; }, error => {
              settled = true;
              entry.observations.push(observeStorageResource(error, { phase: 'tantivy-async-response' }));
              entry.owner?.retainFailure(error);
            }));
          } else entry.overflow = true;
          throw invalidResponse();
        }
        hits = normalizeHits(rows);
        if (Array.isArray(idx.chunkMeta) && hits.some(hit => hit.idx >= idx.chunkMeta.length)) throw invalidResponse();
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
