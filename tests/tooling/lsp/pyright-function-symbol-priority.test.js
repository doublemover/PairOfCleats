#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { parsePythonSignature } from '../../../src/index/tooling/signature-parse/python.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-pyright-function-symbol-priority-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'def greet(name: str) -> str:\n    return "hi"\n';
const virtualPath = '.poc-vfs/src/sample.py#seg:function-priority.py';
const chunkUid = 'ck64:v1:test:src/sample.py:function-priority';
const symbolStart = docText.indexOf('greet');

const result = await collectLspTypes({
  rootDir: tempRoot,
  vfsRoot: tempRoot,
  documents: [{
    virtualPath,
    text: docText,
    languageId: 'python',
    effectiveExt: '.py'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_function_priority',
      file: 'src/sample.py',
      segmentUid: null,
      segmentId: null,
      range: { start: symbolStart, end: symbolStart + 5 }
    },
    virtualPath,
    virtualRange: { start: symbolStart, end: symbolStart + 5 },
    symbolHint: { name: 'greet', kind: 'function' }
  }],
  cmd: process.execPath,
  args: [serverPath, '--mode', 'pyright-parameter-shadow'],
  parseSignature: (detail) => parsePythonSignature(detail),
  definitionEnabled: false,
  typeDefinitionEnabled: false,
  referencesEnabled: false
});

const payload = result.byChunkUid?.[chunkUid]?.payload || null;
assert.ok(payload, 'expected payload for chunk');
assert.equal(payload.returnType, 'str', 'expected function symbol payload to win over parameter symbol detail');
assert.equal(payload.signature, 'def greet(name: str) -> str');
assert.notEqual(payload.signature, '(parameter) name: str');
assert.deepEqual(payload.paramTypes?.name?.map((entry) => entry.type), ['str']);

console.log('LSP pyright function symbol priority test passed');
