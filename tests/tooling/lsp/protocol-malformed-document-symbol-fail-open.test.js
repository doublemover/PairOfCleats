#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-malformed-docsymbol-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int a, int b) { return a + b; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:malformed-docsymbol.cpp';

const result = await collectLspTypes({
  rootDir: tempRoot,
  vfsRoot: tempRoot,
  documents: [{
    virtualPath,
    text: docText,
    languageId: 'cpp',
    effectiveExt: '.cpp'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid: 'ck64:v1:test:src/sample.cpp:malformed-docsymbol',
      chunkId: 'chunk_malformed_docsymbol',
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
  args: [serverPath, '--mode', 'malformed-document-symbol'],
  parseSignature: (detail) => ({
    signature: detail,
    returnType: 'int',
    paramTypes: { a: 'int', b: 'int' }
  }),
  retries: 0,
  timeoutMs: 1500
});

assert.equal(Object.keys(result.byChunkUid).length, 0, 'expected malformed documentSymbol response to fail open');
assert.equal(
  result.checks.some((check) => check?.name === 'tooling_document_symbol_failed'),
  true,
  'expected tooling_document_symbol_failed check for malformed documentSymbol payload'
);
assert.equal(
  result.checks.some((check) => check?.name === 'tooling_initialize_failed'),
  false,
  'unexpected initialize failure for malformed documentSymbol case'
);
assert.equal(
  Number(result.runtime?.requests?.failed || 0) >= 1,
  true,
  'expected failed request metric for malformed documentSymbol case'
);

console.log('LSP protocol malformed documentSymbol fail-open test passed');
