import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { closeJsonRpcWriter, getJsonRpcWriteEvidence, getJsonRpcWriter } from '../../../src/shared/jsonrpc.js';

const frame = payload => {
  const body = Buffer.from(JSON.stringify(payload));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
};
for (const retire of ['handle', 'stream']) {
  const header = Promise.withResolvers(), fragments = [];
  let release;
  const stream = new Writable({ write(chunk, _encoding, callback) {
    fragments.push(Buffer.from(chunk));
    if (!release) { release = callback; header.resolve(); } else callback();
  } });
  const original = getJsonRpcWriter(stream), payload = { id: 1, result: '🙂𝄞' };
  const pending = original.write(payload);
  await header.promise;
  if (retire === 'handle') original.close(); else closeJsonRpcWriter(stream);
  const premature = getJsonRpcWriter(stream);
  await assert.rejects(premature.write({ id: 2 }), /stream closed/i,
    'a successor cannot own framing while the original header callback is outstanding');
  assert.equal(fragments.length, 1);
  assert.deepEqual(getJsonRpcWriteEvidence(pending), { frameStarted: true, settled: false, streamRetired: true });
  release(); await pending;
  assert.deepEqual(Buffer.concat(fragments), frame(payload), 'an admitted frame finishes before retirement');
  const successor = getJsonRpcWriter(stream);
  original.close(); premature.close();
  const replacement = { id: 3, result: 'successor' };
  await successor.write(replacement);
  assert.deepEqual(Buffer.concat(fragments), Buffer.concat([frame(payload), frame(replacement)]));
  successor.close(); stream.destroy();
}

// This adapter deliberately remains writable after reporting a write failure:
// physical framing corruption, rather than stream.destroyed, must prevent reuse.
const damaged = new EventEmitter();
let attempted = 0;
const writeFailure = Object.freeze(new Error('partial header failure'));
damaged.write = (_chunk, encoding, callback) => {
  attempted++; (typeof encoding === 'function' ? encoding : callback)(writeFailure);
};
const damagedWriter = getJsonRpcWriter(damaged), damagedWrite = damagedWriter.write({ id: 4 });
await assert.rejects(damagedWrite, error => error === writeFailure);
assert.deepEqual(getJsonRpcWriteEvidence(damagedWrite), { frameStarted: true, settled: true, streamRetired: true });
damagedWriter.close(); closeJsonRpcWriter(damaged);
await assert.rejects(getJsonRpcWriter(damaged).write({ id: 5 }), /stream closed/i);
assert.equal(attempted, 1, 'a damaged physical wire remains retired');

const healthy = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
const healthyWriter = getJsonRpcWriter(healthy), cyclic = {}; cyclic.self = cyclic;
const invalid = healthyWriter.write(cyclic);
await assert.rejects(invalid, /circular/i);
assert.deepEqual(getJsonRpcWriteEvidence(invalid), { frameStarted: false, settled: true, streamRetired: false });
await healthyWriter.write({ id: 6, result: false });
healthyWriter.close(); healthy.destroy();
console.log('JSON-RPC physical framing ownership survives retirement and reacquisition; encoding failures stay local.');
