#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPersistentEmbeddingTextKvStore } from '../../../tools/build/embeddings/text-kv-cache.js';
import { resolveCacheBase } from '../../../tools/build/embeddings/cache.js';

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

const cacheIdentity = {
  key: 'identity',
  provider: 'stub',
  modelId: 'text-kv-test-model',
  dims: 3
};
const cacheIdentityKey = 'identity-key';

const assertApproxVector = (actual, expected, epsilon = 1e-3) => {
  assert.ok(actual instanceof Float32Array, 'expected Float32Array vector');
  assert.equal(actual.length, expected.length, 'vector length mismatch');
  for (let i = 0; i < expected.length; i += 1) {
    assert.ok(
      Math.abs(Number(actual[i]) - Number(expected[i])) <= epsilon,
      `vector mismatch at index ${i}: expected ${expected[i]}, got ${actual[i]}`
    );
  }
};

const readBlobInfo = ({ cacheRoot, identity }) => {
  const dbPath = path.join(resolveCacheBase(cacheRoot, identity), 'text-vectors.sqlite');
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare('SELECT dims, length(vector_blob) AS bytes FROM text_vectors LIMIT 1').get();
  } finally {
    db.close();
  }
};

const float32Root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-text-kv-f32-'));
try {
  const first = await createPersistentEmbeddingTextKvStore({
    Database,
    cacheRoot: float32Root,
    cacheIdentity,
    cacheIdentityKey,
    maxEntries: 32
  });
  assert.ok(first, 'expected persistent text cache store');
  assert.equal(first.stats().vectorEncoding, 'float32', 'expected float32 default encoding');
  assert.equal(first.set('hello world', new Float32Array([1, 2, 3])), true);
  assert.deepEqual(Array.from(first.get('hello world')), [1, 2, 3]);
  await first.close();

  const float32BlobInfo = readBlobInfo({ cacheRoot: float32Root, identity: cacheIdentity });
  assert.equal(float32BlobInfo?.dims, 3, 'expected persisted dims');
  assert.equal(float32BlobInfo?.bytes, 3 * Float32Array.BYTES_PER_ELEMENT, 'expected float32 byte width');

  const reopenedAsFloat16 = await createPersistentEmbeddingTextKvStore({
    Database,
    cacheRoot: float32Root,
    cacheIdentity,
    cacheIdentityKey,
    maxEntries: 32,
    vectorEncoding: 'float16'
  });
  assert.deepEqual(
    Array.from(reopenedAsFloat16.get('hello world')),
    [1, 2, 3],
    'expected float32 payloads to remain readable when float16 option is enabled'
  );
  await reopenedAsFloat16.close();
} finally {
  await fs.rm(float32Root, { recursive: true, force: true });
}

const float16Root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-text-kv-f16-'));
try {
  const float16Store = await createPersistentEmbeddingTextKvStore({
    Database,
    cacheRoot: float16Root,
    cacheIdentity,
    cacheIdentityKey,
    maxEntries: 32,
    vectorEncoding: 'float16'
  });
  assert.ok(float16Store, 'expected float16 store');
  assert.equal(float16Store.stats().vectorEncoding, 'float16', 'expected float16 encoding selection');
  const float16Source = new Float32Array([0.1, -0.2, 3.5]);
  assert.equal(float16Store.set('half precision', float16Source), true);
  assertApproxVector(
    float16Store.get('half precision'),
    float16Source,
    1e-2
  );
  await float16Store.close();

  const float16BlobInfo = readBlobInfo({ cacheRoot: float16Root, identity: cacheIdentity });
  assert.equal(float16BlobInfo?.dims, 3, 'expected persisted dims for float16');
  assert.equal(float16BlobInfo?.bytes, 3 * Uint16Array.BYTES_PER_ELEMENT, 'expected float16 byte width');

  const reopenedAsFloat32 = await createPersistentEmbeddingTextKvStore({
    Database,
    cacheRoot: float16Root,
    cacheIdentity,
    cacheIdentityKey,
    maxEntries: 32,
    vectorEncoding: 'float32'
  });
  assertApproxVector(
    reopenedAsFloat32.get('half precision'),
    float16Source,
    1e-2
  );
  await reopenedAsFloat32.close();
} finally {
  await fs.rm(float16Root, { recursive: true, force: true });
}

console.log('embedding text kv cache test passed');
