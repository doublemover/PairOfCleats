import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readCacheIndex, writeCacheIndex, writeCacheEntries, readCacheEntries, flushCacheIndex, encodeCacheEntryPayload } from '../../../tools/build/embeddings/cache.js';
import { getEmbeddingIndexLogMetrics } from '../../../tools/build/embeddings/cache/index-log.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('cache-index-delta-replay');
const identity = 'delta-fixture';
const payload = key => ({ key, file: `${key}.js`, hash: key, cacheMeta: { identityKey: identity }, codeVectors: [[1, 2]], docVectors: [[]], mergedVectors: [[1, 2]] });
const write = async (directory, index, key) => {
  const value = payload(key);
  return writeCacheEntries(directory, index, [{ cacheKey: key, payload: value, encodedPayload: await encodeCacheEntryPayload(value) }], { maxShardBytes: 1024 });
};
try {
  const observations = [];
  for (const count of [16, 32]) {
    const directory = path.join(dir, `growth-${count}`);
    await fs.mkdir(directory, { recursive: true });
    const index = await readCacheIndex(directory, identity), before = getEmbeddingIndexLogMetrics();
    for (let ordinal = 0; ordinal < count; ordinal++) await write(directory, index, `key-${String(ordinal).padStart(3, '0')}`);
    const after = getEmbeddingIndexLogMetrics();
    assert.equal(after.checkpointSerializations - before.checkpointSerializations, 1, 'small growing appends publish deltas rather than full snapshots');
    assert.ok(after.checkpointReads - before.checkpointReads <= 1, 'unchanged writer generation replays only the new log suffix');
    observations.push(after.encodedBytes - before.encodedBytes);
    const loaded = await readCacheIndex(directory, identity, { strict: true });
    assert.equal(Object.keys(loaded.entries).length, count);
    assert.ok(Object.keys(loaded.shards).length > 1, 'bounded fixture exercises shard rotation');
    const [last] = await readCacheEntries(directory, [`key-${String(count - 1).padStart(3, '0')}`], loaded);
    assert.deepEqual(Array.from(last.entry.mergedVectors[0]), [1, 2]);
  }
  assert.ok(observations[1] < observations[0] * 2.5, 'doubling append count does not quadruple metadata encoding');

  const shared = path.join(dir, 'concurrent'); await fs.mkdir(shared);
  const left = await readCacheIndex(shared, identity), right = await readCacheIndex(shared, identity);
  await Promise.all([write(shared, left, 'left'), write(shared, right, 'right')]);
  let current = await readCacheIndex(shared, identity, { strict: true });
  assert.deepEqual(Object.keys(current.entries).sort(), ['left', 'right']);
  current.entries.left.shard = 'caller-mutated';
  assert.notEqual((await readCacheIndex(shared, identity)).entries.left.shard, 'caller-mutated', 'mutable lookup readers do not own the writer memo');

  const logPath = path.join(shared, 'cache.index.delta');
  await fs.appendFile(logPath, Buffer.from([1, 0]));
  assert.deepEqual(Object.keys((await readCacheIndex(shared, identity)).entries).sort(), ['left', 'right']);
  await assert.rejects(readCacheIndex(shared, identity, { strict: true }), /partial tail/);
  await write(shared, left, 'after-tail');
  current = await readCacheIndex(shared, identity, { strict: true });
  assert.deepEqual(Object.keys(current.entries).sort(), ['after-tail', 'left', 'right']);

  const originalOpen = fs.open;
  try {
    fs.open = async function (filename, ...args) {
      const handle = await originalOpen.call(this, filename, ...args);
      if (String(filename) === logPath && args[0] === 'a+') handle.truncate = async () => { throw new Error('checkpoint published before injected log cleanup failure'); };
      return handle;
    };
    await assert.rejects(writeCacheIndex(shared, current), /log cleanup failure/);
  } finally { fs.open = originalOpen; }
  assert.deepEqual(Object.keys((await readCacheIndex(shared, identity, { strict: true })).entries).sort(), ['after-tail', 'left', 'right'],
    'replay ignores records already folded into the published checkpoint');
  const stale = structuredClone(current);
  await flushCacheIndex(shared, current, { maxBytes: 1 });
  await flushCacheIndex(shared, stale);
  assert.equal(Object.keys((await readCacheIndex(shared, identity, { strict: true })).entries).length, 0, 'older epochs cannot resurrect pruned pointers');

  const corrupt = path.join(dir, 'corrupt'); await fs.mkdir(corrupt);
  const corruptIndex = await readCacheIndex(corrupt, identity);
  await write(corrupt, corruptIndex, 'first'); await write(corrupt, corruptIndex, 'second');
  const corruptPath = path.join(corrupt, 'cache.index.delta'), bytes = await fs.readFile(corruptPath);
  bytes[bytes.length - 1] ^= 1; await fs.writeFile(corruptPath, bytes);
  await assert.rejects(readCacheIndex(corrupt, identity, { strict: true }), /checksum mismatch/);
  await assert.rejects(write(corrupt, corruptIndex, 'forbidden'), /checksum mismatch/, 'a complete corrupt record is not treated as a repairable interrupted append');
  assert.equal(Object.keys((await readCacheIndex(corrupt, identity)).entries).length, 0);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Embedding index deltas bound growing metadata work while preserving replay, merge, epoch and interruption authority.');
