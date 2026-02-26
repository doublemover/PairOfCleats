#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-runtime-envelope-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int a, int b) { return a + b; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:stub.cpp';
const chunkUid = 'ck64:v1:test:src/sample.cpp:runtime';

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
      chunkUid,
      chunkId: 'chunk_runtime',
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
  args: [serverPath, '--mode', 'clangd'],
  parseSignature: (detail) => ({
    signature: detail,
    returnType: 'int',
    paramTypes: { a: 'int', b: 'int' }
  })
});

assert.ok(result.runtime && typeof result.runtime === 'object', 'expected runtime envelope');
assert.equal(typeof result.runtime.command, 'string', 'expected runtime command');
assert.ok(result.runtime.capabilities && typeof result.runtime.capabilities === 'object', 'expected capability mask');
assert.equal(result.runtime.capabilities.documentSymbol, true, 'expected documentSymbol capability flag');
assert.equal(result.runtime.capabilities.hover, true, 'expected hover capability flag');
assert.ok(result.runtime.lifecycle && typeof result.runtime.lifecycle === 'object', 'expected lifecycle metrics');
assert.equal(
  Number.isFinite(Number(result.runtime.lifecycle.startsInWindow)),
  true,
  'expected lifecycle starts count'
);

console.log('LSP runtime envelope test passed');
