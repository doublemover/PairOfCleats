import { canonicalSemanticJson } from './identity.js';
import { throwIfAborted } from '../../shared/abort.js';

/** Request-owned memo over an already validated directional declaration graph. */
export const createProviderAliasClosureResolver = ({ aliases, known, signal,
  maxWork = 32768, maxCacheBytes = 4 * 1024 * 1024 } = {}) => {
  const memo = new Map();
  const stats = { lookups: 0, hits: 0, aliasVisits: 0, queueAllocations: 0, cacheBytes: 0, remainingWork: maxWork };
  const resolve = root => {
    throwIfAborted(signal); stats.lookups++;
    const rootKey = canonicalSemanticJson(root), cached = memo.get(rootKey);
    if (cached) { stats.hits++; return cached; }
    const targets = new Map(), seen = new Set(), queue = [{ ref: root, depth: 0 }];
    stats.queueAllocations++;
    let truncated = false;
    for (let offset = 0; offset < queue.length; offset++) {
      throwIfAborted(signal);
      if (stats.remainingWork <= 0) { truncated = true; break; }
      stats.remainingWork--; stats.aliasVisits++;
      const { ref, depth } = queue[offset], id = canonicalSemanticJson(ref);
      if (seen.has(id)) continue;
      seen.add(id);
      if (known.has(id)) {
        if (targets.size < 32 || targets.has(id)) targets.set(id, ref);
        else truncated = true;
      }
      const next = aliases.get(id) || [];
      if (depth >= 8) { if (next.length) truncated = true; continue; }
      for (const candidate of next) {
        if (queue.length >= 256) { truncated = true; break; }
        queue.push({ ref: candidate, depth: depth + 1 });
      }
    }
    const result = Object.freeze({ targets: Object.freeze([...targets.values()]), truncated });
    const bytes = Buffer.byteLength(rootKey) + result.targets.reduce((sum, ref) => sum + Buffer.byteLength(canonicalSemanticJson(ref)) + 32, 64);
    if (stats.cacheBytes + bytes <= maxCacheBytes) { memo.set(rootKey, result); stats.cacheBytes += bytes; }
    return result;
  };
  return { resolve, stats };
};
