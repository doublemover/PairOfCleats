#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-hover-merge-quality-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int a, int b) { return a + b; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:hover-merge.cpp';
const chunkUid = 'ck64:v1:test:src/sample.cpp:hover-merge';

const parseSignature = (detailText) => {
  const detail = String(detailText || '').trim();
  if (!detail) return null;
  if (detail === 'add') {
    return {
      signature: detail,
      returnType: 'int',
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
      chunkId: 'chunk_hover_merge',
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
  args: [serverPath, '--mode', 'clangd-hover-richer'],
  parseSignature
});

const payload = result.byChunkUid?.[chunkUid]?.payload || null;
assert.ok(payload, 'expected payload for chunk');
assert.equal(payload.returnType, 'int', 'expected return type to remain stable');
assert.deepEqual(payload.paramTypes?.a?.map((entry) => entry.type), ['int']);
assert.deepEqual(payload.paramTypes?.b?.map((entry) => entry.type), ['int']);
assert.equal(
  Number(result?.hoverMetrics?.hoverTriggeredByIncomplete || 0) >= 1,
  true,
  'expected hover to trigger for incomplete param payload'
);
assert.equal(
  Number(result?.hoverMetrics?.fallbackUsed || 0),
  0,
  'expected no source fallback when hover provides complete signature'
);

console.log('LSP hover merge quality test passed');
