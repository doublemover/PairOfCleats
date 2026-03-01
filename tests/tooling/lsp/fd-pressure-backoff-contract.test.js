#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-fd-pressure-backoff-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int a, int b) { return a + b; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:fd-pressure.cpp';
const chunkUid = 'ck64:v1:test:src/sample.cpp:fd-pressure';

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
      chunkId: 'chunk_fd_pressure',
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
  args: [serverPath, '--mode', 'emit-fd-pressure-warning'],
  lifecycleFdPressureBackoffMs: 250,
  parseSignature: (detail) => ({
    signature: detail,
    returnType: 'int',
    paramTypes: { a: 'int', b: 'int' }
  })
});

const checks = Array.isArray(result.checks) ? result.checks : [];
assert.equal(
  checks.some((check) => check?.name === 'tooling_fd_pressure_backoff'),
  true,
  'expected fd-pressure backoff warning check'
);
assert.equal(
  Number(result.runtime?.lifecycle?.fdPressureEvents || 0) >= 1,
  true,
  'expected lifecycle fd-pressure event count'
);

console.log('LSP fd-pressure backoff contract test passed');
