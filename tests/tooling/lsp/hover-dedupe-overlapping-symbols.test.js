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
const tempRoot = resolveTestCachePath(root, 'lsp-hover-dedupe-overlapping-symbols');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const tracePath = path.join(tempRoot, 'trace.jsonl');
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int a, int b) { return a + b; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:stub.cpp';
const chunkUid = 'ck64:v1:test:src/sample.cpp:overlap';

let result = null;
await withTemporaryEnv({ POC_LSP_TRACE: tracePath }, async () => {
  result = await collectLspTypes({
    rootDir: tempRoot,
    vfsRoot: tempRoot,
    documents: [{
      virtualPath,
      text: docText,
      languageId: 'cpp',
      effectiveExt: '.cpp',
      docHash: 'dochash_hover_overlap'
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid,
        chunkId: 'chunk_overlap',
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
    args: [serverPath, '--mode', 'clangd-overlapping-symbols'],
    parseSignature: () => null
  });
});

const events = await parseJsonLinesFile(tracePath);
const hoverCount = events.filter((evt) => evt.kind === 'request' && evt.method === 'textDocument/hover').length;
assert.equal(hoverCount, 1, 'expected one hover request for overlapping symbols at the same position');
assert.equal(
  Number(result?.hoverMetrics?.incompleteSymbols || 0) >= 2,
  true,
  'expected incomplete symbol tracking for overlapping symbol records'
);

console.log('LSP hover dedupe overlapping symbols test passed');
