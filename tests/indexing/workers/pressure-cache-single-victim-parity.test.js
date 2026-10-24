#!/usr/bin/env node
import assert from 'node:assert/strict';
import { evictDeterministicPressureCacheEntries } from '../../../src/index/build/workers/pool/pressure-controls.js';
const cache = new Map();
for (let index = 0; index < 500; index += 1) {
  const key = `file-${index % 107}`;
  cache.set(key, { sizeBytes: index % 7 ? (index * 7919) % 10000 : NaN, firstSeenAt: index % 13 });
  const expected = new Map(cache);
  const ranked = [...expected].map(([entryKey, value]) => ({ key: entryKey, sizeBytes: Number.isFinite(value.sizeBytes) && value.sizeBytes >= 0 ? value.sizeBytes : 0, firstSeenAt: value.firstSeenAt }))
    .sort((a, b) => b.sizeBytes - a.sizeBytes || a.firstSeenAt - b.firstSeenAt || String(a.key).localeCompare(String(b.key)));
  const victims = ranked.slice(0, Math.max(0, cache.size - 40));
  for (const victim of victims) expected.delete(victim.key);
  assert.deepEqual(evictDeterministicPressureCacheEntries({ cache, maxEntries: 40 }), victims);
  assert.deepEqual([...cache], [...expected]);
}
