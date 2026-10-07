#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { parseJsonLinesFile } from '../../helpers/lsp-signature-fixtures.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-stage-order-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const tracePath = path.join(tempRoot, 'trace.jsonl');
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = '// int add(int, int)\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:stage-order.cpp';
const chunkUid = 'ck64:v1:test:src/sample.cpp:stage-order';
const symbolStart = docText.indexOf('add');

const parseSignature = (detailText) => {
  const detail = String(detailText || '').trim();
  if (!detail) return null;
  if (
    detail === 'add'
    || detail === 'int add(int, int)'
    || detail === 'int add(int a, int b)'
    || detail === '// int add(int, int)'
  ) {
    return {
      signature: 'int add(int, int)',
      returnType: 'int',
      paramTypes: {},
      paramNames: ['a', 'b']
    };
  }
  return null;
};

await withTemporaryEnv({ POC_LSP_TRACE: tracePath }, async () => {
  await collectLspTypes({
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
        chunkUid,
        chunkId: 'chunk_stage_order',
        file: 'src/sample.cpp',
        segmentUid: null,
        segmentId: null,
        range: { start: symbolStart, end: symbolStart + 3 }
      },
      virtualPath,
      virtualRange: { start: symbolStart, end: symbolStart + 3 },
      symbolHint: { name: 'add', kind: 'function' }
    }],
    cmd: process.execPath,
    args: [serverPath, '--mode', 'all-capabilities'],
    parseSignature
  });
});

const events = await parseJsonLinesFile(tracePath);
const orderedMethods = events
  .filter((entry) => entry.kind === 'request')
  .map((entry) => entry.method)
  .filter((method) => [
    'textDocument/hover',
    'textDocument/signatureHelp',
    'textDocument/definition',
    'textDocument/typeDefinition',
    'textDocument/references'
  ].includes(method));

assert.deepEqual(orderedMethods, [
  'textDocument/hover',
  'textDocument/signatureHelp',
  'textDocument/definition',
  'textDocument/typeDefinition',
  'textDocument/references'
], 'expected deterministic multi-stage request ordering');

console.log('LSP multi-stage request ordering test passed');
