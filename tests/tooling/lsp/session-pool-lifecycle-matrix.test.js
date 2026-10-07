#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { __testLspSessionPool, withLspSession } from '../../../src/integrations/tooling/providers/lsp/session-pool.js';
import { removePathWithRetry } from '../../../src/shared/io/remove-path-with-retry.js';
import { sleep } from '../../../src/shared/sleep.js';
import { countNonEmptyLines } from '../../helpers/lsp-signature-fixtures.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int a, int b) { return a + b; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:stub.cpp';

const createCollectRunner = ({ tempRoot, providerId, mode, sessionMaxLifetimeMs = 120_000 }) => async (chunkSuffix) => collectLspTypes({
  rootDir: tempRoot,
  vfsRoot: tempRoot,
  providerId,
  documents: [{
    virtualPath,
    text: docText,
    languageId: 'cpp',
    effectiveExt: '.cpp'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid: `ck64:v1:test:src/sample.cpp:${providerId}-${chunkSuffix}`,
      chunkId: `chunk_${providerId.replace(/[^a-z0-9]+/gi, '_')}_${chunkSuffix}`,
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
  args: [serverPath, '--mode', mode],
  parseSignature: (detail) => ({
    signature: detail,
    returnType: 'int',
    paramTypes: { a: 'int', b: 'int' }
  }),
  sessionIdleTimeoutMs: 60_000,
  sessionMaxLifetimeMs
});

const cleanupTempRoot = async (tempRoot) => {
  const cleanup = await removePathWithRetry(tempRoot, {
    attempts: 6,
    baseDelayMs: 100,
    maxDelayMs: 100
  });
  if (!cleanup.ok) throw cleanup.error;
};

const waitForSessionPoolToDrain = async ({ timeoutMs = 5000, pollMs = 100 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (__testLspSessionPool.getSize() === 0 && __testLspSessionPool.getPendingDisposals() === 0) {
      return true;
    }
    await sleep(pollMs);
  }
  return __testLspSessionPool.getSize() === 0 && __testLspSessionPool.getPendingDisposals() === 0;
};

const runCase = async (name, fn) => {
  const tempRoot = resolveTestCachePath(root, `${name}-${process.pid}-${Date.now()}`);
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(tempRoot, { recursive: true });
  try {
    await fn(tempRoot);
  } finally {
    await __testLspSessionPool.reset();
    await cleanupTempRoot(tempRoot);
  }
};

await runCase('lsp-session-pool-reuse-matrix', async (tempRoot) => {
  const counterPath = path.join(tempRoot, 'lsp-session-pool.counter');
  const runCollect = createCollectRunner({
    tempRoot,
    providerId: 'lsp-session-pool-reuse-matrix',
    mode: 'initialize-once'
  });

  await withTemporaryEnv({ POC_LSP_COUNTER: counterPath }, async () => {
    const first = await runCollect('one');
    const second = await runCollect('two');
    const spawnCount = await countNonEmptyLines(counterPath);
    assert.equal(spawnCount, 1);
    assert.equal(first.runtime?.pooling?.enabled, true);
    assert.equal(first.runtime?.pooling?.reused, false);
    assert.equal(second.runtime?.pooling?.reused, true);
    assert.equal(second.enriched >= 1, true);
  });
});

await runCase('lsp-session-pool-poisoned-matrix', async (tempRoot) => {
  const runCollect = createCollectRunner({
    tempRoot,
    providerId: 'lsp-session-pool-poisoned-matrix',
    mode: 'disconnect-on-document-symbol'
  });

  const result = await runCollect('poisoned');
  assert.equal(result.checks.some((check) => check?.name === 'tooling_document_symbol_failed'), true);
  assert.equal(__testLspSessionPool.getSize(), 0);
});

await runCase('lsp-session-pool-lifetime-matrix', async (tempRoot) => {
  const counterPath = path.join(tempRoot, 'lsp-session-lifetime.counter');
  const runCollect = createCollectRunner({
    tempRoot,
    providerId: 'lsp-session-pool-lifetime-matrix',
    mode: 'clangd',
    sessionMaxLifetimeMs: 1_000
  });

  await withTemporaryEnv({ POC_LSP_COUNTER: counterPath }, async () => {
    const first = await runCollect('one');
    await sleep(1_200);
    const second = await runCollect('two');
    const spawnCount = await countNonEmptyLines(counterPath);
    assert.equal(spawnCount, 2);
    assert.equal(first.runtime?.pooling?.reused, false);
    assert.equal(second.runtime?.pooling?.reused, false);
    assert.equal(second.runtime?.pooling?.recycleCount >= 0, true);
  });
});

await runCase('lsp-session-pool-disposal-barrier-matrix', async (tempRoot) => {
  __testLspSessionPool.setDisposeDelayMs(350);
  const sessionOptions = {
    enabled: true,
    repoRoot: tempRoot,
    providerId: 'lsp-session-pool-disposal-barrier-matrix',
    workspaceKey: tempRoot,
    cmd: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 50)'],
    cwd: tempRoot,
    timeoutMs: 1000,
    retries: 0,
    breakerThreshold: 1,
    sessionIdleTimeoutMs: 60_000,
    sessionMaxLifetimeMs: 1_000
  };

  await withLspSession(sessionOptions, async () => null);
  await sleep(1_100);
  const startedAt = Date.now();
  await withLspSession(sessionOptions, async () => null);
  const elapsedMs = Date.now() - startedAt;
  assert.equal(__testLspSessionPool.getSize(), 1);
  assert.equal(elapsedMs >= 150, true, `expected disposal barrier wait, got ${elapsedMs}ms`);
  await sleep(50);
  assert.equal(__testLspSessionPool.getPendingDisposals(), 0);
});

await runCase('lsp-session-pool-background-lifetime-matrix', async (tempRoot) => {
  const counterPath = path.join(tempRoot, 'lsp-session-bg-lifetime.counter');
  const runCollect = createCollectRunner({
    tempRoot,
    providerId: 'lsp-session-pool-background-lifetime-matrix',
    mode: 'clangd',
    sessionMaxLifetimeMs: 1_500
  });

  await withTemporaryEnv({ POC_LSP_COUNTER: counterPath }, async () => {
    await runCollect('background');
    assert.equal(__testLspSessionPool.getSize(), 1);
    await sleep(3_200);
    const drained = await waitForSessionPoolToDrain();
    assert.equal(drained, true);
  });
});

console.log('LSP session pool lifecycle matrix test passed');
