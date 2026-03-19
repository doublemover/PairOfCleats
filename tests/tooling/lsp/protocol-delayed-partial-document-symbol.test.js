#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-delayed-partial-docsymbol-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int a, int b) { return a + b; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:delayed-partial-docsymbol.cpp';
const chunkUid = 'ck64:v1:test:src/sample.cpp:delayed-partial-docsymbol';

const result = await collectLspTypes({
  rootDir: tempRoot,
  vfsRoot: tempRoot,
  documents: [{
    virtualPath,
    text: docText,
    languageId: 'cpp',
    effectiveExt: '.cpp',
    docHash: 'hash-delayed-partial-docsymbol'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_delayed_partial_docsymbol',
      file: 'src/sample.cpp',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath,
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'add', kind: 'function' }
  }],
  cmd: process.execPath,
  args: [serverPath, '--mode', 'delayed-partial-document-symbol'],
  parseSignature: (detail) => ({
    signature: String(detail || 'add'),
    returnType: 'int',
    paramTypes: { a: 'int', b: 'int' }
  }),
  retries: 0,
  timeoutMs: 2000
});

assert.ok(result.byChunkUid[chunkUid], 'expected enrichment from delayed partial documentSymbol server');
assert.equal(result.checks.some((check) => check?.name === 'tooling_document_symbol_failed'), false, 'unexpected documentSymbol failure for delayed partial case');

console.log('LSP protocol delayed partial documentSymbol test passed');
