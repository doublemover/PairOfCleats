import assert from 'node:assert/strict';
import { createLspClient } from '../../../src/integrations/tooling/lsp/client.js';
import { createFramedJsonRpcParser } from '../../../src/shared/jsonrpc.js';
import { FakeChildProcess } from './helpers/fake-child-process.js';

const child = new FakeChildProcess(), messages = [], notifications = [], lifecycle = [];
let wake;
const outbound = createFramedJsonRpcParser({ onMessage: message => { messages.push(message); wake?.(); } });
child.stdin.on('data', chunk => outbound.push(chunk));
const next = async () => {
  if (!messages.length) await new Promise(resolve => { wake = resolve; });
  wake = null; return messages.shift();
};
const respond = message => {
  const body = Buffer.from(JSON.stringify(message));
  child.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
};
const client = createLspClient({ cmd: process.execPath, spawnProcess: () => child,
  onNotification: message => notifications.push(message),
  onRequest: async () => 'server request handled', onLifecycleEvent: event => lifecycle.push(event) });
try {
  const invalid = [
    id => ({ jsonrpc: '2.0', id }),
    id => ({ jsonrpc: '2.0', id, result: null, error: { code: -1, message: 'both' } }),
    ...[null, false, 0, '', [], { code: 1.5, message: 'fraction' }, { code: -1, message: 5 }]
      .map(error => id => ({ jsonrpc: '2.0', id, error })),
    id => ({ id, result: [] }), id => ({ jsonrpc: '1.0', id, result: [] }),
    ...[null, false, 1, {}].map(method => id => ({ jsonrpc: '2.0', id, method })),
    id => ({ jsonrpc: '2.0', id, method: 'conflicting', result: [] })
  ];
  for (const make of invalid) {
    const before = client.getMetrics(), request = client.request('textDocument/documentSymbol', {}, { timeoutMs: 0 });
    const rejected = assert.rejects(request, error => error.code === 'ERR_LSP_PROTOCOL');
    const { id } = await next(); respond(make(id)); await rejected;
    const after = client.getMetrics();
    assert.equal(after.failed, before.failed + 1); assert.equal(after.protocolFailed, before.protocolFailed + 1);
    assert.equal(after.succeeded, before.succeeded); assert.equal(after.timedOut, 0);
    respond({ jsonrpc: '2.0', id, result: [] });
    assert.deepEqual(client.getMetrics(), after, 'late valid responses cannot count twice');
  }
  for (const result of [null, false, 0, [], [{ name: 'x', kind: 12 }]]) {
    const request = client.request('valid', {}, { timeoutMs: 0 });
    const { id } = await next(); respond({ jsonrpc: '2.0', id, result });
    assert.deepEqual(await request, result);
  }
  const serverError = client.request('server-error', {}, { timeoutMs: 0 });
  const expectedError = assert.rejects(serverError, error => error.code === -32602 && error.message === 'invalid params');
  const { id: errorId } = await next();
  respond({ jsonrpc: '2.0', id: errorId, error: { code: -32602, message: 'invalid params' } }); await expectedError;

  let settled = false;
  const typed = client.request('typed-id', {}, { timeoutMs: 0 }).finally(() => { settled = true; });
  const { id } = await next(); respond({ jsonrpc: '2.0', id: String(id), result: 42 });
  respond({ jsonrpc: '2.0', method: 'window/logMessage', params: { message: 'ordinary notification' } });
  respond({ jsonrpc: '2.0', id, method: 'workspace/configuration', params: {} });
  assert.deepEqual(await next(), { jsonrpc: '2.0', id, result: 'server request handled' });
  assert.equal(settled, false, 'server request IDs occupy a different namespace');
  assert.equal(notifications.length, 1);
  respond({ jsonrpc: '2.0', id, result: 42 }); assert.equal(await typed, 42);

  const previous = lifecycle.filter(event => event.kind === 'protocol_envelope_error' && !event.correlated).length;
  for (let index = 0; index < 40; index++) respond({ jsonrpc: '2.0', id: `unknown-${index}` });
  assert.equal(lifecycle.filter(event => event.kind === 'protocol_envelope_error' && !event.correlated).length - previous, 8);
  assert.equal(child.killCalls, 0, 'a malformed correlated envelope does not retire a healthy transport');
} finally {
  child.exitCode = 0; child.emit('exit', 0, null); child.emit('close', 0, null);
  await client.kill(); outbound.dispose(); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
}
console.log('LSP response envelopes preserve typed correlation and valid falsey results, rejecting invalid success claims exactly once.');
