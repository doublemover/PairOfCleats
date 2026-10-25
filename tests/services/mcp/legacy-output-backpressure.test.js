import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { PassThrough, Writable } from 'node:stream';
import { createManualClock } from '../../helpers/manual-clock.js';
import { createMcpTestReader } from '../../helpers/mcp-reader.js';

const diagnostics = [];
globalThis.__mcpOutputDiagnostics = diagnostics;
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/tools/mcp/transport.js') && specifier.endsWith('/progress-runtime.js')) {
      return { url: 'outbound-fixture:diagnostics', shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'outbound-fixture:diagnostics') return { format: 'module', shortCircuit: true,
      source: 'export const logError = (...args) => globalThis.__mcpOutputDiagnostics.push(args);' };
    return next(url, context);
  }
});
const { createMcpTransport } = await import('../../../tools/mcp/transport.js');
const frame = value => {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...value }));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
};
const call = (id, name = 'index_status') => ({ id, method: 'tools/call', params: { name, arguments: {} } });
const immediate = () => new Promise(resolve => setImmediate(resolve));
const fixture = (handleToolCall = () => ({ value: 'x'.repeat(100) }), options = {}) => {
  const clock = createManualClock(), input = new PassThrough(), wire = new PassThrough();
  const reader = createMcpTestReader(wire, { transport: 'legacy' });
  const exits = [], dispatched = [], chunks = [];
  let blocked = true, callback = null;
  const stream = new Writable({ write(chunk, _encoding, done) {
    chunks.push(Buffer.from(chunk)); wire.write(chunk);
    if (blocked) callback = done; else done();
  } });
  stream.on('error', () => {});
  const baseline = ['error', 'close', 'finish'].map(event => stream.listenerCount(event));
  const transport = createMcpTransport({ toolDefs: [], serverInfo: { name: 'output-fixture', version: '1' },
    input, outputStream: stream, exit: code => exits.push(code), queueMax: 12,
    resolveToolTimeoutMs: () => 6000,
    handleToolCall: (...args) => { dispatched.push(args[0]); return handleToolCall(...args); },
    outputLimits: { writeTimeoutMs: 40, flushTimeoutMs: 10 }, ...options });
  const parser = transport.start();
  return { clock, input, wire, reader, exits, dispatched, chunks, stream, transport, parser, baseline,
    send(value) { input.write(frame(value)); },
    release(error) { blocked = false; const done = callback; callback = null; assert.ok(done); done(error); },
    async until(predicate) {
      for (let count = 0; count < 300 && !predicate(); count++) await clock.settle();
      assert.ok(predicate(), 'bounded microtask progress must reach the requested ownership state');
    },
    async cleanup() {
      try { if (callback) this.release(); await clock.settle(); await transport.close(); }
      finally {
        reader.cancelPending(new Error('Fixture complete.')); input.destroy(); wire.destroy(); stream.destroy(); clock.restore();
      }
    } };
};
const assertRetired = f => {
  assert.equal(f.transport.getState().activeTasks, 0);
  assert.equal(f.transport.getState().pendingRequests, 0);
  assert.equal(f.transport.getState().inFlightRequests, 0);
  for (const event of ['data', 'end', 'error']) assert.equal(f.input.listenerCount(event), 0);
  assert.deepEqual(['error', 'close', 'finish'].map(event => f.stream.listenerCount(event)), f.baseline);
  assert.equal(f.clock.timers.size, 0);
};

