#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { parseJsonLinesFile } from '../../helpers/lsp-signature-fixtures.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'lsp-hover-dedupe');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const tracePath = path.join(tempRoot, 'trace.jsonl');
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');

const docText = 'int add(int a, int b) { return a + b; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:stub.cpp';
const documents = [{
  virtualPath,
  text: docText,
  languageId: 'cpp',
  effectiveExt: '.cpp',
  docHash: 'dochash_hover_dedupe'
}];

const chunkUid = 'ck64:v1:test:src/sample.cpp:abcd1234';
const targets = [{
  chunkRef: {
    docId: 0,
    chunkUid,
    chunkId: 'chunk_abcd1234',
    file: 'src/sample.cpp',
    segmentUid: null,
    segmentId: null,
    range: { start: 0, end: docText.length }
  },
  virtualPath,
  virtualRange: { start: 0, end: docText.length },
  symbolHint: { name: 'add', kind: 'function' }
}];

let result = null;
await withTemporaryEnv({ POC_LSP_TRACE: tracePath }, async () => {
  result = await collectLspTypes({
    rootDir: tempRoot,
    vfsRoot: tempRoot,
    cacheRoot: path.join(tempRoot, 'cache'),
    documents,
    targets,
    cmd: process.execPath,
    args: [serverPath, '--mode', 'clangd-duplicate-symbols'],
    hoverConcurrency: 8,
    parseSignature: () => ({
      signature: 'int add(int a, int b)',
      returnType: 'int',
      paramTypes: {},
      paramNames: ['a', 'b']
    })
  });
});

const events = await parseJsonLinesFile(tracePath);
const hoverCount = events.filter((evt) => evt.kind === 'request' && evt.method === 'textDocument/hover').length;

assert.equal(hoverCount, 1, 'expected duplicate symbol hover requests to be deduped');
assert.equal(
  Number(result?.hoverMetrics?.incompleteSymbols || 0) >= 2,
  true,
  'expected incomplete symbol tracking for duplicate symbols'
);
assert.equal(
  Number(result?.hoverMetrics?.hoverTriggeredByIncomplete || 0) >= 2,
  true,
  'expected hover trigger tracking to include incomplete symbols'
);

console.log('LSP hover dedupe test passed');
