#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { __testLspSessionPool } from '../../../src/integrations/tooling/providers/lsp/session-pool.js';
import { removePathWithRetry } from '../../../src/shared/io/remove-path-with-retry.js';
import { sleep } from '../../../src/shared/sleep.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-session-pool-bg-lifetime-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const counterPath = path.join(tempRoot, 'lsp-session-bg-lifetime.counter');

const docText = 'int add(int a, int b) { return a + b; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:stub.cpp';

const runCollect = async () => collectLspTypes({
  rootDir: tempRoot,
  vfsRoot: tempRoot,
  providerId: 'lsp-session-pool-bg-lifetime',
  documents: [{
    virtualPath,
    text: docText,
    languageId: 'cpp',
    effectiveExt: '.cpp'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid: 'ck64:v1:test:src/sample.cpp:bg-lifetime',
      chunkId: 'chunk_bg_lifetime',
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
  sessionMaxLifetimeMs: 1_500
});

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

try {
  await withTemporaryEnv({ POC_LSP_COUNTER: counterPath }, async () => {
    await runCollect();
    assert.equal(__testLspSessionPool.getSize(), 1, 'expected pooled session after initial collect');
    await sleep(3_200);
    const drained = await waitForSessionPoolToDrain();
    assert.equal(drained, true, 'expected background cleanup to recycle max-lifetime-expired session');
  });

  console.log('LSP session pool background lifetime expiry test passed');
} finally {
  await __testLspSessionPool.reset();
  const cleanup = await removePathWithRetry(tempRoot, {
    attempts: 6,
    baseDelayMs: 100,
    maxDelayMs: 100
  });
  if (!cleanup.ok) throw cleanup.error;
}
