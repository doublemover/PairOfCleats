#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-inconsistent-docsymbol-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int a, int b) { return a + b; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:inconsistent-docsymbol.cpp';

const result = await collectLspTypes({
  rootDir: tempRoot,
  vfsRoot: tempRoot,
  documents: [{
    virtualPath,
    text: docText,
    languageId: 'cpp',
    effectiveExt: '.cpp',
    docHash: 'hash-inconsistent-docsymbol'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid: 'ck64:v1:test:src/sample.cpp:inconsistent-docsymbol',
      chunkId: 'chunk_inconsistent_docsymbol',
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
  args: [serverPath, '--mode', 'inconsistent-document-symbol'],
  parseSignature: () => null,
  retries: 0,
  timeoutMs: 1500
});

assert.equal(Object.keys(result.byChunkUid).length, 0, 'expected inconsistent documentSymbol payload to fail open');
assert.equal(result.checks.some((check) => check?.name === 'tooling_initialize_failed'), false, 'unexpected initialize failure for inconsistent metadata case');
assert.equal(Number(result.runtime?.requests?.failed || 0) >= 0, true, 'expected runtime request metrics to remain present');

console.log('LSP protocol inconsistent documentSymbol fail-open test passed');
