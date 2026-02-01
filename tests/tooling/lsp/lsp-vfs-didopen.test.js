#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'lsp-vfs-didopen');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const tracePath = path.join(tempRoot, 'trace.jsonl');
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int a, int b) { return a + b; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:stub.cpp';
const documents = [{
  virtualPath,
  text: docText,
  languageId: 'cpp',
  effectiveExt: '.cpp'
}];

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
  virtualPath,
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
const didOpenIndex = events.findIndex((evt) => evt.kind === 'notification' && evt.method === 'textDocument/didOpen');
const documentSymbolIndex = events.findIndex((evt) => evt.kind === 'request' && evt.method === 'textDocument/documentSymbol');

assert.ok(didOpenIndex !== -1, 'expected didOpen notification to be recorded');
assert.ok(documentSymbolIndex !== -1, 'expected documentSymbol request to be recorded');
assert.ok(didOpenIndex < documentSymbolIndex, 'expected didOpen before documentSymbol');

console.log('LSP VFS didOpen ordering test passed');
