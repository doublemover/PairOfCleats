#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-definition-timeout-adaptive-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int a, int b) { return a + b; }\nint sentinel = add(1, 2);\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:definition-timeout.cpp';
const chunkUid = 'ck64:v1:test:src/sample.cpp:definition-timeout';
const symbolStart = docText.indexOf('add');

const parseSignature = (detailText) => {
  const detail = String(detailText || '').trim();
  if (!detail) return null;
  if (detail === 'add') {
    return {
      signature: detail,
      returnType: 'unknown',
      paramTypes: {},
      paramNames: ['a', 'b']
    };
  }
  const match = detail.match(/^int\s+add\s*\(\s*int\s+([A-Za-z_]\w*)\s*,\s*int\s+([A-Za-z_]\w*)\s*\)$/);
  if (!match) return null;
  return {
    signature: detail,
    returnType: 'int',
    paramTypes: {
      [match[1]]: 'int',
      [match[2]]: 'int'
    },
    paramNames: [match[1], match[2]]
  };
};

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
      chunkId: 'chunk_definition_timeout',
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
  args: [serverPath, '--mode', 'stall-definition'],
  parseSignature,
  definitionTimeoutMs: 1000,
  hoverDisableAfterTimeouts: 1,
  typeDefinitionEnabled: false,
  referencesEnabled: false
});

assert.equal(
  Number(result?.hoverMetrics?.definitionRequested || 0) >= 1,
  true,
  'expected definition stage request'
);
assert.equal(
  Number(result?.hoverMetrics?.definitionSucceeded || 0),
  0,
  'expected definition stage timeout to prevent success'
);
assert.equal(
  Number(result?.hoverMetrics?.definitionTimedOut || 0) >= 1,
  true,
  'expected definition timeout metric increment'
);
assert.equal(
  Array.isArray(result?.checks) && result.checks.some((entry) => entry?.name === 'tooling_definition_timeout'),
  true,
  'expected definition timeout check'
);

console.log('LSP definition timeout adaptive test passed');
