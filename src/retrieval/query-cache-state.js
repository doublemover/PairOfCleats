const payloadBytes = new WeakMap();
const snapshots = new WeakMap();

export const freezeQueryCachePayload = value => {
  const pending = [value];
  while (pending.length) {
    const next = pending.pop();
    if (!next || typeof next !== 'object' || Object.isFrozen(next)) continue;
    for (const child of Object.values(next)) pending.push(child);
    Object.freeze(next);
  }
  return value;
};

/** Own one JSON-safe payload; later touches share only these immutable bytes. */
export const snapshotQueryCachePayload = value => {
  const serialized = JSON.stringify(value);
  const payload = freezeQueryCachePayload(JSON.parse(serialized));
  if (payload && typeof payload === 'object') payloadBytes.set(payload, Buffer.byteLength(serialized));
  return payload;
};

export const estimateQueryCacheEntryBytes = entry => {
  const payload = entry.payload;
  if (!payload || typeof payload !== 'object' || !Object.isFrozen(payload)) return Buffer.byteLength(JSON.stringify(entry));
  let bytes = payloadBytes.get(payload);
  if (bytes == null) { bytes = Buffer.byteLength(JSON.stringify(payload)); payloadBytes.set(payload, bytes); }
  return Buffer.byteLength(JSON.stringify({ ...entry, payload: null })) - 4 + bytes;
};

export const recordQueryCacheSnapshot = cache => {
  snapshots.set(cache, { replacements: new Set() });
  return cache;
};

const copyEntryMetadata = entry => ({ ...entry,
  ...(entry.meta && typeof entry.meta === 'object' ? { meta: structuredClone(entry.meta) } : {}) });

export const forkQueryCacheSnapshot = cache => recordQueryCacheSnapshot({ version: 1,
  entries: (cache.entries || []).filter(entry => entry && typeof entry === 'object')
    .map(entry => ({ ...copyEntryMetadata(entry), payload: freezeQueryCachePayload(entry.payload) })) });

export const upsertQueryCacheEntry = (cache, entry, { replacement = true } = {}) => {
  if (!cache || !Array.isArray(cache.entries)) return;
  if (!snapshots.has(cache)) recordQueryCacheSnapshot(cache);
  cache.entries = cache.entries.filter(candidate => candidate?.key !== entry.key);
  cache.entries.push(entry);
  if (replacement) snapshots.get(cache).replacements.add(entry.key);
  delete cache.__lookup;
};

/** Capture before the first lock await; another edit is a later submission. */
export const captureQueryCacheSubmission = cache => ({
  entries: (cache?.entries || []).map(copyEntryMetadata),
  replacements: new Set(snapshots.get(cache)?.replacements || [])
});

export const mergeQueryCacheSubmission = (disk, submitted) => {
  const byKey = new Map();
  for (const entry of disk?.entries || []) {
    if (!entry?.key) continue;
    const resident = byKey.get(entry.key);
    if (!resident || Number(entry.ts || 0) > Number(resident.ts || 0)) byKey.set(entry.key, { ...entry });
  }
  for (const entry of submitted.entries) {
    if (!entry?.key) continue;
    const resident = byKey.get(entry.key);
    if (submitted.replacements.has(entry.key)) {
      if (!resident || Number(entry.ts || 0) >= Number(resident.ts || 0)) byKey.set(entry.key, { ...entry });
    } else if (resident && resident.signature === entry.signature && (resident.payloadId || null) === (entry.payloadId || null)) {
      resident.ts = Math.max(Number(resident.ts || 0), Number(entry.ts || 0));
    }
  }
  return recordQueryCacheSnapshot({ version: 1, entries: [...byKey.values()] });
};

export const acknowledgeQueryCacheSubmission = (cache, submitted) => {
  const state = snapshots.get(cache);
  if (!state) return;
  const currentEntries = new Map(cache.entries.map(entry => [entry?.key, entry]));
  for (const entry of submitted.entries) {
    const current = currentEntries.get(entry.key);
    if (current?.payloadId === entry.payloadId) state.replacements.delete(entry.key);
  }
};
