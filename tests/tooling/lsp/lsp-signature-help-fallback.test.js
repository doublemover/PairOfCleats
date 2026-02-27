#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-signature-help-fallback-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const tracePath = path.join(tempRoot, 'trace.jsonl');
const docText = 'const sentinel = 1;\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:signature-help.cpp';
const chunkUid = 'ck64:v1:test:src/sample.cpp:signature-help';

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

const originalTracePath = process.env.POC_LSP_TRACE;
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
        chunkId: 'chunk_signature_help',
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
} finally {
  if (originalTracePath == null) delete process.env.POC_LSP_TRACE;
  else process.env.POC_LSP_TRACE = originalTracePath;
}

const payload = result.byChunkUid?.[chunkUid]?.payload || null;
assert.ok(payload, 'expected payload for chunk');
assert.equal(payload.returnType, 'int', 'expected signatureHelp to supply return type');
assert.deepEqual(payload.paramTypes?.a?.map((entry) => entry.type), ['int']);
assert.deepEqual(payload.paramTypes?.b?.map((entry) => entry.type), ['int']);
assert.equal(
  Number(result?.hoverMetrics?.signatureHelpRequested || 0) >= 1,
  true,
  'expected signatureHelp stage request for incomplete symbol payload'
);
assert.equal(
  Number(result?.hoverMetrics?.signatureHelpSucceeded || 0) >= 1,
  true,
  'expected signatureHelp stage success count'
);
assert.equal(
  Number(result?.hoverMetrics?.fallbackUsed || 0),
  0,
  'expected source fallback to remain unused when signatureHelp completes payload'
);

const traceLines = (await fs.readFile(tracePath, 'utf8'))
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const signatureHelpCalls = traceLines.filter(
  (entry) => entry.kind === 'request' && entry.method === 'textDocument/signatureHelp'
).length;
assert.equal(signatureHelpCalls >= 1, true, 'expected signatureHelp request trace entry');

console.log('LSP signatureHelp fallback test passed');
