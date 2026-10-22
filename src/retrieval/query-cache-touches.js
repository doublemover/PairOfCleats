import { loadBoundedJsonFile, loadBoundedJsonFileSync } from '../shared/cache/json-file.js';
import { atomicWriteJson } from '../shared/io/atomic-write.js';
import { withFileLock } from '../shared/locks/file-lock.js';

const MAX_TOUCH_BYTES = 256 * 1024;
const touchPath = cachePath => `${cachePath}.touches.json`;
const validRows = data => data?.version === 1 && Array.isArray(data.entries) ? data.entries.filter(row =>
  typeof row?.key === 'string' && typeof row.signature === 'string' && typeof row.payloadId === 'string'
  && Number.isFinite(row.ts)) : [];

export const loadQueryCacheTouches = cachePath => validRows(loadBoundedJsonFileSync(touchPath(cachePath),
  { maxBytes: MAX_TOUCH_BYTES }).data);

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
export const persistQueryCacheTouch = async ({ cachePath, key, signature, payloadId, ts, maxEntries = 512 }) => {
  if (!cachePath || typeof key !== 'string' || typeof signature !== 'string'
    || typeof payloadId !== 'string' || !payloadId || !Number.isFinite(ts)) return false;
  const limit = Number.isFinite(Number(maxEntries)) ? Math.max(1, Math.floor(Number(maxEntries))) : 512;
  if (limit > 4096) return false;
  return withFileLock({ lockPath: `${cachePath}.lock`, waitMs: 5000, timeoutBehavior: 'throw' }, async () => {
    const { data } = await loadBoundedJsonFile(touchPath(cachePath), { maxBytes: MAX_TOUCH_BYTES });
    const rows = validRows(data), byIdentity = new Map();
    for (const row of rows) byIdentity.set(JSON.stringify([row.key, row.signature, row.payloadId]), row);
    const identity = JSON.stringify([key, signature, payloadId]);
    const existing = byIdentity.get(identity);
    if (existing && existing.ts >= ts) return true;
    byIdentity.set(identity, { key, signature, payloadId, ts });
    const entries = [...byIdentity.values()];
    // A full checkpoint folds all touches before retrying an oversized journal.
    if (entries.length > limit || Buffer.byteLength(JSON.stringify({ version: 1, entries })) > MAX_TOUCH_BYTES) return false;
    await atomicWriteJson(touchPath(cachePath), { version: 1, entries });
    return true;
  });
};

/** Caller must hold the canonical cache lock and finish its durable checkpoint first. */
export const clearQueryCacheTouchesUnlocked = async cachePath => {
  await atomicWriteJson(touchPath(cachePath), { version: 1, entries: [] });
};
