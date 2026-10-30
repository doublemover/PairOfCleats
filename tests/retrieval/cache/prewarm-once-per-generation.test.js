import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadQueryCache, findQueryCacheEntry, rememberQueryCacheEntry } from '../../../src/retrieval/query-cache.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
const { dir } = await prepareIsolatedTestCacheDir('prewarm-once-per-generation');
try {
  const cachePath = path.join(dir, 'cache.json'), now = Date.now();
  const entries = Array.from({ length: 512 }, (_, id) => ({ key: `k${id}`, signature: 'generation', ts: now - id, payload: { id } }));
  await fs.writeFile(cachePath, JSON.stringify({ version: 1, entries }));
  const originalSort = Array.prototype.sort;
  let sorts = 0;
  try {
    Array.prototype.sort = function (...args) {
      if (this.length === 512 && this[0]?.key?.startsWith('k')) sorts++;
      return originalSort.apply(this, args);
    };
    loadQueryCache(cachePath, { prewarm: true, prewarmMaxEntries: 128, maxHotEntries: 512 });
    rememberQueryCacheEntry(cachePath, 'read-through', 'generation', { key: 'read-through', signature: 'generation', ts: now + 1, payload: {} }, 512);
    for (let query = 0; query < 10; query++) loadQueryCache(cachePath, { prewarm: true, prewarmMaxEntries: 128, maxHotEntries: 512 });
    assert.equal(sorts, 1);
    assert.ok(findQueryCacheEntry(null, 'read-through', 'generation', { cachePath, strategy: 'memory-first' }));
  } finally { Array.prototype.sort = originalSort; }
  await fs.writeFile(cachePath, JSON.stringify({ version: 1, entries: [{ key: 'replacement', signature: 'next', ts: now + 2, payload: {} }] }));
  const replacement = loadQueryCache(cachePath, { prewarm: true, prewarmMaxEntries: 1, maxHotEntries: 2 });
  assert.ok(findQueryCacheEntry(replacement, 'replacement', 'next', { cachePath, strategy: 'disk-first' }));
  const stale = { ts: now - 10000, payload: {} };
  rememberQueryCacheEntry(cachePath, 'stale', 'next', stale, 2);
  assert.equal(findQueryCacheEntry(null, 'stale', 'next', { cachePath, strategy: 'memory-first', memoryFreshMs: 1 }), null);
  assert.equal(findQueryCacheEntry(null, 'replacement', 'next', { cachePath, strategy: 'disk-first' }), null, 'disk-first does not fall back to memory');
  await fs.writeFile(cachePath, '{broken');
  const warnings = [];
  assert.deepEqual(loadQueryCache(cachePath, { prewarm: true, onWarning: warning => warnings.push(warning) }).entries, []);
  assert.ok(warnings.some(warning => warning.includes('read/parse failed')));
  assert.equal(findQueryCacheEntry(null, 'replacement', 'next', { cachePath, strategy: 'memory-first' }), null);
  rememberQueryCacheEntry(cachePath, 'absent', 'next', { ts: now }, 2);
  loadQueryCache(cachePath);
  assert.equal(findQueryCacheEntry(null, 'absent', 'next', { cachePath, strategy: 'memory-first' }), null);
  for (let index = 0; index < 129; index++) rememberQueryCacheEntry(`${cachePath}-${index}`, 'resident', 'generation', { ts: now }, 2);
  assert.equal(findQueryCacheEntry(null, 'resident', 'generation', { cachePath: `${cachePath}-0`, strategy: 'memory-first' }), null);
  assert.ok(findQueryCacheEntry(null, 'resident', 'generation', { cachePath: `${cachePath}-128`, strategy: 'memory-first' }));
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Hot-cache prewarm runs once per disk generation and preserves bounded read-through state.');
