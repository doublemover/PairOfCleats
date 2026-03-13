#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { createLspClient } from '../../../src/integrations/tooling/lsp/client.js';
import { createFramedJsonRpcParser, getJsonRpcWriter } from '../../../src/shared/jsonrpc.js';

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

const client = createLspClient({
  cmd: 'fake-lsp',
  args: ['--stdio'],
  log: () => {},
  spawnProcess: () => {
    const child = new FakeChildProcess();
    const writer = getJsonRpcWriter(child.stdout);
    const outboundParser = createFramedJsonRpcParser({
      onMessage: (message) => {
        if (message?.method === 'initialize') {
          writer.write({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              capabilities: {
                documentSymbolProvider: true
              }
            }
          });
          return;
        }
        if (message?.method === 'textDocument/documentSymbol') {
          writer.write({
            jsonrpc: '2.0',
            id: message.id,
            result: []
          });
        }
      }
    });
    child.stdin.on('data', (chunk) => {
      outboundParser.push(chunk);
    });
    return child;
  }
});

try {
  await client.initialize({
    rootUri: 'file:///fake',
    capabilities: { textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } } },
    timeoutMs: 1000
  });

  const snapshot1 = client.getMetrics();
  const snapshot2 = client.getMetrics();
  assert.equal(snapshot1, snapshot2, 'expected repeated getMetrics calls to reuse cached snapshot');

  await client.request('textDocument/documentSymbol', {
    textDocument: { uri: 'file:///fake/sample.cpp' }
  }, { timeoutMs: 1000 });

  const snapshot3 = client.getMetrics();
  assert.notEqual(snapshot2, snapshot3, 'expected cache invalidation after new request metrics');

  const snapshot4 = client.getMetrics();
  assert.equal(snapshot3, snapshot4, 'expected stable snapshot reuse until metrics mutate again');
  assert.equal(Number(snapshot4?.byMethod?.['textDocument/documentSymbol']?.requests || 0), 1);

  console.log('LSP client metrics snapshot cache test passed');
} finally {
  await Promise.resolve(client.kill());
}
