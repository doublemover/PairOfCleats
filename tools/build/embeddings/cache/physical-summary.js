import path from 'node:path';

/** One immutable-index phase: no entry scans are performed by sort callbacks. */
export const buildCachePhysicalSummary = (cacheDir, index, { resolveShardPath, resolveEntryPath, counters = null }) => {
  const paths = new Map(), shards = new Map();
  for (const [key, entry] of Object.entries(index.entries || {})) {
    if (counters) counters.summaryEntryVisits = (counters.summaryEntryVisits || 0) + 1;
    if (!entry || typeof entry !== 'object') continue;
    const physical = entry.shard ? resolveShardPath(cacheDir, entry.shard)
      : entry.path || resolveEntryPath(cacheDir, key);
    if (typeof physical !== 'string' || !physical) continue;
    const filename = path.resolve(physical);
    let summary = paths.get(filename);
    if (!summary) {
      summary = { path: filename, entries: [], keys: [], liveBytes: 0, lastAccessAt: -Infinity };
      paths.set(filename, summary);
    }
    summary.entries.push(entry); summary.keys.push(key);
    summary.liveBytes += Number(entry.length || 0) + 4;
    summary.lastAccessAt = Math.max(summary.lastAccessAt, Date.parse(entry.lastAccessAt || entry.createdAt) || 0);
    if (entry.shard) shards.set(entry.shard, summary);
  }
  return { paths, shards };
};

export const compareCachePhysicalAge = (left, right, summary) => (
  (summary.paths.get(left.path)?.lastAccessAt ?? left.mtimeMs)
  - (summary.paths.get(right.path)?.lastAccessAt ?? right.mtimeMs)
  || left.path.localeCompare(right.path)
);
