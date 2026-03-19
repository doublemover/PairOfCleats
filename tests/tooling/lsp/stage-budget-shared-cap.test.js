#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { parseJsonLinesFile } from '../../helpers/lsp-signature-fixtures.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-stage-budget-shared-cap-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const tracePath = path.join(tempRoot, 'trace.jsonl');
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'const sentinel = 1;\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:shared-cap.cpp';
const chunkUid = 'ck64:v1:test:src/sample.cpp:shared-cap';

const parseSignature = (detailText) => {
  const detail = String(detailText || '').trim();
  if (detail !== 'add') return null;
  return {
    signature: detail,
    returnType: 'unknown',
    paramTypes: {},
    paramNames: ['a', 'b']
  };
};

let result = null;
await withTemporaryEnv({ POC_LSP_TRACE: tracePath }, async () => {
  result = await collectLspTypes({
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
        chunkId: 'chunk_shared_cap',
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
    args: [serverPath, '--mode', 'signature-help'],
    parseSignature,
    hoverMaxPerFile: 1,
    definitionEnabled: false,
    typeDefinitionEnabled: false,
    referencesEnabled: false
  });
});

assert.equal(Number(result?.hoverMetrics?.requested || 0), 1, 'expected one hover request');
assert.equal(Number(result?.hoverMetrics?.signatureHelpRequested || 0), 1, 'expected separate signatureHelp budget to allow the later stage');
assert.equal(Number(result?.hoverMetrics?.skippedByBudget || 0), 0, 'expected no shared-cap suppression after per-stage budget cutover');
assert.equal(
  Number(result?.runtime?.requestBudgets?.byKind?.hover?.maxRequests || 0) >= 1,
  true,
  'expected runtime request budget envelope for hover'
);
assert.equal(
  Number(result?.runtime?.requestBudgets?.byKind?.signatureHelp?.maxRequests || 0) >= 1,
  true,
  'expected runtime request budget envelope for signatureHelp'
);

const events = await parseJsonLinesFile(tracePath);
const hoverCalls = events.filter((entry) => entry.kind === 'request' && entry.method === 'textDocument/hover').length;
const signatureHelpCalls = events.filter((entry) => entry.kind === 'request' && entry.method === 'textDocument/signatureHelp').length;
assert.equal(hoverCalls, 1, 'expected one hover request trace');
assert.equal(signatureHelpCalls, 1, 'expected one signatureHelp trace under the per-stage budget plan');

console.log('LSP stage budget shared cap test passed');
