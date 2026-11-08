import fs from 'node:fs';
import { createFramedJsonRpcParser, writeFramedJsonRpc } from '../../../src/shared/jsonrpc.js';
const typesPath = process.argv[2];
const answer = (id, result) => writeFramedJsonRpc(process.stdout, { jsonrpc: '2.0', id, result });
const parse = createFramedJsonRpcParser({ onMessage(message) {
  const { id, method, params } = message;
  if (method === 'initialize') return answer(id, { capabilities: {
    textDocumentSync: 1, documentSymbolProvider: true, hoverProvider: true, signatureHelpProvider: {} } });
  if (method === 'shutdown') return answer(id, null);
  if (method === 'exit') return process.exit(0);
  if (id == null) return;
  if (method === 'textDocument/documentSymbol') return answer(id, [{ name: 'fetch', detail: 'fetch', kind: 12,
    range: { start: { line: 1, character: 0 }, end: { line: 2, character: 14 } },
    selectionRange: { start: { line: 1, character: 4 }, end: { line: 1, character: 9 } } }]);
  const uri = decodeURIComponent(params?.textDocument?.uri || '');
  const name = ['alpha', 'beta', 'gamma'].find(value => uri.includes(value));
  const type = JSON.parse(fs.readFileSync(typesPath, 'utf8'))[name] ?? null;
  const detail = type ? `def fetch() -> ${type}` : null;
  if (method === 'textDocument/hover') return answer(id, detail ? { contents: { kind: 'plaintext', value: detail } } : null);
  if (method === 'textDocument/signatureHelp') return answer(id, { signatures: detail ? [{ label: detail }] : [], activeSignature: 0, activeParameter: 0 });
  return answer(id, null);
} });
process.stdin.on('data', chunk => parse.push(chunk));
process.stdin.on('end', () => process.exit(0));
