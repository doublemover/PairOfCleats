#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { parseCppTwoIntParamSignature } from '../../helpers/lsp-signature-fixtures.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(
  root,
  `lsp-signature-help-timeout-adaptive-gates-next-symbol-${process.pid}-${Date.now()}`
);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int a, int b) { return a + b; }\nint sub(int a, int b) { return a - b; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:signature-help-timeout-multi.cpp';
const addStart = docText.indexOf('add');
const subStart = docText.indexOf('sub');
const addChunkUid = 'ck64:v1:test:src/sample.cpp:signature-help-timeout-multi:add';
const subChunkUid = 'ck64:v1:test:src/sample.cpp:signature-help-timeout-multi:sub';

const parseSignature = (detailText) => parseCppTwoIntParamSignature(detailText, {
  bareNames: ['add', 'sub'],
  bareReturnType: 'unknown'
});

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
      chunkUid: addChunkUid,
      chunkId: 'chunk_signature_help_timeout_multi_add',
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
      chunkUid: subChunkUid,
      chunkId: 'chunk_signature_help_timeout_multi_sub',
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
  parseSignature,
  signatureHelpTimeoutMs: 1000,
  hoverDisableAfterTimeouts: 1,
  definitionEnabled: false,
  typeDefinitionEnabled: false,
  referencesEnabled: false
});

assert.equal(
  Number(result?.hoverMetrics?.signatureHelpRequested || 0),
  1,
  'expected adaptive suppression to stop signatureHelp on the second symbol'
);
assert.equal(
  Number(result?.hoverMetrics?.signatureHelpTimedOut || 0) >= 1,
  true,
  'expected signatureHelp timeout metric increment'
);
assert.equal(
  Number(result?.hoverMetrics?.timedOut || 0) >= 1,
  true,
  'expected timeout metric increment'
);
assert.equal(
  Number(result?.hoverMetrics?.skippedByGlobalDisable || 0) >= 1
    || Number(result?.hoverMetrics?.skippedByAdaptiveDisable || 0) >= 1,
  true,
  'expected adaptive suppression skip metrics for subsequent symbols'
);

console.log('LSP signatureHelp adaptive gating test passed');
