#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'vfs-partial-lsp-open');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const tracePath = path.join(tempRoot, 'trace.jsonl');
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');

const docText = 'int add(int a, int b) { return a + b; }\n';
const docText2 = 'int sub(int a, int b) { return a - b; }\n';
const virtualPath1 = '.poc-vfs/src/sample.cpp#seg:stub.cpp';
const virtualPath2 = '.poc-vfs/src/unused.cpp#seg:stub.cpp';
const documents = [
  { virtualPath: virtualPath1, text: docText, languageId: 'cpp', effectiveExt: '.cpp' },
  { virtualPath: virtualPath2, text: docText2, languageId: 'cpp', effectiveExt: '.cpp' }
];

const chunkUid = 'ck64:v1:test:src/sample.cpp:deadbeef';
const targets = [{
  chunkRef: {
    docId: 0,
    chunkUid,
    chunkId: 'chunk_deadbeef',
    file: 'src/sample.cpp',
    segmentUid: null,
    segmentId: null,
    range: { start: 0, end: docText.length }
  },
  virtualPath: virtualPath1,
  virtualRange: { start: 0, end: docText.length },
  symbolHint: { name: 'add', kind: 'function' }
}];

const originalTrace = process.env.POC_LSP_TRACE;
process.env.POC_LSP_TRACE = tracePath;
try {
  await collectLspTypes({
    rootDir: tempRoot,
    vfsRoot: tempRoot,
    documents,
    targets,
    cmd: process.execPath,
    args: [serverPath, '--mode', 'clangd'],
    parseSignature: (detail) => ({
      signature: detail,
      returnType: 'int',
      paramTypes: { a: 'int', b: 'int' }
    })
  });
} finally {
  process.env.POC_LSP_TRACE = originalTrace;
}

const traceRaw = await fs.readFile(tracePath, 'utf8');
const events = traceRaw.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const didOpenCount = events.filter((evt) => evt.kind === 'notification' && evt.method === 'textDocument/didOpen').length;
const documentSymbolCount = events.filter((evt) => evt.kind === 'request' && evt.method === 'textDocument/documentSymbol').length;

assert.equal(didOpenCount, 1, 'expected only one didOpen (docs without targets should be skipped)');
assert.equal(documentSymbolCount, 1, 'expected only one documentSymbol request');

console.log('VFS partial LSP open test passed');
