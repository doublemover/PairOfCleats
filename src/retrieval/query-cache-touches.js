import { loadBoundedJsonFile, loadBoundedJsonFileSync } from '../shared/cache/json-file.js';
import { atomicWriteJson } from '../shared/io/atomic-write.js';
import { withFileLock } from '../shared/locks/file-lock.js';
import path from 'node:path';
import { observeStorageResource } from '../shared/storage/failure-observation.js';
import { types } from 'node:util';

const MAX_TOUCH_BYTES = 256 * 1024;
const MAX_PENDING_PATHS = 128;
const MAX_DRAIN_BATCHES = 2;
const pendingTouches = new Map();
const touchPath = cachePath => `${cachePath}.touches.json`;
const validRows = data => data?.version === 1 && Array.isArray(data.entries) ? data.entries.filter(row =>
  typeof row?.key === 'string' && typeof row.signature === 'string' && typeof row.payloadId === 'string'
  && Number.isFinite(row.ts)) : [];

export const loadQueryCacheTouches = cachePath => validRows(loadBoundedJsonFileSync(touchPath(cachePath),
  { maxBytes: MAX_TOUCH_BYTES }).data);

/** Read-only projection for lifecycle diagnosis. Latest observed use is a
 * lower bound, not proof that no later use occurred. Never grants ownership,
 * deletion authority or an age-based absence claim. Unknown rows invalidate
 * the observation instead of silently disappearing from retention evidence. */
export const observeQueryCacheLastUse = (cache, journal = null) => {
  const unknown = reason => ({ complete: false, reason, timestamp: null, provenance: 'query-cache-use-unknown', bound: 'lower' });
  const passive = value => value && typeof value === 'object' && !types.isProxy(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).every(key => typeof key === 'string' && Object.getOwnPropertyDescriptor(value, key)?.enumerable
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
  const array = (value, max) => {
    if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max
      || Reflect.ownKeys(value).length !== value.length + 1) return false;
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
    }
    return true;
  };
  if (!passive(cache) || Object.keys(cache).sort().join(',') !== 'entries,version' || cache.version !== 1
    || !array(cache.entries, 100000)) return unknown('unrecognized-query-cache-input');
  if (journal !== null && (!passive(journal) || Object.keys(journal).sort().join(',') !== 'entries,version' || journal.version !== 1
    || !array(journal.entries, 4096))) return unknown('unrecognized-query-touch-journal');
  const time = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
  const identity = row => passive(row) && ['key', 'signature', 'payloadId'].every(key => typeof row[key] === 'string' && row[key].length && row[key].length <= 4096);
  const entries = new Map(); let latest = null, matchedTouches = 0;
  for (const entry of cache.entries) {
    if (!identity(entry) || !time(entry.ts)) return unknown('incomplete-query-payload-identity-or-time');
    const key = JSON.stringify([entry.key, entry.signature, entry.payloadId]);
    entries.set(key, Math.max(entries.get(key) ?? 0, entry.ts)); latest = Math.max(latest ?? 0, entry.ts);
  }
  for (const row of journal?.entries || []) {
    if (!identity(row) || Object.keys(row).sort().join(',') !== 'key,payloadId,signature,ts' || !time(row.ts)) return unknown('incomplete-query-touch-observation');
    const key = JSON.stringify([row.key, row.signature, row.payloadId]);
    if (!entries.has(key)) continue;
    latest = Math.max(latest, row.ts); matchedTouches++;
  }
  if (latest === null) return unknown('empty-query-cache-has-no-use-observation');
  return { complete: true, reason: null, timestamp: new Date(latest).toISOString(), bound: 'lower',
    provenance: 'original-query-entries-and-payload-bound-coalesced-touches', entries: cache.entries.length, matchedTouches };
};

export const requireQueryCacheTouchSettlement = cachePath => {
  if (!cachePath) return;
  const canonical = path.resolve(cachePath);
  const state = pendingTouches.get(canonical);
  if (state?.failure) {
    state.failure.requireSettled();
    if (pendingTouches.get(canonical) === state) pendingTouches.delete(canonical);
  }
};

/** A checkpoint joins prior touch publication before claiming the same lock. */
export const awaitQueryCacheTouchPublication = async cachePath => {
  if (!cachePath) return;
  const state = pendingTouches.get(path.resolve(cachePath));
  if (state?.failure) requireQueryCacheTouchSettlement(cachePath);
  else if (state?.promise) await state.promise;
};

/** Apply only recency belonging to this exact immutable cached payload. */
export const applyQueryCacheTouches = (cache, touches = []) => {
  const byKey = new Map((cache?.entries || []).map(entry => [entry?.key, entry]));
  for (const touch of touches) {
    const entry = byKey.get(touch.key);
    if (entry?.signature === touch.signature && entry.payloadId === touch.payloadId)
      entry.ts = Math.max(Number(entry.ts || 0), touch.ts);
  }
  return cache;
};

