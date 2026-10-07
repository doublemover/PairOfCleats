#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { writeJsonValue } from '../../../src/shared/json-stream/encode.js';
import { writeChunk, writeChunkWithTiming } from '../../../src/shared/json-stream/streams.js';

class Capture extends Writable {
  constructor(highWaterMark) {
    super({ highWaterMark });
    this.chunks = [];
  }
  _write(chunk, _encoding, callback) {
    this.chunks.push(chunk);
    callback();
  }
}

const source = { title: '東京😀\n"quote"', rows: [{ id: 1, values: [0, -2, null, true] },
  { id: 2, text: 'café' }], empty: [], nested: { present: false } };
const originalNow = Date.now;
let clockReads = 0;
try {
  Date.now = () => { clockReads += 1; return originalNow(); };
  // Exercise the real encoder with both accepted writes and native drain events.
  for (const highWaterMark of [64 * 1024, 1]) {
    const stream = new Capture(highWaterMark);
    await writeJsonValue(stream, source, { cooperate: async () => {} });
    assert.equal(Buffer.concat(stream.chunks).toString('utf8'), JSON.stringify(source));
    assert.equal(stream.listenerCount('drain'), 0);
    assert.equal(stream.listenerCount('error'), 0);
    stream.end();
  }
} finally {
  Date.now = originalNow;
}
assert.equal(clockReads, 0, 'plain encoded writes must not collect discarded timing records');

const held = new EventEmitter();
held.write = () => false;
let settled = false;
const pending = writeChunk(held, 'held').then(() => { settled = true; });
await Promise.resolve();
assert.equal(settled, false, 'backpressure must remain pending before drain');
assert.equal(held.listenerCount('drain'), 1);
held.emit('drain');
await pending;
assert.equal(settled, true);
assert.equal(held.listenerCount('drain'), 0);
assert.equal(held.listenerCount('error'), 0);

const errored = new EventEmitter();
errored.write = () => false;
const failure = new Error('controlled stream failure');
const rejected = writeChunk(errored, 'failed');
errored.emit('error', failure);
await assert.rejects(rejected, (error) => error === failure);
assert.equal(errored.listenerCount('drain'), 0);
assert.equal(errored.listenerCount('error'), 0);
const throwing = { write() { throw failure; } };
await assert.rejects(writeChunk(throwing, 'throw'), (error) => error === failure);

const stalled = new EventEmitter();
stalled.write = () => false;
stalled[Symbol.for('pairofcleats.json_stream_wait_timeout_ms')] = 5;
await assert.rejects(writeChunk(stalled, 'timeout'), (error) => error.code === 'JSON_STREAM_WAIT_TIMEOUT');
assert.equal(stalled.listenerCount('drain'), 0);
assert.equal(stalled.listenerCount('error'), 0);

// Callers explicitly requesting timings retain their original measurements.
let now = 0;
try {
  Date.now = () => ++now;
  assert.deepEqual(await writeChunkWithTiming({ write: () => true }, 'timed'),
    { flushMs: 1, backpressureWaitMs: 0 });
  const slow = new EventEmitter();
  slow.write = () => { queueMicrotask(() => slow.emit('drain')); return false; };
  assert.deepEqual(await writeChunkWithTiming(slow, 'timed-drain'),
    { flushMs: 1, backpressureWaitMs: 1 });
  assert.equal(now, 6);
} finally {
  Date.now = originalNow;
}
console.log('Plain JSON writes passed: exact encoded bytes, no discarded clock reads; backpressure/error/timeout and explicit timings preserved');
