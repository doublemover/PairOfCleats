#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'lsp-bychunkuid');
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

const result = await collectLspTypes({
  rootDir: tempRoot,
  vfsRoot: tempRoot,
  documents,
  targets,
  cmd: process.execPath,
  args: [serverPath, '--mode', 'clangd'],
  parseSignature: (detail) => ({
    signature: detail,
    returnType: 'int',
    paramTypes: { a: 'int', b: 'int' }
  })
});

assert.ok(result.byChunkUid[chunkUid], 'expected LSP results keyed by chunkUid');
assert.equal(result.byChunkUid[chunkUid].chunk.chunkUid, chunkUid);

console.log('LSP byChunkUid keying test passed');
