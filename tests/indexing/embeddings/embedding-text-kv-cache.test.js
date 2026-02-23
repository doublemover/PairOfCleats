#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPersistentEmbeddingTextKvStore } from '../../../tools/build/embeddings/text-kv-cache.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  Database = null;
}

if (!Database) {
  console.log('embedding text kv cache test skipped (better-sqlite3 unavailable)');
  process.exit(0);
}

const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-text-kv-'));
const cacheIdentity = { key: 'identity' };
const cacheIdentityKey = 'identity-key';

const first = await createPersistentEmbeddingTextKvStore({
  Database,
  cacheRoot,
  cacheIdentity,
  cacheIdentityKey,
  maxEntries: 32
});
assert.ok(first, 'expected persistent text cache store');
assert.equal(first.set('hello world', new Float32Array([1, 2, 3])), true);
const firstRead = first.get('hello world');
assert.ok(firstRead instanceof Float32Array, 'expected float32 vector from cache');
assert.equal(firstRead.length, 3);
await first.close();

const reopened = await createPersistentEmbeddingTextKvStore({
  Database,
  cacheRoot,
  cacheIdentity,
  cacheIdentityKey,
  maxEntries: 32
});
const secondRead = reopened.get('hello world');
assert.ok(secondRead instanceof Float32Array, 'expected vector persisted across reopen');
assert.deepEqual(Array.from(secondRead), [1, 2, 3]);
await reopened.close();

await fs.rm(cacheRoot, { recursive: true, force: true });
console.log('embedding text kv cache test passed');
