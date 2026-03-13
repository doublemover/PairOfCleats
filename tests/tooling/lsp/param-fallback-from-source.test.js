#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { parseCppTwoIntParamSignature, parseJsonLinesFile } from '../../helpers/lsp-signature-fixtures.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'lsp-param-fallback-from-source');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const tracePath = path.join(tempRoot, 'trace.jsonl');
const docText = 'int add(int a, int b) { return a + b; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:stub.cpp';
const documents = [{
  virtualPath,
  text: docText,
  languageId: 'cpp',
  effectiveExt: '.cpp'
}];

const chunkUid = 'ck64:v1:test:src/sample.cpp:feedface';
const targets = [{
  chunkRef: {
    docId: 0,
    chunkUid,
    chunkId: 'chunk_feedface',
    file: 'src/sample.cpp',
    segmentUid: null,
    segmentId: null,
    range: { start: 0, end: docText.length }
  },
  virtualPath,
  virtualRange: { start: 0, end: docText.length },
  symbolHint: { name: 'add', kind: 'function' }
}];

const parseSignature = (detailText) => parseCppTwoIntParamSignature(detailText, {
  bareNames: [],
  allowUnnamedPrototype: true
});

let result = null;
await withTemporaryEnv({ POC_LSP_TRACE: tracePath }, async () => {
  result = await collectLspTypes({
    rootDir: tempRoot,
    vfsRoot: tempRoot,
    documents,
    targets,
    cmd: process.execPath,
    args: [serverPath, '--mode', 'signature-help'],
    parseSignature
  });
});

const payload = result.byChunkUid?.[chunkUid]?.payload || null;
assert.ok(payload, 'expected payload for chunkUid');
assert.equal(payload.returnType, 'int');
assert.deepEqual(payload.paramTypes?.a?.map((entry) => entry.type), ['int']);
assert.deepEqual(payload.paramTypes?.b?.map((entry) => entry.type), ['int']);
assert.equal(
  Number(result?.hoverMetrics?.sourceBootstrapUsed || 0) >= 1,
  true,
  'expected source bootstrap metric to increment'
);
assert.equal(
  Number(result?.hoverMetrics?.fallbackUsed || 0),
  0,
  'expected late source fallback metric to remain unused when source bootstrap completes payload'
);
const traceLines = await parseJsonLinesFile(tracePath);
const hoverRequests = traceLines.filter(
  (entry) => entry.kind === 'request' && entry.method === 'textDocument/hover'
).length;
const signatureHelpRequests = traceLines.filter(
  (entry) => entry.kind === 'request' && entry.method === 'textDocument/signatureHelp'
).length;
assert.equal(hoverRequests, 0, 'expected no hover requests when source bootstrap completes payload');
assert.equal(signatureHelpRequests, 0, 'expected no signatureHelp requests when source bootstrap completes payload');

console.log('LSP source bootstrap param recovery test passed');
