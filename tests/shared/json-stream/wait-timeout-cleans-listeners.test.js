#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { waitForStreamEvent } from '../../../src/shared/json-stream/streams.js';

const stream = new EventEmitter();

for (let i = 0; i < 32; i += 1) {
  const error = await waitForStreamEvent(stream, 'drain', {
    timeoutMs: 5,
    label: 'wait-timeout-cleans-listeners'
  }).then(() => null, (err) => err);
  assert.ok(error instanceof Error, 'expected timeout error from waitForStreamEvent');
  assert.equal(error.code, 'JSON_STREAM_WAIT_TIMEOUT');
}

assert.equal(stream.listenerCount('drain'), 0, 'expected drain listeners to be cleaned after timeout');
assert.equal(stream.listenerCount('error'), 0, 'expected error listeners to be cleaned after timeout');

console.log('json-stream wait timeout listener cleanup test passed');
