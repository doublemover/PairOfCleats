#!/usr/bin/env node
import { createFramedJsonRpcParser, writeFramedJsonRpc } from '../../../src/shared/jsonrpc.js';

const args = process.argv.slice(2);
const modeIdx = args.indexOf('--mode');
const mode = modeIdx !== -1 && args[modeIdx + 1] ? args[modeIdx + 1] : 'clangd';

const symbolsByMode = {
  clangd: {
    name: 'add',
    detail: 'int add(int a, int b)',
    kind: 12
  },
  sourcekit: {
    name: 'greet',
    detail: 'func greet(name: String, count: Int) -> String',
    kind: 12
  }
};

const config = symbolsByMode[mode] || symbolsByMode.clangd;
const documents = new Map();

const send = (payload) => {
  writeFramedJsonRpc(process.stdout, payload);
};

const lineColForIndex = (text, index) => {
  const before = text.slice(0, Math.max(0, index));
  const lines = before.split(/\r?\n/);
  const line = Math.max(0, lines.length - 1);
  const character = lines.length ? lines[lines.length - 1].length : 0;
  return { line, character };
};

const buildSymbol = (text) => {
  const name = config.name;
  const detail = config.detail;
  const idx = text ? text.indexOf(name) : -1;
  const start = lineColForIndex(text || '', idx >= 0 ? idx : 0);
  const end = lineColForIndex(text || '', idx >= 0 ? idx + name.length : 1);
  return {
    name,
    kind: config.kind,
    detail,
    range: { start, end },
    selectionRange: { start, end }
  };
};

const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
const respondError = (id, message) => send({ jsonrpc: '2.0', id, error: { code: -32601, message } });

const handleRequest = (message) => {
  const { id, method, params } = message;
  if (method === 'initialize') {
    respond(id, {
      capabilities: {
        documentSymbolProvider: true,
        hoverProvider: true
      }
    });
    return;
  }
  if (method === 'shutdown') {
    respond(id, null);
    return;
  }
  if (method === 'textDocument/documentSymbol') {
    const uri = params?.textDocument?.uri;
    const text = documents.get(uri) || '';
    respond(id, [buildSymbol(text)]);
    return;
  }
  if (method === 'textDocument/hover') {
    respond(id, {
      contents: { kind: 'plaintext', value: config.detail }
    });
    return;
  }
  respondError(id, `Method not supported: ${method}`);
};

const handleNotification = (message) => {
  if (!message?.method) return;
  if (message.method === 'textDocument/didOpen') {
    const uri = message.params?.textDocument?.uri;
    const text = message.params?.textDocument?.text || '';
    if (uri) documents.set(uri, text);
  } else if (message.method === 'textDocument/didClose') {
    const uri = message.params?.textDocument?.uri;
    if (uri) documents.delete(uri);
  } else if (message.method === 'exit') {
    process.exit(0);
  }
};

const parser = createFramedJsonRpcParser({
  onMessage: (message) => {
    if (!message || typeof message !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(message, 'id') && message.method) {
      handleRequest(message);
      return;
    }
    handleNotification(message);
  },
  onError: (err) => {
    process.stderr.write(`stub lsp parse error: ${err.message}\n`);
  }
});

process.stdin.on('data', (chunk) => parser.push(chunk));
