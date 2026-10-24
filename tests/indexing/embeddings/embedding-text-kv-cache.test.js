#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
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
  assert.equal(reopenedAsFloat16.get('hello world'), null, 'precision transitions require their own qualified row');
  assert.equal(reopenedAsFloat16.set('hello world', Float32Array.from([1, 2, 3])), true);
  assert.deepEqual(Array.from(reopenedAsFloat16.get('hello world')), [1, 2, 3]);
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
  assert.equal(reopenedAsFloat32.get('half precision'), null, 'fp32 cannot silently reuse a lower-precision row');
  assert.equal(reopenedAsFloat32.set('half precision', float16Source), true);
  assertApproxVector(reopenedAsFloat32.get('half precision'), float16Source);
  await reopenedAsFloat32.close();
} finally {
  await fs.rm(float16Root, { recursive: true, force: true });
}

const integrityRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-text-kv-integrity-'));
try {
  const identity = { ...cacheIdentity, dims: 4 };
  const base = resolveCacheBase(integrityRoot, identity);
  const originalStore = await createPersistentEmbeddingTextKvStore({ Database, cacheRoot: integrityRoot,
    cacheIdentity: identity, cacheIdentityKey });
  assert.ok(originalStore, 'the real producer first establishes this profile authority');
  await originalStore.close();
  const dbPath = path.join(base, 'text-vectors.sqlite');
  const legacy = new Database(dbPath);
  legacy.exec(`DROP TABLE text_vectors;
    CREATE TABLE text_vectors (cache_key TEXT PRIMARY KEY, dims INTEGER NOT NULL,
    vector_blob BLOB NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    last_access_at TEXT NOT NULL, hit_count INTEGER NOT NULL DEFAULT 0)`);
  const legacyKey = createHash('sha1').update(`${cacheIdentityKey}\nlegacy`).digest('hex');
  legacy.prepare('INSERT INTO text_vectors VALUES (?, 4, ?, ?, ?, ?, 0)').run(legacyKey,
    Buffer.from(Float32Array.from([1, 2, 3, 4]).buffer), 'legacy', 'legacy', 'legacy');
  legacy.close();
  const store = await createPersistentEmbeddingTextKvStore({ Database, cacheRoot: integrityRoot,
    cacheIdentity: identity, cacheIdentityKey });
  assert.ok(store);
  assert.equal(store.get('legacy'), null, 'legacy rows are invalidated without guessing their encoding');
  const raw = new Database(dbPath);
  try {
    assert.equal(raw.prepare('SELECT hit_count FROM text_vectors WHERE cache_key = ?').get(legacyKey).hit_count, 0);
    const corruptions = [
      row => raw.prepare('UPDATE text_vectors SET vector_blob = ? WHERE cache_key = ?').run(row.vector_blob.subarray(0, 8), row.cache_key),
      row => raw.prepare('UPDATE text_vectors SET vector_blob = ? WHERE cache_key = ?').run(row.vector_blob.subarray(0, 13), row.cache_key),
      row => raw.prepare('UPDATE text_vectors SET vector_blob = ? WHERE cache_key = ?').run(Buffer.concat([row.vector_blob, Buffer.from([0])]), row.cache_key),
      row => raw.prepare('UPDATE text_vectors SET dims = 5 WHERE cache_key = ?').run(row.cache_key),
      row => raw.prepare('UPDATE text_vectors SET format_version = 999 WHERE cache_key = ?').run(row.cache_key),
      row => raw.prepare("UPDATE text_vectors SET vector_encoding = 'float16' WHERE cache_key = ?").run(row.cache_key),
      row => raw.prepare("UPDATE text_vectors SET vector_encoding = 'unknown' WHERE cache_key = ?").run(row.cache_key),
      row => raw.prepare('UPDATE text_vectors SET payload_bytes = 15 WHERE cache_key = ?').run(row.cache_key),
      row => {
        const changed = Buffer.from(row.vector_blob); changed[7] ^= 1;
        raw.prepare('UPDATE text_vectors SET vector_blob = ? WHERE cache_key = ?').run(changed, row.cache_key);
      },
      row => {
        const changed = Buffer.from(row.vector_blob); changed.writeFloatLE(Infinity, 0);
        const digest = createHash('sha256').update('2\nfloat32\n4\n16\n').update(changed).digest('hex');
        raw.prepare('UPDATE text_vectors SET vector_blob = ?, payload_sha256 = ? WHERE cache_key = ?').run(changed, digest, row.cache_key);
      }
    ];
    for (const corrupt of corruptions) {
      assert.equal(store.set('malformed', Float32Array.from([1, 2, 3, 4])), true);
      const row = raw.prepare('SELECT * FROM text_vectors WHERE format_version = 2').get();
      const before = store.stats();
      corrupt(row);
      assert.equal(store.get('malformed'), null, 'malformed cache rows are recoverable misses');
      assert.equal(store.stats().hits, before.hits);
      assert.equal(store.stats().misses, before.misses + 1);
      assert.equal(raw.prepare('SELECT hit_count FROM text_vectors WHERE cache_key = ?').get(row.cache_key).hit_count, 0,
        'rejected rows are never touched as successful hits');
    }
    assert.equal(store.set('malformed', [1, 2, 3, 4]), true);
    assert.deepEqual(Array.from(store.get('malformed')), [1, 2, 3, 4]);
    assert.equal(store.set('wrong width', [1]), false);
    assert.equal(store.set('nonfinite', [1, 2, NaN, 4]), false);
  } finally { raw.close(); await store.close(); }
} finally { await fs.rm(integrityRoot, { recursive: true, force: true }); }

const roundingRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-text-kv-f16-boundary-'));
try {
  const midpoint = 2 ** -14 - 2 ** -25;
  const values = Float32Array.from([midpoint, -midpoint, midpoint - 2 ** -37, -(midpoint - 2 ** -37),
    1 + 2 ** -11, -(1 + 2 ** -11), 1 + 3 * 2 ** -11, -(1 + 3 * 2 ** -11)]);
  const store = await createPersistentEmbeddingTextKvStore({ Database, cacheRoot: roundingRoot,
    cacheIdentity: { ...cacheIdentity, dims: values.length }, cacheIdentityKey, vectorEncoding: 'float16' });
  assert.ok(store);
  try {
    assert.equal(store.set('ties', values), true);
    assert.deepEqual(Array.from(store.get('ties')), [2 ** -14, -(2 ** -14), 2 ** -14 - 2 ** -24,
      -(2 ** -14 - 2 ** -24), 1, -1, 1 + 2 ** -9, -(1 + 2 ** -9)], 'half ties round to even across both signs');
    assert.equal(store.set('overflow', new Float32Array(values.length).fill(1e10)), false);
  } finally { await store.close(); }
} finally { await fs.rm(roundingRoot, { recursive: true, force: true }); }

const longRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-text-kv-long-'));
try {
  const cacheRoot = path.join(longRoot, 'nested-cache-'.repeat(12));
  const store = await createPersistentEmbeddingTextKvStore({ Database, cacheRoot, cacheIdentity, cacheIdentityKey });
  assert.ok(store, 'the original profile owner admits a deeply nested native SQLite database');
  try {
    assert.equal(store.set('long path', Float32Array.of(1, 2, 3)), true);
    assert.deepEqual(Array.from(store.get('long path')), [1, 2, 3]);
    const dbPath = path.join(resolveCacheBase(cacheRoot, cacheIdentity), 'text-vectors.sqlite');
    assert.ok(dbPath.length > 260, 'exercise the Windows legacy path boundary without changing the profile layout');
    assert.equal((await fs.stat(dbPath)).isFile(), true);
  } finally { await store.close(); }
} finally { await fs.rm(longRoot, { recursive: true, force: true }); }

console.log('embedding text kv cache test passed');
