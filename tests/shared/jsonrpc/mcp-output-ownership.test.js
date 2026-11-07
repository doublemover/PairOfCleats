import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { createMcpOutput } from '../../../src/integrations/mcp/output.js';
import { getJsonRpcWriter, prepareJsonRpcMessage } from '../../../src/shared/jsonrpc.js';
import { createManualClock } from '../../helpers/manual-clock.js';
import { createMcpTestReader } from '../../helpers/mcp-reader.js';

const frame = payload => {
  const body = Buffer.from(JSON.stringify(payload));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
};
const result = id => ({ jsonrpc: '2.0', id, result: { text: '🙂' } });
const progress = value => ({ jsonrpc: '2.0', method: 'notifications/progress', params: { id: 1, message: value } });
const events = ['error', 'close', 'finish'];
const counts = stream => events.map(event => stream.listenerCount(event));
const fixture = () => {
  const clock = createManualClock(), wire = new PassThrough(), bytes = [];
  const reader = createMcpTestReader(wire, { transport: 'legacy' });
  let blocked = true, callback = null;
  const stream = new Writable({ write(chunk, _encoding, done) {
    bytes.push(Buffer.from(chunk)); wire.write(chunk);
    if (blocked) { assert.equal(callback, null); callback = done; } else done();
  } });
  stream.on('error', () => {});
  const baseline = counts(stream);
  const output = createMcpOutput({ stream, maxFrameBytes: 1024, maxProgressBytes: 256, writeTimeoutMs: 40, flushTimeoutMs: 10 });
  return { clock, reader, stream, output, baseline, bytes,
    release(error) { blocked = false; const done = callback; callback = null; assert.ok(done); done(error); },
    async cleanup() {
      try { if (callback) this.release(); await clock.settle(); await output.finish(); }
      finally { reader.cancelPending(new Error('Fixture complete.')); wire.destroy(); stream.destroy(); clock.restore(); }
    } };
};

{
  const f = fixture();
  try {
    const writes = [f.output.write(progress('first'))];
    await f.clock.settle();
    for (let index = 0; index < 20; index++) writes.push(f.output.write(progress(String(index))));
    writes.push(f.output.write(result(1)), f.output.write(result('1')));
    const held = f.output.getState();
    assert.equal(held.pendingTerminalFrames, 2);
    assert.equal(held.pendingProgressFrames, 2, 'one active plus one latest pending progress frame');
    assert.equal(held.coalescedProgressFrames, 19);
    f.release(); await Promise.all(writes);
    const receipt = await f.output.finish();
    const expected = [progress('first'), result(1), result('1'), progress('19')];
    for (const value of expected) assert.deepEqual(await f.reader.readAnyMessage(), value);
    assert.deepEqual(Buffer.concat(f.bytes), Buffer.concat(expected.map(frame)), 'independent exact wire vectors retain Unicode and typed IDs');
    assert.equal(receipt.status, 'drained'); assert.equal(receipt.retainedWireBytes, 0);
    assert.equal(receipt.deliveredTerminalFrames, 2); assert.equal(receipt.unconfirmedTerminalFrames, 0);
    assert.equal(receipt.streamClosed, false, 'the borrowed stream is distinct from writer retirement');
    assert.deepEqual(counts(f.stream), f.baseline); assert.equal(f.clock.timers.size, 0);
  } finally { await f.cleanup(); }
}

{
  const f = fixture();
  try {
    await assert.rejects(f.output.write({ ...result(3), result: 'x'.repeat(1024) }),
      { code: 'ERR_JSONRPC_MESSAGE_LIMIT' });
    await f.output.write(progress('x'.repeat(256)));
    assert.equal(f.output.getState().droppedProgressFrames, 1);
    assert.equal(f.output.getState().status, 'open', 'oversized data does not itself corrupt the wire');
    const writes = [1, 2, 3, 4].map(id => f.output.write(result(id)));
    const outcomes = Promise.allSettled(writes);
    await f.clock.settle();
    await assert.rejects(f.output.write(result(5)), { reason: 'terminal-admission-limit' });
    assert.ok((await outcomes).every(entry => entry.status === 'rejected'));
    const receipt = await f.output.finish();
    assert.equal(receipt.status, 'failed'); assert.equal(receipt.physicalWritePending, true);
    assert.equal(receipt.unsentTerminalFrames, 3); assert.equal(receipt.unconfirmedTerminalFrames, 1);
    assert.equal(receipt.rejectedTerminalFrames, 2);
    f.release(); await f.clock.settle();
    const final = f.output.getState();
    assert.equal(final.lateDeliveredTerminalFrames, 1); assert.equal(final.unconfirmedTerminalFrames, 0);
    assert.equal(final.retainedWireBytes, 0); assert.equal(final.physicalWritePending, false);
    assert.deepEqual(await f.reader.readMessage(), result(1));
    assert.equal(f.reader.getState().pendingMessages, 0, 'known unsent frames never reach the wire');
    assert.deepEqual(counts(f.stream), f.baseline);
  } finally { await f.cleanup(); }
}

for (const mode of ['nonreading', 'flush']) {
  const f = fixture();
  try {
    const pending = f.output.write(result(1));
    const rejected = assert.rejects(pending, { reason: mode === 'flush' ? 'flush-timeout' : 'write-timeout' });
    await f.clock.settle();
    let closed = false;
    const close = mode === 'flush' ? f.output.finish().then(value => { closed = true; return value; }) : null;
    const allowance = mode === 'flush' ? 10 : 40;
    await f.clock.advance(allowance - 1);
    assert.equal(closed, false); assert.equal(f.output.getState().status, mode === 'flush' ? 'draining' : 'open');
    await f.clock.advance(1); await rejected;
    const receipt = await (close || f.output.finish());
    assert.equal(receipt.status, 'failed'); assert.equal(receipt.unconfirmedTerminalFrames, 1);
    assert.equal(receipt.physicalWritePending, true); assert.equal(receipt.writerRetired, true);
    assert.equal(receipt.streamClosed, false);
    assert.ok(counts(f.stream).some((count, index) => count > f.baseline[index]), 'live physical write keeps its actual listeners');
    f.release(); await f.clock.settle();
    assert.equal(f.output.getState().retainedWireBytes, 0);
    assert.deepEqual(counts(f.stream), f.baseline); assert.equal(f.clock.timers.size, 0);
  } finally { await f.cleanup(); }
}

{
  let serializations = 0;
  const payload = { jsonrpc: '2.0', id: 4, result: { toJSON() { serializations++; return 'captured🙂'; } } };
  const prepared = prepareJsonRpcMessage(payload, { maxBytes: 1024 });
  payload.result = 'mutated';
  const wire = new PassThrough(), reader = createMcpTestReader(wire, { transport: 'legacy' });
  const writer = getJsonRpcWriter(wire);
  try {
    await writer.write(prepared);
    await assert.rejects(writer.write(prepared), { code: 'ERR_JSONRPC_FRAME_CONSUMED' });
    assert.equal(serializations, 1);
    assert.deepEqual(await reader.readMessage(), { jsonrpc: '2.0', id: 4, result: 'captured🙂' });
  } finally { writer.close(); reader.cancelPending(new Error('Fixture complete.')); wire.destroy(); }
}
console.log('Bounded MCP output preserves terminal delivery, coalesces only progress, and retains uncertain physical writes.');
