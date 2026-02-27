#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-type-definition-fallback-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const tracePath = path.join(tempRoot, 'trace.jsonl');
const docText = 'int add(int a, int b) { return a + b; }\nint sentinel = add(1, 2);\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:type-definition-fallback.cpp';
const chunkUid = 'ck64:v1:test:src/sample.cpp:type-definition-fallback';
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

const previousTracePath = process.env.POC_LSP_TRACE;
process.env.POC_LSP_TRACE = tracePath;

let result = null;
try {
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
        chunkId: 'chunk_type_definition_fallback',
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
    args: [serverPath, '--mode', 'type-definition-richer'],
    parseSignature,
    definitionEnabled: false,
    typeDefinitionEnabled: true
  });
} finally {
  if (previousTracePath == null) delete process.env.POC_LSP_TRACE;
  else process.env.POC_LSP_TRACE = previousTracePath;
}

const payload = result.byChunkUid?.[chunkUid]?.payload || null;
assert.ok(payload, 'expected payload for chunk');
assert.equal(payload.returnType, 'int', 'expected typeDefinition stage to recover return type');
assert.deepEqual(payload.paramTypes?.a?.map((entry) => entry.type), ['int']);
assert.deepEqual(payload.paramTypes?.b?.map((entry) => entry.type), ['int']);
assert.equal(
  Number(result?.hoverMetrics?.definitionRequested || 0),
  0,
  'expected definition stage disabled for this test'
);
assert.equal(
  Number(result?.hoverMetrics?.typeDefinitionRequested || 0) >= 1,
  true,
  'expected typeDefinition request metric increment'
);
assert.equal(
  Number(result?.hoverMetrics?.typeDefinitionSucceeded || 0) >= 1,
  true,
  'expected typeDefinition success metric increment'
);
assert.equal(
  Number(result?.hoverMetrics?.fallbackUsed || 0),
  0,
  'expected source fallback not used when typeDefinition resolves payload'
);

const traceLines = (await fs.readFile(tracePath, 'utf8'))
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const typeDefinitionCalls = traceLines.filter(
  (entry) => entry.kind === 'request' && entry.method === 'textDocument/typeDefinition'
).length;
assert.equal(typeDefinitionCalls >= 1, true, 'expected typeDefinition request trace event');

console.log('LSP typeDefinition fallback test passed');
