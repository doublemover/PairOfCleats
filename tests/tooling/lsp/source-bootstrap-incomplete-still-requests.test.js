#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { parseJsonLinesFile } from '../../helpers/lsp-signature-fixtures.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'lsp-source-bootstrap-incomplete-still-requests');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const tracePath = path.join(tempRoot, 'trace.jsonl');
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int, int) { return 0; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:source-bootstrap-incomplete.cpp';
const chunkUid = 'ck64:v1:test:src/sample.cpp:source-bootstrap-incomplete';

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
  if (detail === 'int add(int, int)') {
    return {
      signature: detail,
      returnType: 'int',
      paramTypes: {},
      paramNames: ['a', 'b']
    };
  }
  if (detail === 'int add(int a, int b)') {
    return {
      signature: detail,
      returnType: 'int',
      paramTypes: {
        a: 'int',
        b: 'int'
      },
      paramNames: ['a', 'b']
    };
  }
  return null;
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
        chunkId: 'chunk_source_bootstrap_incomplete',
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
    parseSignature
  });
});

const payload = result.byChunkUid?.[chunkUid]?.payload || null;
assert.ok(payload, 'expected payload for chunk');
assert.equal(payload.returnType, 'int', 'expected complete return type');
assert.deepEqual(payload.paramTypes?.a?.map((entry) => entry.type), ['int']);
assert.deepEqual(payload.paramTypes?.b?.map((entry) => entry.type), ['int']);
assert.equal(
  Number(result?.hoverMetrics?.sourceBootstrapUsed || 0) >= 1,
  true,
  'expected incomplete source signature to be merged before later stages'
);
assert.equal(
  Number(result?.hoverMetrics?.signatureHelpRequested || 0) >= 1,
  true,
  'expected signatureHelp request when source bootstrap remains incomplete'
);
assert.equal(
  Number(result?.hoverMetrics?.signatureHelpSucceeded || 0) >= 1,
  true,
  'expected signatureHelp to complete the payload'
);

const traceLines = await parseJsonLinesFile(tracePath);
const signatureHelpRequests = traceLines.filter(
  (entry) => entry.kind === 'request' && entry.method === 'textDocument/signatureHelp'
).length;
assert.equal(signatureHelpRequests >= 1, true, 'expected signatureHelp request trace entry');

console.log('LSP source bootstrap incomplete path test passed');
