import assert from 'node:assert/strict';
import { createLspClient } from '../../../src/integrations/tooling/lsp/client.js';
import { createFramedJsonRpcParser } from '../../../src/shared/jsonrpc.js';
import { FakeChildProcess } from './helpers/fake-child-process.js';

for (const timeoutMs of [0, 50]) {
  const child = new FakeChildProcess(), frames = [], timers = [], cleared = new Set();
  let bytes = 0, wake;
  const parser = createFramedJsonRpcParser({ onMessage: message => { frames.push(message); wake?.(); } });
  child.stdin.on('data', chunk => { bytes += chunk.length; parser.push(chunk); });
  const client = createLspClient({ cmd: process.execPath, spawnProcess: () => child });
  const cyclic = {}; cyclic.self = cyclic;
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  try {
    // The captured request timer is advanced explicitly, including after its
    // cancellation, so no sleep or response-timeout race supplies the evidence.
    globalThis.setTimeout = (callback, ms) => { const timer = { callback, ms }; timers.push(timer); return timer; };
    globalThis.clearTimeout = timer => { cleared.add(timer); };
    await assert.rejects(client.request('invalid-local', cyclic, { timeoutMs }), error =>
      error.code === 'ERR_LSP_REQUEST_WRITE' && /circular/i.test(error.cause.message));
    assert.equal(bytes, 0); assert.equal(child.killCalls, 0);
    assert.equal(timers.length, timeoutMs ? 1 : 0);
    const before = client.getMetrics();
    assert.equal(before.failed, 1); assert.equal(before.localWriteFailed, 1); assert.equal(before.timedOut, 0);
    for (const timer of timers) { assert.ok(cleared.has(timer)); timer.callback(); }
    assert.deepEqual(client.getMetrics(), before); assert.equal(bytes, 0);
  } finally { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; }
  try {
    const pending = client.request('valid-after-local-failure', {}, { timeoutMs: 0 });
    if (!frames.length) await new Promise(resolve => { wake = resolve; });
    const sent = frames.shift();
    assert.equal(sent.method, 'valid-after-local-failure');
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: false }));
    child.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
    assert.equal(await pending, false); assert.equal(client.getMetrics().succeeded, 1);
    assert.equal(client.getMetrics().timedOut, 0); assert.equal(child.killCalls, 0);
  } finally {
    child.exitCode = 0; child.emit('exit', 0, null); child.emit('close', 0, null);
    await client.kill(); parser.dispose(); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
  }
}

for (const responseWins of [false, true]) {
  const child = new FakeChildProcess(), bodyStarted = Promise.withResolvers();
  let writes = 0, releaseBody;
  child.stdin.write = (_chunk, encoding, callback) => {
    const done = typeof encoding === 'function' ? encoding : callback;
    writes++;
    if (writes === 1) done();
    else { releaseBody = done; bodyStarted.resolve(); }
    return true;
  };
  const events = [];
  const client = createLspClient({ cmd: process.execPath, spawnProcess: () => child,
    onLifecycleEvent: event => events.push(event) });
  const first = client.request('partial-frame', {}, { timeoutMs: 0 });
  const firstOutcome = first.then(result => ({ result }), error => ({ error }));
  const sibling = client.request('queued-sibling', {}, { timeoutMs: 0 });
  const siblingOutcome = sibling.catch(error => error);
  try {
    await bodyStarted.promise;
    if (responseWins) {
      const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'won' }));
      child.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
      assert.deepEqual(await firstOutcome, { result: 'won' });
    }
    const original = Object.freeze(new Error('partial body write failed'));
    releaseBody(original);
    const outcome = await firstOutcome, siblingError = await siblingOutcome;
    if (!responseWins) { assert.equal(outcome.error.code, 'ERR_LSP_REQUEST_WRITE'); assert.equal(outcome.error.cause, original); }
    assert.equal(siblingError.code, 'ERR_LSP_TRANSPORT_CLOSED');
    assert.equal(client.isTransportRunning(), false);
    assert.equal(client.getMetrics().succeeded, responseWins ? 1 : 0);
    assert.equal(client.getMetrics().failed, responseWins ? 1 : 2);
    assert.equal(client.getMetrics().localWriteFailed, 0);
    assert.equal(client.getMetrics().timedOut, 0);
    assert.equal(writes, 2, 'no queued frame starts on the damaged wire');
    assert.ok(events.some(event => event.kind === 'reap' && event.reason === 'outbound_write_failed'));
    assert.equal(client.getTerminationEvidence().closeObserved, false, 'retirement is not proof of child closure');
  } finally {
    child.exitCode = 0; child.emit('exit', 0, null); child.emit('close', 0, null);
    await client.kill(); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
  }
}
console.log('Known pre-frame LSP encoding failures retire their own request without timeouts, bytes, cancellation or transport restart.');
