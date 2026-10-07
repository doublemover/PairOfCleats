#!/usr/bin/env node
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { markAsUntransferable } from 'node:worker_threads';
import { createJsonlCompressionPool } from '../../../src/shared/json-stream/jsonl-compression-pool.js';

const pool = createJsonlCompressionPool({ compression: 'gzip', workerCount: 1 });
try {
  const pooled = Buffer.from('small pooled JSONL block\n');
  const backing = Buffer.alloc(128, 65);
  const sliced = backing.subarray(20, 60);
  const marked = Buffer.alloc(32, 66);
  markAsUntransferable(marked.buffer);
  const shared = Buffer.from(new SharedArrayBuffer(32));
  shared.fill(67);
  for (const input of [pooled, sliced, marked, shared]) {
    const expected = Buffer.from(input);
    const compressed = await pool.compress(input);
    assert.deepEqual(gunzipSync(compressed), expected, 'worker must compress only the requested view');
    assert.deepEqual(input, expected, 'pooled and sliced input aliases must remain readable');
  }
  assert.equal(backing.length, 128, 'transferring a slice must not detach its backing buffer');
  assert.equal(backing[0], 65, 'unrelated backing bytes must survive the transfer');
  await pool.waitForIdle();
} finally {
  await pool.close();
}

const failingPool = createJsonlCompressionPool({ compression: 'gzip', workerCount: 1 });
const dispatchError = new Error('synthetic postMessage failure');
failingPool.workers[0].postMessage = () => { throw dispatchError; };
try {
  await assert.rejects(failingPool.compress(Buffer.alloc(32)), (err) => err === dispatchError);
  await assert.rejects(failingPool.waitForIdle(), (err) => err === dispatchError);
  assert.equal(failingPool.pending.size, 0, 'failed dispatch must not strand a pending task');
  assert.equal(failingPool.queue.length, 0, 'failed dispatch must drain queued work');
} finally {
  await failingPool.close();
}

const exitingPool = createJsonlCompressionPool({ compression: 'gzip', workerCount: 1 });
try {
  exitingPool.workers[0].postMessage = () => {};
  const pending = exitingPool.compress(Buffer.alloc(32));
  const queued = exitingPool.compress(Buffer.alloc(32));
  const idle = exitingPool.waitForIdle();
  exitingPool.workers[0].emit('exit', 0);
  for (const result of await Promise.allSettled([pending, queued, idle])) {
    assert.equal(result.status, 'rejected', 'unexpected clean worker exit must settle all waiters');
    assert.match(result.reason.message, /worker exited with code 0/);
  }
} finally {
  await exitingPool.close();
}

console.log('compression pool transfer test passed');
