#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-docsymbol-disable-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int a, int b) { return a + b; }\n';
const docAPath = '.poc-vfs/src/sample-a.cpp#seg:disconnect-docsymbol-a.cpp';
const docBPath = '.poc-vfs/src/sample-b.cpp#seg:disconnect-docsymbol-b.cpp';

const result = await collectLspTypes({
  rootDir: tempRoot,
  vfsRoot: tempRoot,
  documents: [
    {
      virtualPath: docAPath,
      text: docText,
      languageId: 'cpp',
      effectiveExt: '.cpp'
    },
    {
      virtualPath: docBPath,
      text: docText,
      languageId: 'cpp',
      effectiveExt: '.cpp'
    }
  ],
  targets: [
    {
      chunkRef: {
        docId: 0,
        chunkUid: 'ck64:v1:test:src/sample-a.cpp:disconnect-docsymbol',
        chunkId: 'chunk_disconnect_docsymbol_a',
        file: 'src/sample-a.cpp',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: docAPath,
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'add', kind: 'function' }
    },
    {
      chunkRef: {
        docId: 1,
        chunkUid: 'ck64:v1:test:src/sample-b.cpp:disconnect-docsymbol',
        chunkId: 'chunk_disconnect_docsymbol_b',
        file: 'src/sample-b.cpp',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: docBPath,
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'add', kind: 'function' }
    }
  ],
  cmd: process.execPath,
  args: [serverPath, '--mode', 'disconnect-on-document-symbol'],
  parseSignature: (detail) => ({
    signature: detail,
    returnType: 'int',
    paramTypes: { a: 'int', b: 'int' }
  }),
  retries: 0,
  timeoutMs: 1500,
  documentSymbolConcurrency: 1
});

assert.equal(Object.keys(result.byChunkUid).length, 0, 'expected disconnect to fail open');
assert.equal(
  result.checks.some((check) => check?.name === 'tooling_document_symbol_failed'),
  true,
  'expected tooling_document_symbol_failed check when LSP disconnects during documentSymbol'
);
assert.equal(
  Number(result.runtime?.requests?.byMethod?.['textDocument/documentSymbol']?.requests || 0),
  1,
  'expected documentSymbol collection to stop after the first provider-level failure'
);

console.log('LSP documentSymbol failure disables remaining docs test passed');
