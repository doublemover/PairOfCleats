#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-fallback-reason-codes-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int, int) { return 0; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:fallback-reasons.cpp';
const chunkUid = 'ck64:v1:test:src/sample.cpp:fallback-reasons';

const parseSignature = (detailText) => {
  const detail = String(detailText || '').trim();
  if (!detail) return null;
  if (detail === 'add') {
    return {
      signature: 'int add(int, int)',
      returnType: 'int',
      paramTypes: {},
      paramNames: ['a', 'b']
    };
  }
  if (detail === 'int add(int a, int b)') {
    return {
      signature: 'int add(int, int)',
      returnType: 'int',
      paramTypes: {},
      paramNames: ['a', 'b']
    };
  }
  if (detail === 'int add(int, int)') {
    return {
      signature: detail,
      returnType: 'int',
      paramTypes: {},
      paramNames: ['a', 'b']
    };
  }
  return null;
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
      chunkId: 'chunk_fallback_reasons',
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
  args: [serverPath, '--mode', 'malformed-hover'],
  parseSignature,
  retries: 0,
  timeoutMs: 1500
});

assert.equal(
  Number(result?.hoverMetrics?.fallbackUsed || 0) >= 1,
  true,
  'expected source fallback usage after incomplete interactive stages'
);
assert.equal(
  result?.hoverMetrics?.fallbackReasonCounts?.missing_param_types >= 1,
  true,
  'expected missing_param_types fallback reason'
);
assert.equal(
  result?.hoverMetrics?.fallbackReasonCounts?.hover_unavailable_or_failed >= 1,
  true,
  'expected hover_unavailable_or_failed fallback reason'
);
assert.equal(
  result?.hoverMetrics?.fallbackReasonCounts?.signature_help_not_requested >= 1,
  true,
  'expected signature_help_not_requested fallback reason'
);
assert.equal(
  result?.hoverMetrics?.fallbackReasonCounts?.definition_not_requested >= 1,
  true,
  'expected definition_not_requested fallback reason'
);
assert.equal(
  result?.hoverMetrics?.fallbackReasonCounts?.type_definition_not_requested >= 1,
  true,
  'expected type_definition_not_requested fallback reason'
);
assert.equal(
  result?.hoverMetrics?.fallbackReasonCounts?.references_not_requested >= 1,
  true,
  'expected references_not_requested fallback reason'
);

console.log('LSP fallback reason code test passed');
