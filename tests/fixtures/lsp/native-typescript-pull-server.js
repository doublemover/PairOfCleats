import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFramedJsonRpcParser, writeFramedJsonRpc } from '../../../src/shared/jsonrpc.js';

// Explicit protocol fixture, never a vendor/native qualification substitute.
const tracePath = process.argv[2], documents = new Map();
const trace = kind => fs.appendFileSync(tracePath, JSON.stringify({ kind }) + '\n');
const send = message => writeFramedJsonRpc(process.stdout, { jsonrpc: '2.0', ...message });
let ready;
const configuration = new Promise(resolve => { ready = resolve; });
const parser = createFramedJsonRpcParser({ onMessage: async message => {
  if (message.method === 'initialize') {
    assert.equal(message.params.capabilities.textDocument.diagnostic.relatedDocumentSupport, false);
    assert.equal(message.params.capabilities.workspace.diagnostics.refreshSupport, true);
    assert.equal(message.params.initializationOptions.userPreferences.automaticTypeAcquisitionEnabled, false);
    trace('initialize');
    await send({ id: message.id, result: { serverInfo: { name: 'typescript-go', version: '7.0.2' },
      capabilities: { textDocumentSync: 1, documentSymbolProvider: true, diagnosticProvider: { identifier: 'typescript', interFileDependencies: true } } } });
  } else if (message.method === 'initialized') {
    await send({ id: 'fixture-native-settings', method: 'workspace/configuration', params: { items: [{ section: 'js/ts' }] } });
  } else if (message.id === 'fixture-native-settings' && !message.method) {
    assert.equal(message.result[0].tsserver.automaticTypeAcquisition.enabled, false); trace('settings'); ready();
  } else if (message.method === 'textDocument/didOpen') {
    const document = message.params.textDocument; documents.set(document.uri, document); trace('open');
    await send({ id: 'fixture-native-refresh', method: 'workspace/diagnostic/refresh' });
  } else if (message.id === 'fixture-native-refresh' && !message.method) {
    assert.equal(message.result, null); trace('refresh-ack');
  } else if (message.method === 'textDocument/diagnostic') {
    await configuration;
    assert.equal(message.params.identifier, 'typescript'); assert.ok(documents.has(message.params.textDocument.uri));
    trace('pull'); await send({ id: message.id, result: { kind: 'full', resultId: 'fixture-current', items: [{
      message: 'native pull fixture type mismatch', code: 2322, severity: 1, source: 'ts',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } }
    }] } });
  } else if (message.method === 'textDocument/documentSymbol') {
    await send({ id: message.id, result: [] });
  } else if (message.method === 'textDocument/didClose') {
    assert.equal(documents.delete(message.params.textDocument.uri), true); trace('close');
  } else if (message.method === 'shutdown') {
    assert.equal(documents.size, 0); trace('shutdown'); await send({ id: message.id, result: null });
  } else if (message.method === 'exit') process.exit(0);
  else if (message.id != null && message.method) await send({ id: message.id, result: null });
}, onError: error => { throw error; } });
process.stdin.on('data', chunk => parser.push(chunk));
