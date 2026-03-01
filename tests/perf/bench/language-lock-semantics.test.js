#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { checkIndexLock } from '../../../tools/bench/language/locks.js';

const root = path.join(process.cwd(), 'tests', '.cache', 'bench-language-lock-semantics');
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
assert.equal(staleResult.ok, true, 'expected stale lock to be cleared');
assert.equal(staleResult.cleared, true, 'expected stale lock to report cleared');
const staleExists = await fsPromises.stat(lockPath).then(() => true).catch(() => false);
assert.equal(staleExists, false, 'expected stale lock file to be removed');

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
