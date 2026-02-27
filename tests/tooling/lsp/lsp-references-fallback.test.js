#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { parseCppTwoIntParamSignature, parseJsonLinesFile } from '../../helpers/lsp-signature-fixtures.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-references-fallback-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const tracePath = path.join(tempRoot, 'trace.jsonl');
const docText = 'int add(int a, int b) { return a + b; }\nint sentinel = add(1, 2);\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:references-fallback.cpp';
const chunkUid = 'ck64:v1:test:src/sample.cpp:references-fallback';
const symbolStart = docText.indexOf('add');

const parseSignature = (detailText) => parseCppTwoIntParamSignature(detailText, {
  bareNames: ['add'],
  bareReturnType: 'unknown'
});

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
        chunkId: 'chunk_references_fallback',
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
    args: [serverPath, '--mode', 'references-richer'],
    parseSignature,
    definitionEnabled: false,
    typeDefinitionEnabled: false,
    referencesEnabled: true
  });
});

const payload = result.byChunkUid?.[chunkUid]?.payload || null;
assert.ok(payload, 'expected payload for chunk');
assert.equal(payload.returnType, 'int', 'expected references stage to recover return type');
assert.deepEqual(payload.paramTypes?.a?.map((entry) => entry.type), ['int']);
assert.deepEqual(payload.paramTypes?.b?.map((entry) => entry.type), ['int']);
assert.equal(
  Number(result?.hoverMetrics?.referencesRequested || 0) >= 1,
  true,
  'expected references request metric increment'
);
assert.equal(
  Number(result?.hoverMetrics?.referencesSucceeded || 0) >= 1,
  true,
  'expected references success metric increment'
);
assert.equal(
  Number(result?.hoverMetrics?.fallbackUsed || 0),
  0,
  'expected source fallback not used when references resolves payload'
);

const traceLines = await parseJsonLinesFile(tracePath);
const referencesCalls = traceLines.filter(
  (entry) => entry.kind === 'request' && entry.method === 'textDocument/references'
).length;
assert.equal(referencesCalls >= 1, true, 'expected references request trace event');

console.log('LSP references fallback test passed');
