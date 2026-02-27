#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-malformed-hover-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int a, int b) { return a + b; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:malformed-hover.cpp';

const result = await collectLspTypes({
  rootDir: tempRoot,
  vfsRoot: tempRoot,
  documents: [{
    virtualPath,
    text: docText,
    languageId: 'cpp',
    effectiveExt: '.cpp',
    docHash: 'hash-malformed-hover'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid: 'ck64:v1:test:src/sample.cpp:malformed-hover',
      chunkId: 'chunk_malformed_hover',
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
  args: [serverPath, '--mode', 'malformed-hover'],
  parseSignature: () => null,
  hoverRequireMissingReturn: true,
  retries: 0,
  timeoutMs: 1500
});

assert.equal(Object.keys(result.byChunkUid).length, 0, 'expected malformed hover response to fail open');
assert.equal(
  result.checks.some((check) => check?.name === 'tooling_initialize_failed'),
  false,
  'unexpected initialize failure for malformed hover case'
);
assert.equal(
  result.checks.some((check) => check?.name === 'tooling_document_symbol_failed'),
  false,
  'unexpected documentSymbol failure for malformed hover case'
);
assert.equal(
  Number(result.runtime?.requests?.failed || 0) >= 1,
  true,
  'expected failed request metric for malformed hover case'
);

console.log('LSP protocol malformed hover fail-open test passed');
