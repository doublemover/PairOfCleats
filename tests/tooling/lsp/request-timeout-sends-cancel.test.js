#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createLspClient } from '../../../src/integrations/tooling/lsp/client.js';
import { createFramedJsonRpcParser } from '../../../src/shared/jsonrpc.js';
import { sleep } from '../../../src/shared/sleep.js';

class FakeChildProcess extends EventEmitter {
  constructor() {
    super();
    this.pid = 0;
    this.killed = false;
    this.exitCode = null;
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
  }

  kill(signal = null) {
    this.killed = true;
    this.exitCode = this.exitCode === null ? 0 : this.exitCode;
    queueMicrotask(() => {
      this.emit('exit', this.exitCode, signal);
      this.emit('close', this.exitCode, signal);
    });
    return true;
  }

  unref() {}
}

const outboundMessages = [];
const client = createLspClient({
  cmd: 'fake-lsp',
  args: ['--stdio'],
  log: () => {},
  spawnProcess: () => {
    const child = new FakeChildProcess();
    const outboundParser = createFramedJsonRpcParser({
      onMessage: (message) => outboundMessages.push(message)
    });
    child.stdin.on('data', (chunk) => {
      outboundParser.push(chunk);
    });
    return child;
  }
});

try {
  const holdOpen = setInterval(() => {}, 25);
  let timedOut = false;
  try {
    await client.request('textDocument/signatureHelp', { textDocument: { uri: 'file:///fake.cpp' } }, { timeoutMs: 40 });
  } catch (error) {
    timedOut = String(error?.code || '') === 'ERR_LSP_REQUEST_TIMEOUT';
  } finally {
    clearInterval(holdOpen);
  }
  assert.equal(timedOut, true, 'expected request timeout rejection');

  await sleep(40);

  const requestMessage = outboundMessages.find((message) => message?.method === 'textDocument/signatureHelp');
  const cancelMessage = outboundMessages.find((message) => message?.method === '$/cancelRequest');
  assert.ok(requestMessage && Number.isFinite(Number(requestMessage.id)), 'expected timed-out request frame');
  assert.ok(cancelMessage, 'expected timeout path to send $/cancelRequest');
  assert.equal(
    Number(cancelMessage?.params?.id),
    Number(requestMessage.id),
    'expected cancel request id to target timed-out request id'
  );

  console.log('LSP request timeout sends cancel test passed');
} finally {
  await Promise.resolve(client.kill());
}
