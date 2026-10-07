#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createLspClient } from '../../../src/integrations/tooling/lsp/client.js';
import { createFramedJsonRpcParser } from '../../../src/shared/jsonrpc.js';
import { sleep } from '../../../src/shared/sleep.js';
import { FakeChildProcess } from './helpers/fake-child-process.js';

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
