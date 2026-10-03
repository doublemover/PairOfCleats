import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFramedJsonRpcParser, writeFramedJsonRpc } from '../../../src/shared/jsonrpc.js';

const tracePath = process.argv[2];
const slow = process.argv.includes('--slow');
const trace = (kind) => fs.appendFileSync(tracePath, JSON.stringify({ kind, pid: process.pid }) + '\n');
const send = (message) => writeFramedJsonRpc(process.stdout, { jsonrpc: '2.0', ...message });
const diagnostic = (message) => ({ message, severity: 1, code: 'synthetic',
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } });
let timer;
const parser = createFramedJsonRpcParser({
  onMessage: async (message) => {
    if (message.method === 'initialize') {
      trace('initialize');
      assert.equal(message.params.capabilities.textDocument.publishDiagnostics.versionSupport, true);
      await send({ id: message.id, result: { capabilities: { textDocumentSync: 1,
        documentSymbolProvider: false, hoverProvider: false } } });
    } else if (message.method === 'textDocument/didOpen') {
      trace('open');
      const { uri, version } = message.params.textDocument;
      await send({ method: 'textDocument/publishDiagnostics', params: { uri, version: version - 1,
        diagnostics: [diagnostic('stale result')] } });
      await send({ method: 'textDocument/publishDiagnostics', params: { uri: 'file:///not-opened.py', version,
        diagnostics: [diagnostic('unowned result')] } });
      timer = setTimeout(async () => {
        trace('diagnostics');
        await send({ method: 'textDocument/publishDiagnostics', params: { uri, version,
          diagnostics: [diagnostic('current owned result')] } });
      }, slow ? 1000 : 75);
    } else if (message.method === 'textDocument/didClose') {
      trace('close');
      clearTimeout(timer);
    } else if (message.method === 'shutdown') {
      await send({ id: message.id, result: null });
    } else if (message.method === 'exit') {
      trace('exit');
      process.exit(0);
    } else if (message.id && message.method) {
      trace('unexpected-type-request');
      await send({ id: message.id, error: { code: -32601, message: 'diagnostics-only fixture' } });
    }
  },
  onError: (error) => { throw error; }
});
process.stdin.on('data', (chunk) => parser.push(chunk));
