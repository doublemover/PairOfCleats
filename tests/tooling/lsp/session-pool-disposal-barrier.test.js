#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { withLspSession, __testLspSessionPool } from '../../../src/integrations/tooling/providers/lsp/session-pool.js';
import { sleep } from '../../../src/shared/sleep.js';
import { removePathWithRetry } from '../../../src/shared/io/remove-path-with-retry.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-session-pool-disposal-barrier-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const sessionOptions = {
  enabled: true,
  repoRoot: tempRoot,
  providerId: 'lsp-session-pool-disposal-barrier',
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

try {
  __testLspSessionPool.setDisposeDelayMs(350);

  await withLspSession(sessionOptions, async () => null);
  await sleep(1_100);

  const startedAt = Date.now();
  await withLspSession(sessionOptions, async () => null);
  const elapsedMs = Date.now() - startedAt;

  assert.equal(__testLspSessionPool.getSize(), 1, 'expected replacement session to remain pooled');
  assert.equal(
    elapsedMs >= 150,
    true,
    `expected lease acquisition to observe disposal barrier wait (elapsed=${elapsedMs}ms)`
  );

  await sleep(50);
  assert.equal(__testLspSessionPool.getPendingDisposals(), 0, 'expected no pending disposal barriers');

  console.log('LSP session pool disposal barrier test passed');
} finally {
  await __testLspSessionPool.reset();
  const cleanup = await removePathWithRetry(tempRoot, {
    attempts: 6,
    baseDelayMs: 100,
    maxDelayMs: 100
  });
  if (!cleanup.ok) throw cleanup.error;
}
