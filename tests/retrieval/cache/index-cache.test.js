#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { INDEX_SIGNATURE_TTL_MS, loadIndexWithCache } from '../../../src/retrieval/index-cache.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-index-cache-'));
const indexDir = path.join(tempRoot, 'index');
await fs.mkdir(indexDir, { recursive: true });

const writeMeta = async (value) => {
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(value));
};

const cache = new Map();
let loads = 0;
const loader = () => {
  loads += 1;
  return { loaded: loads };
};

await writeMeta([{ id: 1 }]);
const first = await loadIndexWithCache(cache, indexDir, { modelIdDefault: 'm', fileChargramN: 3 }, loader);
const second = await loadIndexWithCache(cache, indexDir, { modelIdDefault: 'm', fileChargramN: 3 }, loader);
assert.equal(loads, 1, 'cache should prevent reloads');
assert.equal(first.loaded, second.loaded, 'cached result should match');

const chunkMetaModeCache = new Map();
let chunkMetaModeLoads = 0;
const chunkMetaModeLoader = () => {
  chunkMetaModeLoads += 1;
  return { loaded: chunkMetaModeLoads };
};
await loadIndexWithCache(
  chunkMetaModeCache,
  indexDir,
  { modelIdDefault: 'm', fileChargramN: 3, includeChunkMetaCold: false },
  chunkMetaModeLoader
);
await loadIndexWithCache(
  chunkMetaModeCache,
  indexDir,
  { modelIdDefault: 'm', fileChargramN: 3, includeChunkMetaCold: false },
  chunkMetaModeLoader
);
await loadIndexWithCache(
  chunkMetaModeCache,
  indexDir,
  { modelIdDefault: 'm', fileChargramN: 3, includeChunkMetaCold: true },
  chunkMetaModeLoader
);
assert.equal(
  chunkMetaModeLoads,
  2,
  'cache key should include includeChunkMetaCold to avoid stale meta shape reuse'
);

await writeMeta([{ id: 2 }]);
const originalNow = Date.now;
let now = originalNow();
Date.now = () => now;
let third;
try {
  now += INDEX_SIGNATURE_TTL_MS + 1;
  third = await loadIndexWithCache(cache, indexDir, { modelIdDefault: 'm', fileChargramN: 3 }, loader);
} finally {
  Date.now = originalNow;
}
assert.equal(loads, 2, 'cache should reload after signature change');
assert.notEqual(third.loaded, first.loaded, 'reloaded result should differ');

console.log('index cache tests passed');
