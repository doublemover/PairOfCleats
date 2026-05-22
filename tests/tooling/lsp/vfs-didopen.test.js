#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseJsonLinesFile } from '../../helpers/lsp-signature-fixtures.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

import { createStubLspCollectFixture } from './helpers/stub-lsp-collect-fixture.js';

const { collect, tempRoot } = await createStubLspCollectFixture('lsp-vfs-didopen');
const tracePath = path.join(tempRoot, 'trace.jsonl');

await withTemporaryEnv({ POC_LSP_TRACE: tracePath }, async () => {
  await collect('clangd');
});

const events = await parseJsonLinesFile(tracePath);
const didOpenIndex = events.findIndex((evt) => evt.kind === 'notification' && evt.method === 'textDocument/didOpen');
const documentSymbolIndex = events.findIndex((evt) => evt.kind === 'request' && evt.method === 'textDocument/documentSymbol');

assert.ok(didOpenIndex !== -1, 'expected didOpen notification to be recorded');
assert.ok(documentSymbolIndex !== -1, 'expected documentSymbol request to be recorded');
assert.ok(didOpenIndex < documentSymbolIndex, 'expected didOpen before documentSymbol');

console.log('LSP VFS didOpen ordering test passed');
