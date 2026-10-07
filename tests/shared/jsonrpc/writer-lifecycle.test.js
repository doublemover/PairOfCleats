#!/usr/bin/env node
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import {
  closeJsonRpcWriter,
  createFramedJsonRpcParser,
  getJsonRpcWriter
} from '../../../src/shared/jsonrpc.js';

const events = ['close', 'finish', 'error'];
const counts = (stream) => events.map((name) => stream.listenerCount(name));
const stream = new PassThrough();
stream.resume();
const external = () => {};
for (const name of events) stream.on(name, external);
const baseline = counts(stream);
for (let i = 0; i < 20; i++) {
  const writer = getJsonRpcWriter(stream);
  await writer.write({ jsonrpc: '2.0', id: i, result: '🙂' });
  writer.close();
  assert.deepEqual(counts(stream), baseline, 'retired writers must release only their own stream listeners');
  writer.close();
  assert.deepEqual(counts(stream), baseline, 'close must be idempotent');
}

const retired = getJsonRpcWriter(stream);
retired.close();
const current = getJsonRpcWriter(stream);
const currentCounts = counts(stream);
retired.close();
getJsonRpcWriter(stream);
assert.deepEqual(counts(stream), currentCounts, 'a stale handle must not delete the replacement writer cache');
await current.write({ result: 'replacement' });
closeJsonRpcWriter(stream);
assert.deepEqual(counts(stream), baseline);
stream.destroy();

const fragments = [];
let releaseHeader;
let headerWritten;
const headerReady = new Promise((resolve) => { headerWritten = resolve; });
const slow = new Writable({
  write(chunk, _encoding, callback) {
    fragments.push(Buffer.from(chunk));
    if (!releaseHeader) { releaseHeader = callback; headerWritten(); }
    else callback();
  }
});
slow.on('error', external);
const slowBaseline = counts(slow);
const writer = getJsonRpcWriter(slow);
const first = writer.write({ id: 1, result: '𝄞🙂' });
const second = writer.write({ id: 2, result: 'queued' });
const secondRejected = assert.rejects(second, /stream closed/i);
await headerReady;
assert.equal(typeof releaseHeader, 'function');
writer.close();
releaseHeader();
await first;
await secondRejected;
assert.deepEqual(counts(slow), slowBaseline, 'release listeners when the last queued operation settles');
const received = [];
const parser = createFramedJsonRpcParser({ onMessage: (message) => received.push(message) });
for (const byte of Buffer.concat(fragments)) parser.push(Buffer.from([byte]));
assert.deepEqual(received, [{ id: 1, result: '𝄞🙂' }]);
parser.dispose();
slow.destroy();

const orderedChunks = [];
const ordered = new Writable({
  write(chunk, _encoding, callback) {
    orderedChunks.push(Buffer.from(chunk));
    setImmediate(callback);
  }
});
const orderedWriter = getJsonRpcWriter(ordered);
const payloads = [{ id: 1, result: '🙂' }, { id: 2, result: '𝄞' }, { id: 3, result: '' }];
await Promise.all(payloads.map((payload) => orderedWriter.write(payload)));
const expectedBytes = Buffer.concat(payloads.map((payload) => {
  const body = Buffer.from(JSON.stringify(payload));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}));
assert.deepEqual(Buffer.concat(orderedChunks), expectedBytes, 'concurrent writes must preserve exact framing and order');
await new Promise((resolve) => ordered.end(resolve));
assert.deepEqual(counts(ordered), [0, 0, 0], 'natural finish must retire owned listeners');
await assert.rejects(orderedWriter.write({ id: 4 }), /stream closed/i);

let failedWrites = 0;
const broken = new Writable({
  write(_chunk, _encoding, callback) {
    failedWrites++;
    const error = new Error('broken pipe');
    error.code = 'EPIPE';
    callback(error);
  }
});
broken.on('error', external);
const brokenWriter = getJsonRpcWriter(broken);
const results = await Promise.allSettled([brokenWriter.write({ id: 1 }), brokenWriter.write({ id: 2 })]);
assert.ok(results.every((result) => result.status === 'rejected'));
assert.equal(results[0].reason.code, 'EPIPE');
assert.match(results[1].reason.message, /stream closed/i);
assert.equal(failedWrites, 1, 'queued payloads must not write after transport failure');
assert.deepEqual(counts(broken), [0, 0, 1], 'error cleanup must preserve the external stream owner listener');
closeJsonRpcWriter(broken);
console.log('JSON-RPC writer listener retirement, generation identity and queued-close ordering passed');
