#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { __testLspSessionPool, drainLspSessionPool, withLspSession } from '../../../src/integrations/tooling/providers/lsp/session-pool.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-lsp-health-retirement-'));
const options = (workspaceKey) => ({
  repoRoot: root, cwd: root, workspaceKey, providerId: 'health-retirement-fixture',
  cmd: process.execPath, args: [], sessionPoolMaxEntries: 2, sessionIdleTimeoutMs: 60_000,
  log: () => {}
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
let releaseActive = null;
let activeWork = null;
try {
  await __testLspSessionPool.reset();
  for (let id = 0; id < 8; id += 1) {
    await withLspSession(options(`healthy-${id}`), async (lease) => {
      assert.equal(lease.isTransportRunning, false, 'the fixture never starts a language server or project execution');
    });
  }
  assert.equal(__testLspSessionPool.getSize(), 2);
  assert.equal(__testLspSessionPool.getHealthRecordCount(), 8);
  assert.equal((await drainLspSessionPool({ timeoutMs: 1000 })).status, 'ok');
  assert.equal(__testLspSessionPool.getSize(), 0);
  assert.equal(__testLspSessionPool.getPendingDisposals(), 0);
  assert.equal(__testLspSessionPool.getHealthRecordCount(), 0, 'completed healthy generations must retire unused metadata keys');

  let failedKey;
  await withLspSession(options('failed'), async (lease) => {
    failedKey = lease.sessionKey;
    lease.markPoisoned('initialize_failed');
  });
  await drainLspSessionPool({ timeoutMs: 1000 });
  assert.equal(__testLspSessionPool.getHealthRecordCount(), 1);
  assert.equal(__testLspSessionPool.getHealthStateForKey(failedKey).active, true);
  await assert.rejects(withLspSession(options('failed'), async () => assert.fail('quarantined work cannot enter')), { code: 'TOOLING_QUARANTINED' });

  const entered = deferred();
  const activeGate = deferred();
  releaseActive = activeGate.resolve;
  activeWork = withLspSession(options('active'), async () => {
    entered.resolve();
    await activeGate.promise;
  });
  await entered.promise;
  await drainLspSessionPool({ timeoutMs: 1000 });
  assert.equal(__testLspSessionPool.getHealthRecordCount(), 2, 'a retired transport can still have an active callback owning its health record');
  // A second drain must still preserve a lease from the already-retired transport.
  await drainLspSessionPool({ timeoutMs: 1000 });
  assert.equal(__testLspSessionPool.getHealthRecordCount(), 2);
  releaseActive();
  await activeWork;
  activeWork = null;
  await drainLspSessionPool({ timeoutMs: 1000 });
  assert.equal(__testLspSessionPool.getHealthRecordCount(), 1);

  await withLspSession(options('before-creation-barrier'), async () => {});
  __testLspSessionPool.setDisposeDelayMs(40);
  const draining = drainLspSessionPool({ timeoutMs: 1000 });
  const creationGate = deferred();
  const created = deferred();
  releaseActive = creationGate.resolve;
  activeWork = withLspSession(options('pending-creation'), async (lease) => {
    assert.equal(lease.isTransportRunning, false);
    created.resolve();
    await creationGate.promise;
  });
  await draining;
  await created.promise;
  assert.equal(__testLspSessionPool.getHealthRecordCount(), 2, 'a creation waiting on the drain retains the same health record');
  releaseActive();
  await activeWork;
  activeWork = null;
  __testLspSessionPool.setDisposeDelayMs(0);
  await drainLspSessionPool({ timeoutMs: 1000 });
  assert.equal(__testLspSessionPool.getHealthRecordCount(), 1, 'failure/quarantine history remains after healthy records retire');
  console.log('LSP health retirement passed:8 healthy records retire, quarantine/active callbacks/pending creation stay owned; no server starts');
} finally {
  releaseActive?.();
  await activeWork?.catch(() => {});
  await __testLspSessionPool.reset();
  await fs.rm(root, { recursive: true, force: true });
}
