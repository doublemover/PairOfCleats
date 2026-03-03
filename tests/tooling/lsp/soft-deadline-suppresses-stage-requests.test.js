#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-soft-deadline-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int a, int b) { return a + b; }\nint sub(int a, int b) { return a - b; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:soft-deadline.cpp';
const addStart = docText.indexOf('add');
const subStart = docText.indexOf('sub');

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
      chunkUid: 'ck64:v1:test:src/sample.cpp:soft:add',
      chunkId: 'chunk_soft_deadline_add',
      file: 'src/sample.cpp',
      segmentUid: null,
      segmentId: null,
      range: { start: addStart, end: addStart + 3 }
    },
    virtualPath,
    virtualRange: { start: addStart, end: addStart + 3 },
    symbolHint: { name: 'add', kind: 'function' }
  }, {
    chunkRef: {
      docId: 0,
      chunkUid: 'ck64:v1:test:src/sample.cpp:soft:sub',
      chunkId: 'chunk_soft_deadline_sub',
      file: 'src/sample.cpp',
      segmentUid: null,
      segmentId: null,
      range: { start: subStart, end: subStart + 3 }
    },
    virtualPath,
    virtualRange: { start: subStart, end: subStart + 3 },
    symbolHint: { name: 'sub', kind: 'function' }
  }],
  cmd: process.execPath,
  args: [serverPath, '--mode', 'stall-signature-help-two-symbols'],
  parseSignature: () => null,
  signatureHelpTimeoutMs: 1000,
  hoverDisableAfterTimeouts: 999,
  softDeadlineMs: 1000,
  definitionEnabled: false,
  typeDefinitionEnabled: false,
  referencesEnabled: false
});

assert.equal(
  Number(result?.hoverMetrics?.signatureHelpRequested || 0),
  1,
  'expected soft deadline to suppress second signatureHelp request'
);
assert.equal(
  Number(result?.hoverMetrics?.skippedBySoftDeadline || 0) >= 1,
  true,
  'expected soft deadline skip metric to increment'
);
assert.equal(
  Array.isArray(result?.checks) && result.checks.some((entry) => entry?.name === 'tooling_soft_deadline_reached'),
  true,
  'expected soft deadline check entry'
);

console.log('LSP soft deadline suppression test passed');
