#!/usr/bin/env node
import { resolveDevelopmentArtifactPath } from '../../../tools/shared/dev-artifacts.js';
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { checkIndexLock } from '../../../tools/bench/language/locks.js';

const root = resolveDevelopmentArtifactPath(process.cwd(), 'test-cache', 'bench-language-lock-semantics');
const locksDir = path.join(root, 'locks');
const lockPath = path.join(locksDir, 'index.lock');

await fsPromises.rm(root, { recursive: true, force: true });
await fsPromises.mkdir(locksDir, { recursive: true });

const staleStartedAt = new Date(Date.now() - 5000).toISOString();
await fsPromises.writeFile(lockPath, JSON.stringify({ pid: process.pid, startedAt: staleStartedAt }));

const staleResult = await checkIndexLock({
  repoCacheRoot: root,
  repoLabel: 'repo',
  lockMode: 'fail-fast',
  lockWaitMs: 0,
  lockStaleMs: 1000,
  onLog: () => {}
});
assert.equal(staleResult.ok, false, 'elapsed age cannot authorize removal of a live writer');
const staleExists = await fsPromises.stat(lockPath).then(() => true).catch(() => false);
assert.equal(staleExists, true, 'live lock remains protected past its diagnostic stale age');

// Keep the stale-cleanup positive on a process-only owner whose actual child
// close was observed; the old live-PID positive authorized concurrent writers.
const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore', windowsHide: true });
const [code] = await once(child, 'close');
assert.equal(code, 0);
await fsPromises.writeFile(lockPath, JSON.stringify({ pid: child.pid, lockId: 'dead-process-only', startedAt: staleStartedAt }));
const deadResult = await checkIndexLock({ repoCacheRoot: root, repoLabel: 'repo', lockMode: 'fail-fast',
  lockWaitMs: 0, lockStaleMs: 1000, onLog: () => {} });
assert.equal(deadResult.ok, true);
assert.equal(deadResult.cleared, true);

for (const resourceSettlementVersion of [1, 999, null]) {
  const owner = { pid: child.pid, lockId: 'pending-resource', startedAt: staleStartedAt, resourceSettlementVersion };
  await fsPromises.writeFile(lockPath, JSON.stringify(owner));
  const pending = await checkIndexLock({ repoCacheRoot: root, repoLabel: 'repo', lockMode: 'fail-fast',
    lockWaitMs: 0, lockStaleMs: 1, onLog: () => {} });
  assert.equal(pending.ok, false);
  assert.equal(pending.detail.resourcePending, true);
  assert.deepEqual(JSON.parse(await fsPromises.readFile(lockPath, 'utf8')), owner);
}

await fsPromises.mkdir(locksDir, { recursive: true });
await fsPromises.writeFile(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

const activeResult = await checkIndexLock({
  repoCacheRoot: root,
  repoLabel: 'repo',
  lockMode: 'fail-fast',
  lockWaitMs: 0,
  lockStaleMs: 60 * 60 * 1000,
  onLog: () => {}
});
assert.equal(activeResult.ok, false, 'expected active lock to block');
assert.equal(activeResult.detail.pid, process.pid, 'expected active lock pid to be reported');
assert.equal(activeResult.detail.alive, true, 'expected active lock pid to be alive');

console.log('bench-language lock semantics test passed');
