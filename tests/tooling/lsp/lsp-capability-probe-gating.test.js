#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-capability-gating-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int a, int b) { return a + b; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:stub.cpp';
const documents = [{
  virtualPath,
  text: docText,
  languageId: 'cpp',
  effectiveExt: '.cpp'
}];

const chunkUid = 'ck64:v1:test:src/sample.cpp:deadbeef';
const targets = [{
  chunkRef: {
    docId: 0,
    chunkUid,
    chunkId: 'chunk_deadbeef',
    file: 'src/sample.cpp',
    segmentUid: null,
    segmentId: null,
    range: { start: 0, end: docText.length }
  },
  virtualPath,
  virtualRange: { start: 0, end: docText.length },
  symbolHint: { name: 'add', kind: 'function' }
}];

const withNoHover = await collectLspTypes({
  rootDir: tempRoot,
  vfsRoot: tempRoot,
  documents,
  targets,
  cmd: process.execPath,
  args: [serverPath, '--mode', 'no-hover'],
  parseSignature: (detail) => ({
    signature: detail,
    returnType: 'int',
    paramTypes: { a: 'int', b: 'int' }
  })
});

assert.ok(withNoHover.byChunkUid[chunkUid], 'expected enrichment to continue when hover capability is missing');
assert.equal(
  withNoHover.checks.some((check) => check?.name === 'tooling_capability_missing_hover'),
  true,
  'expected hover capability warning check'
);

const withoutDocumentSymbol = await collectLspTypes({
  rootDir: tempRoot,
  vfsRoot: tempRoot,
  documents,
  targets,
  cmd: process.execPath,
  args: [serverPath, '--mode', 'no-document-symbol'],
  parseSignature: (detail) => ({
    signature: detail,
    returnType: 'int',
    paramTypes: { a: 'int', b: 'int' }
  })
});

assert.equal(
  Object.keys(withoutDocumentSymbol.byChunkUid).length,
  0,
  'expected no enrichment when documentSymbol capability is absent'
);
assert.equal(
  withoutDocumentSymbol.checks.some((check) => check?.name === 'tooling_capability_missing_document_symbol'),
  true,
  'expected documentSymbol capability warning check'
);
assert.equal(
  withoutDocumentSymbol.runtime?.capabilities?.documentSymbol,
  false,
  'expected runtime capability mask to reflect missing documentSymbol support'
);

console.log('LSP capability probe gating test passed');
