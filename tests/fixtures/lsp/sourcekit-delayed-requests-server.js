#!/usr/bin/env node
import { createFramedJsonRpcParser, writeFramedJsonRpc } from '../../../src/shared/jsonrpc.js';

// A benign controlled response takes longer than the accidental 1s deadline,
// while fitting SourceKit's already declared 3.5s per-request default.
const delayMs = 1200;
const respond = (id, result) => writeFramedJsonRpc(process.stdout, { jsonrpc: '2.0', id, result });
const parser = createFramedJsonRpcParser({ onMessage: ({ id, method }) => {
  if (method === 'initialize') {
    respond(id, { capabilities: {
      documentSymbolProvider: true, hoverProvider: true, inlayHintProvider: true
    } });
  } else if (method === 'textDocument/documentSymbol') {
    respond(id, [{ name: 'alpha', detail: 'func alpha(value)', kind: 12,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 33 } },
      selectionRange: { start: { line: 0, character: 5 }, end: { line: 0, character: 10 } }
    }]);
  } else if (method === 'textDocument/inlayHint') {
    setTimeout(() => respond(id, []), delayMs);
  } else if (method === 'textDocument/hover') {
    setTimeout(() => respond(id, { contents: { kind: 'plaintext', value: 'func alpha(value: Int) -> Int' } }), delayMs);
  } else if (method === 'shutdown') {
    respond(id, null);
  } else if (method === 'exit') {
    process.exit(0);
  } else if (id != null) {
    respond(id, null);
  }
} });
process.stdin.on('data', (chunk) => parser.push(chunk));
process.stdin.on('end', () => process.exit(0));
