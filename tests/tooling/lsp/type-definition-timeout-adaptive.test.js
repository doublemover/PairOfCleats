#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { parseCppTwoIntParamSignature } from '../../helpers/lsp-signature-fixtures.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-type-definition-timeout-adaptive-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int a, int b) { return a + b; }\nint sentinel = add(1, 2);\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:type-definition-timeout.cpp';
const chunkUid = 'ck64:v1:test:src/sample.cpp:type-definition-timeout';
const symbolStart = docText.indexOf('add');

const parseSignature = (detailText) => parseCppTwoIntParamSignature(detailText, {
  bareNames: ['add'],
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
      chunkUid,
      chunkId: 'chunk_type_definition_timeout',
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
  args: [serverPath, '--mode', 'stall-type-definition'],
  parseSignature,
  definitionEnabled: false,
  typeDefinitionEnabled: true,
  referencesEnabled: false,
  typeDefinitionTimeoutMs: 1000,
  hoverDisableAfterTimeouts: 1
});

assert.equal(
  Number(result?.hoverMetrics?.typeDefinitionRequested || 0) >= 1,
  true,
  'expected typeDefinition stage request'
);
assert.equal(
  Number(result?.hoverMetrics?.typeDefinitionSucceeded || 0),
  0,
  'expected typeDefinition stage timeout to prevent success'
);
assert.equal(
  Number(result?.hoverMetrics?.typeDefinitionTimedOut || 0) >= 1,
  true,
  'expected typeDefinition timeout metric increment'
);
assert.equal(
  Array.isArray(result?.checks) && result.checks.some((entry) => entry?.name === 'tooling_type_definition_timeout'),
  true,
  'expected typeDefinition timeout check'
);

console.log('LSP typeDefinition timeout adaptive test passed');
