import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { setImmediate as turn } from 'node:timers/promises';
import { createFramedJsonRpcParser } from '../../src/shared/jsonrpc.js';
import { createOwnedStdioClient } from '../../tools/tui/operator/stdio-client.js';

const fixture = () => {
  const requests = [];
  let options, finish;
  const spawn = async (_command, _args, input) => {
    options = input;
    const stdin = new PassThrough();
    const parser = createFramedJsonRpcParser({ onMessage: message => requests.push(message) });
    stdin.on('data', chunk => parser.push(chunk));
    const completed = new Promise(resolve => { finish = () => { parser.dispose(); stdin.destroy(); resolve({ exitCode: 0 }); }; });
    input.signal.addEventListener('abort', () => finish(), { once: true });
    input.onSpawn({ pid: 123, stdin });
    return completed;
  };
  const client = createOwnedStdioClient({ command: 'fixture-owned-child', args: [], spawn, maxPending: 1 });
  const respond = payload => {
    const text = JSON.stringify(payload);
    options.onStdout(`Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`);
  };
  return { client, requests, respond, end: () => finish() };
};

{
  const f = fixture(); await f.client.ready;
  const first = f.client.request('tools/list'); await turn();
  await assert.rejects(f.client.request('tools/list'), { code: 'ERR_TUI_STDIO_ADMISSION' });
  f.respond({ jsonrpc: '2.0', id: f.requests[0].id, result: { tools: [] } });
  assert.deepEqual(await first, { tools: [] });
  assert.equal(f.client.status().pending, 0);
  await f.client.dispose();
  assert.equal(f.client.status().connected, false);
}
{
  const f = fixture(); await f.client.ready;
  const abort = new AbortController();
  const request = f.client.request('tools/call', {}, { signal: abort.signal });
  const rejected = assert.rejects(request, { code: 'ABORT_ERR' });
  await turn(); abort.abort(); await turn();
  assert.equal(f.client.status().pending, 1, 'cancellation retains capacity until settlement');
  assert.equal(f.requests[1].method, '$/cancelRequest');
  await assert.rejects(f.client.request('tools/list'), { code: 'ERR_TUI_STDIO_ADMISSION' });
  f.respond({ jsonrpc: '2.0', id: f.requests[0].id, result: { cancelled: true } });
  await rejected;
  assert.equal(f.client.status().pending, 0);
  await f.client.dispose();
}
{
  const f = fixture(); await f.client.ready;
  const request = f.client.request('tools/list');
  const rejected = assert.rejects(request, { code: 'ERR_TUI_STDIO_RESPONSE' });
  await turn();
  f.respond({ jsonrpc: '2.0', id: 999, result: {} });
  await rejected; await f.client.completion;
  assert.equal(f.client.status().connected, false, 'unsolicited response settles the owned process before rejection');
}
{
  const f = fixture(); await f.client.ready;
  const request = f.client.request('tools/list');
  const rejected = assert.rejects(request, { code: 'ERR_TUI_STDIO_FRAME' });
  await turn();
  f.respond({ jsonrpc: '2.0', id: f.requests[0].id, result: 'x'.repeat(800000) });
  await rejected;
  assert.equal(f.client.status().pending, 0);
}
console.log('Owned framed client bounds, cancellation capacity, protocol failure and disposal');
