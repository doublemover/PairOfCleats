#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-collect-shutdown-race-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const logs = [];
const docText = 'int add(int a, int b) { return a + b; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:shutdown-race.cpp';
const chunkUid = 'ck64:v1:test:src/sample.cpp:shutdown-race';

const result = await collectLspTypes({
  rootDir: tempRoot,
  vfsRoot: tempRoot,
  documents: [{
    virtualPath,
    text: docText,
    languageId: 'cpp',
    effectiveExt: '.cpp',
    docHash: 'hash-shutdown-race'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_shutdown_race',
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
  args: [serverPath, '--mode', 'clangd', '--exit-on-shutdown'],
  log: (line) => logs.push(String(line || '')),
  parseSignature: (detail) => ({
    signature: detail,
    returnType: 'int',
    paramTypes: { a: 'int', b: 'int' }
  }),
  retries: 0,
  timeoutMs: 1500
});

assert.ok(result.byChunkUid[chunkUid], 'expected enrichment before shutdown sequence');
assert.equal(
  logs.some((line) => line.includes('ERR_STREAM_DESTROYED')),
  false,
  'collectLspTypes shutdown race emitted ERR_STREAM_DESTROYED'
);
assert.equal(
  logs.some((line) => /\[lsp\]\s+write error:/i.test(line)),
  false,
  'collectLspTypes shutdown race emitted write-error log noise'
);
assert.equal(
  logs.some((line) => /\bEPIPE\b/i.test(line)),
  false,
  'collectLspTypes shutdown race emitted EPIPE log noise'
);

console.log('LSP collect shutdown race clean test passed');
