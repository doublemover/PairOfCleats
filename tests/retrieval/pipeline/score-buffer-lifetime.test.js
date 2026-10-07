import assert from 'node:assert/strict';
import { createScoreBufferPool } from '../../../src/retrieval/pipeline/score-buffer.js';

const fields = ['idx', 'score', 'payload'];
const pool = createScoreBufferPool({ maxBuffers: 2, maxEntries: 100 });
const buffer = pool.acquire({ fields, capacity: 0 });
let array = buffer.numericArrays.idx;
let growths = 0;
const entries = [];
for (let index = 0; index < 97; index += 1) {
  entries.push(buffer.push({ idx: index, score: index / 10, payload: { index } }));
  if (array !== buffer.numericArrays.idx) { growths += 1; array = buffer.numericArrays.idx; }
}
assert.ok(growths <= 5, `geometric growth, got ${growths}`);
assert.equal(buffer.entries.length, 100, 'growth respects the retention ceiling');
assert.deepEqual(entries.map((entry) => entry.idx), Array.from({ length: 97 }, (_, index) => index));
assert.deepEqual(entries.map((entry) => entry.score), Array.from({ length: 97 }, (_, index) => index / 10));
buffer.reset();
assert.ok(entries.every((entry) => entry.payload === null), 'reset retires the large active prefix');
const small = buffer.push({ idx: 10, score: 2, payload: { nested: true } });
pool.release(buffer);
assert.equal(small.payload, null);
assert.equal(pool.owns(buffer), false, 'released lease is inactive');
const releases = pool.stats.releases;
pool.release(buffer);
assert.equal(pool.stats.releases, releases, 'duplicate release has no effect');
const reused = pool.acquire({ fields, capacity: 1 });
const concurrent = pool.acquire({ fields, capacity: 1 });
assert.equal(reused, buffer);
assert.notEqual(concurrent, reused, 'a released buffer cannot occupy the pool twice');
assert.equal(reused.count, 0);
pool.release(reused);
pool.release(concurrent);

const tiny = createScoreBufferPool({ maxEntries: 2 });
const dropped = tiny.acquire({ fields, capacity: 3 });
const droppedEntry = dropped.push({ idx: 1, score: 1, payload: { dropped: true } });
tiny.release(dropped);
assert.equal(droppedEntry.payload, null, 'oversized drops also release references');
assert.equal(tiny.stats.drops, 1);
const failed = pool.acquire({ fields });
try {
  failed.push({ idx: 1, score: 2, get payload() { throw new Error('injected value failure'); } });
  assert.fail('expected injected failure');
} catch (error) { assert.equal(error.message, 'injected value failure'); }
finally { pool.release(failed); }
assert.equal(failed.count, 0);
assert.equal(failed.entries[0].payload, null);
console.log(`Score buffer lifetime passed; ${growths} growths for97 pushes, legacy97`);
