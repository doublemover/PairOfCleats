#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { __testLspSessionPool } from '../../../src/integrations/tooling/providers/lsp/session-pool.js';
import { removePathWithRetry } from '../../../src/shared/io/remove-path-with-retry.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-session-pool-reuse-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const counterPath = path.join(tempRoot, 'lsp-session-pool.counter');
const originalCounter = process.env.POC_LSP_COUNTER;
process.env.POC_LSP_COUNTER = counterPath;

const docText = 'int add(int a, int b) { return a + b; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:stub.cpp';

const runCollect = async (chunkSuffix) => collectLspTypes({
  rootDir: tempRoot,
  vfsRoot: tempRoot,
  providerId: 'lsp-session-pool-reuse',
  documents: [{
    virtualPath,
    text: docText,
    languageId: 'cpp',
    effectiveExt: '.cpp'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid: `ck64:v1:test:src/sample.cpp:reuse-${chunkSuffix}`,
      chunkId: `chunk_reuse_${chunkSuffix}`,
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
  args: [serverPath, '--mode', 'clangd'],
  parseSignature: (detail) => ({
    signature: detail,
    returnType: 'int',
    paramTypes: { a: 'int', b: 'int' }
  }),
  sessionIdleTimeoutMs: 60_000,
  sessionMaxLifetimeMs: 120_000
});

try {
  const first = await runCollect('one');
  const second = await runCollect('two');
  const counterRaw = await fs.readFile(counterPath, 'utf8');
  const spawnCount = counterRaw.trim().split(/\r?\n/).filter(Boolean).length;

  assert.equal(spawnCount, 1, 'expected one spawned LSP process for pooled reuse');
  assert.equal(first.runtime?.pooling?.enabled, true, 'expected pooling metadata on first collect');
  assert.equal(first.runtime?.pooling?.reused, false, 'expected first collect to create a fresh session');
  assert.equal(second.runtime?.pooling?.reused, true, 'expected second collect to reuse pooled session');
  assert.equal(second.enriched >= 1, true, 'expected pooled session reuse to enrich symbols');

  console.log('LSP session pool reuse test passed');
} finally {
  if (originalCounter == null) {
    delete process.env.POC_LSP_COUNTER;
  } else {
    process.env.POC_LSP_COUNTER = originalCounter;
  }
  await __testLspSessionPool.reset();
  const cleanup = await removePathWithRetry(tempRoot, {
    attempts: 6,
    baseDelayMs: 100,
    maxDelayMs: 100
  });
  if (!cleanup.ok) throw cleanup.error;
}
