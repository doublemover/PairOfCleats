import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createPersistentEmbeddingTextKvStore } from '../../../tools/build/embeddings/text-kv-cache.js';
import { createEmbeddingTextReuseCache } from '../../../tools/build/embeddings/runner.js';
const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-text-batch-'));
try {
  const options = { Database, cacheRoot, cacheIdentity: { key:'batch', provider:'stub', modelId:'batch', dims:2 }, cacheIdentityKey:'batch', maxEntries:100 };
  const store = await createPersistentEmbeddingTextKvStore(options);
  for (let i = 0; i < 32; i++) store.set(`text-${i}`, Float32Array.of(i, 1));
  assert.equal(store.stats().transactions, 0, 'bounded writes wait for one transaction');
  assert.equal(store.flush(), true);
  assert.equal(store.stats().transactions, 1); assert.equal(store.stats().writes, 32);
  for (let i = 0; i < 20; i++) assert.deepEqual(Array.from(store.get('text-1')), [1,1]);
  assert.equal(store.stats().transactions, 1, 'hits coalesce advisory touches');
  assert.equal(store.stats().pendingTouches, 1); assert.equal(store.stats().touchesCoalesced, 19);
  for (let i = 0; i < 20; i++) store.set('text-1', Float32Array.of(1,1));
  assert.equal(store.stats().writesAvoided, 20);
  const memory = createEmbeddingTextReuseCache({ persistentStore:store });
  memory.promote('joined', Float32Array.of(5,6));
  assert.equal(store.stats().pendingWrites, 0, 'joiner memory promotion cannot rewrite persistent blobs');
  store.set('last', Float32Array.of(7,8)); await store.close(); await store.close();
  const reopened = await createPersistentEmbeddingTextKvStore(options);
  assert.deepEqual(Array.from(reopened.get('last')), [7,8], 'normal close drains vectors');
  await reopened.close();
} finally { await fs.rm(cacheRoot, {recursive:true,force:true}); }
console.log('text cache batched write and touch passed');