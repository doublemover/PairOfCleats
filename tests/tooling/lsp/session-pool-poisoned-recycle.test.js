#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { __testLspSessionPool } from '../../../src/integrations/tooling/providers/lsp/session-pool.js';
import { removePathWithRetry } from '../../../src/shared/io/remove-path-with-retry.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-session-pool-poisoned-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int a, int b) { return a + b; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:stub.cpp';

const runCollect = async () => collectLspTypes({
  rootDir: tempRoot,
  vfsRoot: tempRoot,
  providerId: 'lsp-session-pool-poisoned',
  documents: [{
    virtualPath,
    text: docText,
    languageId: 'cpp',
    effectiveExt: '.cpp'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid: 'ck64:v1:test:src/sample.cpp:poison',
      chunkId: 'chunk_poison',
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
  args: [serverPath, '--mode', 'disconnect-on-document-symbol'],
  parseSignature: (detail) => ({
    signature: detail,
    returnType: 'int',
    paramTypes: { a: 'int', b: 'int' }
  }),
  sessionIdleTimeoutMs: 60_000,
  sessionMaxLifetimeMs: 120_000
});

try {
  const result = await runCollect();
  assert.equal(
    result.checks.some((check) => check?.name === 'tooling_document_symbol_failed'),
    true,
    'expected transport failure to be surfaced as degraded tooling warning'
  );
  assert.equal(
    __testLspSessionPool.getSize(),
    0,
    'expected poisoned pooled session to be recycled instead of kept for reuse'
  );

  console.log('LSP session pool poisoned recycle test passed');
} finally {
  await __testLspSessionPool.reset();
  const cleanup = await removePathWithRetry(tempRoot, {
    attempts: 6,
    baseDelayMs: 100,
    maxDelayMs: 100
  });
  if (!cleanup.ok) throw cleanup.error;
}
