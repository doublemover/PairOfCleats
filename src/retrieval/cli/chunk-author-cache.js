import { createHash } from 'node:crypto';

const MAX_ENTRIES = 16, MAX_BYTES = 16 * 1024 * 1024;
const entries = new Map();
let coverageIdentities = new WeakMap();
const prune = () => {
  let bytes = [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  while (entries.size > MAX_ENTRIES || bytes > MAX_BYTES) {
    const key = entries.keys().next().value;
    bytes -= entries.get(key).bytes; entries.delete(key);
  }
};

/** Only complete per-file evidence is retained. A failed/missing file has no
 * negative entry and is eligible on the next request; lower SCM backoff owns
 * its actual provider cooldown. Snapshots never change beneath filter pairs. */
export const acquireChunkAuthorCache = key => {
  const existing = key && entries.get(key);
  if (existing) { entries.delete(key); entries.set(key, existing); return { entry: existing, hit: true }; }
  const entry = { files: new Map(), flights: new Map(), bytes: 0, revision: 0,
    snapshotRevision: -1, snapshot: new Map() };
  if (key) { entries.set(key, entry); prune(); }
  return { entry, hit: false };
};

export const cacheChunkAuthorFile = (key, entry, file, authors) => {
  if (!key || entries.get(key) !== entry) return;
  const previous = entry.files.get(file);
  const complete = previous ? new Map([...previous, ...authors]) : authors;
  const measure = valuesByKey => {
    const textBytes = value => Math.max(Buffer.byteLength(value, 'utf8'), value.length * 2);
    let bytes = 128 + textBytes(file);
    for (const [chunkKey, values] of valuesByKey) {
      bytes += 128 + textBytes(chunkKey);
      for (const author of values) bytes += 32 + textBytes(author);
      if (bytes > MAX_BYTES) return null;
    }
    return bytes;
  };
  const bytes = measure(complete);
  if (bytes === null) return;
  entry.files.set(file, complete); entry.bytes += bytes - (previous ? measure(previous) : 0);
  entry.revision++; prune();
};

export const snapshotChunkAuthors = (entry, current = []) => {
  if (entry.snapshotRevision !== entry.revision) {
    entry.snapshot = new Map();
    for (const authors of entry.files.values()) for (const [key, value] of authors) entry.snapshot.set(key, value);
    entry.snapshotRevision = entry.revision;
  }
  if (!current.length) return entry.snapshot;
  const snapshot = new Map(entry.snapshot);
  for (const authors of current) for (const [key, value] of authors) snapshot.set(key, value);
  return snapshot;
};

export const retireChunkAuthorCache = (key, entry) => {
  if (key && entries.get(key) === entry && !entry.files.size && !entry.flights.size) entries.delete(key);
};
export const bindChunkAuthorCoverage = (coverage, identity) => {
  if (identity) coverageIdentities.set(coverage, createHash('sha256').update(identity).digest('hex'));
};
export const resolveChunkAuthorCacheEvidence = targets => {
  let qualified = true;
  const evidence = {};
  for (const [mode, idx] of targets) {
    const coverage = idx?.chunkAuthorCoverage;
    if (!coverage) continue;
    const identity = coverageIdentities.get(coverage);
    if (coverage.state !== 'complete' || coverage.requested > 0 && !identity) qualified = false;
    if (identity) evidence[mode] = identity;
  }
  return { qualified, evidence: Object.keys(evidence).length ? evidence : null };
};
export const resetChunkAuthorCache = () => { entries.clear(); coverageIdentities = new WeakMap(); };
export const chunkAuthorCacheStats = () => ({ cacheEntries: entries.size,
  cacheBytes: [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0) });