try {
  {
    const f = fixture();
    try {
      const requests = [call(0), call('0', 'slow-fixture'), { id: 'list-first', method: 'tools/list' }];
      for (let index = 1; index <= 64; index++) {
        requests.push(call(index), { id: 'list-' + index, method: 'tools/list' });
      }
      f.input.write(Buffer.concat(requests.map(frame)));
      await f.clock.settle();
      const held = f.transport.getState();
      assert.equal(held.input.paused, true); assert.equal(f.input.isPaused(), true);
      assert.equal(f.dispatched.length, 2, 'a finite control flood cannot admit tools behind stalled control delivery');
      assert.equal(held.inFlightRequests, 2, 'completed executions retain identity until response delivery');
      assert.ok(held.output.pendingTerminalFrames <= 3);
      assert.ok(held.output.retainedWireBytes < 8192);
      assert.ok(held.input.bufferedBytes > 0 && held.input.bufferedBytes < 32768);
      f.release();
      await f.until(() => f.transport.getState().output.deliveredTerminalFrames === requests.length);
      const received = [];
      for (const _request of requests) received.push(await f.reader.readMessage());
      assert.deepEqual(received.map(value => typeof value.id + ':' + value.id).sort(),
        requests.map(value => typeof value.id + ':' + value.id).sort(), 'every admitted terminal arrives once with exact typed identity');
      assert.ok(received.every(value => !value.error && !value.result.isError));
      assert.equal(f.dispatched.length, 66);
      const receipt = await f.transport.close(); assert.equal(receipt.status, 'drained');
      assert.equal(receipt.unsentTerminalFrames, 0); assert.equal(receipt.unconfirmedTerminalFrames, 0);
      assertRetired(f);
      console.log(JSON.stringify({ case: 'finite-control-tool-flood', requests: requests.length,
        payloadBytes: 100, dispatchCount: f.dispatched.length, stalledOutputBytes: held.output.retainedWireBytes,
        stalledOutputFrames: held.output.pendingTerminalFrames, peakWireBytes: receipt.peakRetainedWireBytes }));
    } finally { await f.cleanup(); }
  }
  {
    let releaseWork, signal;
    const work = new Promise(resolve => { releaseWork = resolve; });
    const f = fixture(async (_name, _args, context) => { signal = context.signal; await work; return { ok: true }; },
      { queueMax: 2, resolveToolTimeoutMs: () => 20 });
    try {
      f.send(call(1)); f.send(call(2)); await f.clock.settle();
      await f.clock.advance(20);
      assert.equal(signal.aborted, true); assert.equal(f.dispatched.length, 1);
      assert.equal(f.transport.getState().inFlightRequests, 1);
      let completed = false;
      const closing = f.transport.close().then(receipt => { completed = true; return receipt; });
      await f.clock.advance(10);
      assert.equal(completed, false, 'failed flush cannot release still-running tool/native work');
      assert.equal(f.transport.getState().activeTasks, 1);
      assert.equal(f.dispatched.length, 1, 'queued work cannot start during teardown');
      releaseWork(); const receipt = await closing;
      assert.equal(receipt.status, 'failed'); assert.equal(receipt.failure.reason, 'flush-timeout');
      assert.equal(receipt.unsentTerminalFrames, 1); assert.equal(receipt.unconfirmedTerminalFrames, 1);
      assert.equal(receipt.physicalWritePending, true, 'failure receipt does not attest callback disposal');
      f.release(); await f.clock.settle();
      assert.equal(JSON.parse((await f.reader.readMessage()).result.content[0].text).code, 'TOOL_TIMEOUT');
      assertRetired(f);
    } finally { releaseWork(); await f.cleanup(); }
  }
  {
    const f = fixture();
    try {
      f.input.end(frame(call('eof')));
      await immediate(); await f.clock.settle();
      assert.equal(f.input.readableEnded, true, 'exercise actual stream EOF, rather than emitting a synthetic end');
      assert.equal(f.transport.getState().stopped, true);
      assert.deepEqual(f.exits, [], 'EOF cannot exit while a response frame is outstanding');
      f.release(); await f.until(() => f.exits.length === 1);
      assert.deepEqual(f.exits, [0]); assert.equal((await f.reader.readMessage()).id, 'eof');
      assertRetired(f);
    } finally { await f.cleanup(); }
  }
  {
    let releaseWork;
    const work = new Promise(resolve => { releaseWork = resolve; });
    let signal;
    const f = fixture(async (_name, _args, context) => { signal = context.signal; await work; return { ok: true }; });
    try {
      f.send(call('active')); f.send(call('queued')); await f.clock.settle();
      f.send({ method: '$/cancelRequest', params: { id: 'queued' } }); await f.clock.settle();
      assert.equal(f.transport.getState().pendingRequests, 1, 'queued cancellation retains identity while its reply is blocked');
      assert.equal(f.dispatched.length, 1);
      const close = f.transport.close();
      assert.equal(signal.aborted, true, 'shutdown aborts active work before waiting for output');
      releaseWork(); f.release();
      const receipt = await close;
      assert.equal(receipt.status, 'drained'); assert.equal(receipt.deliveredTerminalFrames, 2);
      const replies = [await f.reader.readMessage(), await f.reader.readMessage()];
      assert.deepEqual(replies.map(value => value.id).sort(), ['active', 'queued']);
      assert.ok(replies.every(value => JSON.parse(value.result.content[0].text).code === 'CANCELLED'));
      assert.equal(f.dispatched.length, 1, 'pending cancellation and close reuse one original response owner');
      assertRetired(f);
    } finally { releaseWork(); await f.cleanup(); }
  }
  {
    const f = fixture();
    try {
      f.input.write(Buffer.concat([frame({ id: 'shutdown', method: 'shutdown' }), frame({ method: 'exit' })]));
      await f.clock.settle();
      assert.equal(f.transport.getState().closing, true); assert.deepEqual(f.exits, []);
      f.release(); await f.until(() => f.exits.length === 1);
      assert.deepEqual(await f.reader.readMessage(), { jsonrpc: '2.0', id: 'shutdown', result: {} });
      assert.deepEqual(f.exits, [0]); assertRetired(f);
    } finally { await f.cleanup(); }
  }
  for (const code of ['EPIPE', 'EIO']) {
    const f = fixture();
    try {
      const offset = diagnostics.length;
      f.input.write(Buffer.concat([frame({ id: 1, method: 'tools/list' }), frame(call(2))]));
      await f.clock.settle();
      f.release(Object.assign(new Error('Expected fixture write failure.'), { code }));
      await immediate(); await f.until(() => f.exits.length === 1);
      assert.deepEqual(f.exits, [1]); assert.equal(f.dispatched.length, 0);
      assert.equal(f.transport.getState().output.status, 'failed');
      assert.equal(diagnostics.slice(offset).filter(([message]) => message === '[mcp] output error').length, 1);
      const receipt = diagnostics.slice(offset).find(([message]) => message === '[mcp] output delivery failed')[1].output;
      assert.equal(receipt.failure.code, code); assert.equal(receipt.unconfirmedTerminalFrames, 1);
      f.send(call(3)); await f.clock.settle(); assert.equal(f.dispatched.length, 0);
      assertRetired(f);
    } finally { await f.cleanup(); }
  }
  {
    const f = fixture(() => ({ value: 'x'.repeat(4096) }),
      { outputLimits: { maxFrameBytes: 512, writeTimeoutMs: 40, flushTimeoutMs: 10 } });
    try {
      f.send(call('large')); await f.clock.settle(); f.release();
      await f.until(() => f.transport.getState().output.deliveredTerminalFrames === 1);
      const value = await f.reader.readMessage();
      assert.equal(value.id, 'large'); assert.equal(value.error.code, -32603);
      assert.deepEqual(value.error.data, { code: 'INTERNAL', reason: 'output-limit' });
      f.send({ id: 2, method: 'resources/list' });
      await f.until(() => f.transport.getState().output.deliveredTerminalFrames === 2);
      assert.deepEqual((await f.reader.readMessage()).result, { resources: [] });
      assert.equal((await f.transport.close()).status, 'drained'); assertRetired(f);
    } finally { await f.cleanup(); }
  }
} finally { hook.deregister(); delete globalThis.__mcpOutputDiagnostics; }
console.log('Actual legacy transport bounds control/tool admission, drains EOF and retains native execution through failed output.');