/** Awaited metadata-only publication shares the canonical result-cache writer lock. */
const flushTouchBatch = async (cachePath, submitted, limit) =>
  withFileLock({ lockPath: `${cachePath}.lock`, waitMs: 5000, timeoutBehavior: 'throw' }, async () => {
    const { data } = await loadBoundedJsonFile(touchPath(cachePath), { maxBytes: MAX_TOUCH_BYTES });
    const rows = validRows(data), byIdentity = new Map();
    let changed = false;
    for (const row of rows) {
      const identity = JSON.stringify([row.key, row.signature, row.payloadId]);
      if (!byIdentity.has(identity) || byIdentity.get(identity).ts < row.ts) byIdentity.set(identity, row);
    }
    for (const row of submitted) {
      const identity = JSON.stringify([row.key, row.signature, row.payloadId]);
      if (byIdentity.has(identity) && byIdentity.get(identity).ts >= row.ts) continue;
      byIdentity.set(identity, row); changed = true;
    }
    if (!changed) return true;
    const entries = [...byIdentity.values()];
    // A full checkpoint folds all touches before retrying an oversized journal.
    if (entries.length > limit || Buffer.byteLength(JSON.stringify({ version: 1, entries })) > MAX_TOUCH_BYTES) return false;
    await atomicWriteJson(touchPath(cachePath), { version: 1, entries });
    return true;
  });

/** Concurrent callers join bounded awaited batches under the existing writer
 * lock. No timer/background flush survives the promise returned to the caller.
 */
export const persistQueryCacheTouch = async ({ cachePath, key, signature, payloadId, ts, maxEntries = 512 }) => {
  if (!cachePath || typeof key !== 'string' || typeof signature !== 'string'
    || typeof payloadId !== 'string' || !payloadId || !Number.isFinite(ts)) return false;
  const limit = Number.isFinite(Number(maxEntries)) ? Math.max(1, Math.floor(Number(maxEntries))) : 512;
  if (limit > 4096) return false;
  const canonical = path.resolve(cachePath);
  const identity = JSON.stringify([key, signature, payloadId]);
  const row = { key, signature, payloadId, ts };
  const bytes = Buffer.byteLength(JSON.stringify(row)) + 1;
  if (bytes + 32 > MAX_TOUCH_BYTES) return false;
  let state = pendingTouches.get(canonical);
  if (state?.failure) {
    state.failure.requireSettled();
    pendingTouches.delete(canonical); state = null;
  }
  if (!state) {
    if (pendingTouches.size >= MAX_PENDING_PATHS) return false;
    state = { rows: new Map(), bytes: 0, limit, promise: null };
    pendingTouches.set(canonical, state);
  }
  const existing = state.rows.get(identity);
  const previousBytes = existing ? Buffer.byteLength(JSON.stringify(existing)) + 1 : 0;
  if ((!existing && state.rows.size >= Math.min(state.limit, limit)) || state.bytes - previousBytes + bytes + 32 > MAX_TOUCH_BYTES) return false;
  if (!existing || existing.ts < ts) {
    state.rows.set(identity, row);
    state.bytes += bytes - previousBytes;
  }
  state.limit = Math.min(state.limit, limit);
  if (!state.promise) {
    const finish = value => {
      if (pendingTouches.get(canonical) === state) pendingTouches.delete(canonical);
      return value;
    };
    state.promise = Promise.resolve().then(async () => {
      for (let batch = 0; batch < MAX_DRAIN_BATCHES; batch++) {
        const submitted = [...state.rows.values()];
        state.rows.clear(); state.bytes = 0;
        if (!await flushTouchBatch(canonical, submitted, state.limit)) return finish(false);
        if (!state.rows.size) return finish(true);
      }
      // The original callers perform the ordinary canonical checkpoint when a
      // busy stream cannot drain within this finite flight's latency bound.
      return finish(false);
    }).catch(error => {
      const observation = observeStorageResource(error, { phase: 'query-cache-touch-publication' });
      try { observation.requireSettled(); }
      catch (pending) {
        state.failure = observation; state.rows.clear(); state.bytes = 0;
        throw pending;
      }
      throw error;
    }).finally(() => { if (!state.failure && pendingTouches.get(canonical) === state) pendingTouches.delete(canonical); });
  }
  return state.promise;
};

/** Caller must hold the canonical cache lock and finish its durable checkpoint first. */
export const clearQueryCacheTouchesUnlocked = async cachePath => {
  await atomicWriteJson(touchPath(cachePath), { version: 1, entries: [] });
};
