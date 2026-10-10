import fs from 'node:fs';
let pending = Buffer.alloc(0), ordinal = 0;
const send = value => { const body = Buffer.from(JSON.stringify(value)); process.stdout.write('Content-Length: ' + body.length + '\r\n\r\n'); process.stdout.write(body); };
const location = uri => ({ uri, range: { start: { line: 0, character: 9 }, end: { line: 0, character: 12 } } });
const handle = message => {
  if (message.method === 'exit') { process.exit(0); return; }
  if (message.id == null) return;
  let result = null;
  if (message.method === 'initialize') result = { capabilities: { positionEncoding: 'utf-16', documentSymbolProvider: true, definitionProvider: true, hoverProvider: true }, serverInfo: { name: 'semantic-fixture', version: '1' } };
  if (message.method === 'textDocument/documentSymbol') result = [{ name: 'foo', kind: 12, detail: 'foo(): number', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 28 } }, selectionRange: location('').range }];
  if (message.method === 'textDocument/definition') {
    const count = ordinal++, uri = message.params.textDocument.uri;
    if (process.env.POC_SEMANTIC_LSP_TRACE) fs.appendFileSync(process.env.POC_SEMANTIC_LSP_TRACE, JSON.stringify(message.params) + '\n');
    if (count === 0) result = location(uri);
    if (count === 1) result = [location(uri), location('file:///external.lib.d.ts')];
    if (count === 2) result = [{ targetUri: 'file:///external.lib.d.ts', targetRange: location('').range, targetSelectionRange: location('').range, originSelectionRange: { start: message.params.position, end: { ...message.params.position, character: message.params.position.character + 3 } } }];
    if (count === 4) { send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'fixture definition failure' } }); return; }
  }
  send({ jsonrpc: '2.0', id: message.id, result });
};
process.stdin.on('data', chunk => { pending = Buffer.concat([pending, chunk]); while (true) { const boundary = pending.indexOf('\r\n\r\n'); if (boundary < 0) return; const match = pending.subarray(0,boundary).toString().match(/Content-Length: (\d+)/i); if (!match) throw new Error('Invalid fixture frame.'); const length = Number(match[1]); if (pending.length < boundary + 4 + length) return; const message = JSON.parse(pending.subarray(boundary+4,boundary+4+length)); pending = pending.subarray(boundary+4+length); handle(message); } });
