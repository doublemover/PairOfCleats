import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFramedJsonRpcParser, writeFramedJsonRpc } from '../../../src/shared/jsonrpc.js';

const tracePath = process.argv[2];
const trace = (kind, extra = {}) => fs.appendFileSync(tracePath, JSON.stringify({ kind, ...extra }) + '\n');
const send = (message) => writeFramedJsonRpc(process.stdout, { jsonrpc: '2.0', ...message });
let resolveConfiguration;
const configuration = new Promise((resolve) => { resolveConfiguration = resolve; });
let openUri = null;
let diagnosticTimer = null;
const parser = createFramedJsonRpcParser({
  onMessage: async (message) => {
    if (message.id === 'fixture-settings' && !message.method) {
      const settings = message.result?.[0];
      assert.equal(settings?.schemaStore?.enable, false);
      assert.equal(settings?.kubernetesCRDStore?.enable, false);
      trace('settings');
      resolveConfiguration();
    } else if (message.method === 'initialize') {
      assert.equal(message.params.capabilities.workspace?.configuration, true);
      await send({ id: message.id, result: { capabilities: { documentSymbolProvider: true, textDocumentSync: 1 } } });
    } else if (message.method === 'initialized') {
      await send({ id: 'fixture-settings', method: 'workspace/configuration', params: {
        items: [{ section: 'yaml', scopeUri: 'file:///ignored/untrusted/config' }]
      } });
    } else if (message.method === 'textDocument/didOpen') {
      assert.equal(message.params.textDocument.languageId, 'yaml');
      openUri = message.params.textDocument.uri;
      trace('open');
      diagnosticTimer = setTimeout(async () => {
        await configuration;
        if (!openUri) return;
        trace('diagnostics');
        await send({ method: 'textDocument/publishDiagnostics', params: {
          uri: openUri, diagnostics: [{ message: 'delayed fixture diagnostic', severity: 1,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } } }]
        } });
      }, 75);
    } else if (message.method === 'textDocument/documentSymbol') {
      await configuration;
      await send({ id: message.id, result: [{ name: 'road', detail: 'number', kind: 13,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } } }] });
    } else if (message.method === 'textDocument/didClose') {
      trace('close');
      clearTimeout(diagnosticTimer);
      const uri = openUri;
      openUri = null;
      await send({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: [] } });
    } else if (message.method === 'shutdown') {
      await send({ id: message.id, result: null });
    } else if (message.method === 'exit') {
      process.exit(0);
    } else if (message.id && message.method) {
      await send({ id: message.id, result: null });
    }
  },
  onError: (error) => { throw error; }
});
process.stdin.on('data', (chunk) => parser.push(chunk));
