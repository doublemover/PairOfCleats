#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { acquireIndexLock } from '../../../src/index/build/lock.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv();

const root = process.cwd();
const outDir = resolveTestCachePath(root, 'index-lock-signal-listeners');
const repoCacheRoot = path.join(outDir, 'repo-cache');
await fsPromises.rm(outDir, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoCacheRoot, 'locks'), { recursive: true });

const signalEvents = ['SIGINT', 'SIGTERM'];
if (process.platform === 'win32') signalEvents.push('SIGBREAK');

const before = {
  exit: process.listenerCount('exit')
};
for (const event of signalEvents) {
  before[event] = process.listenerCount(event);
}

const lock = await acquireIndexLock({ repoCacheRoot, waitMs: 0, log: () => {} });
assert.ok(lock, 'expected index lock acquisition to succeed');

try {
  const duringExit = process.listenerCount('exit');
  assert.equal(duringExit, before.exit + 1, 'lock should only register one exit cleanup handler');

  for (const event of signalEvents) {
    const during = process.listenerCount(event);
    assert.equal(
      during,
      before[event],
      `lock should not register ${event} handler that changes process signal ownership`
    );
  }
} finally {
  await lock.release();
}

assert.equal(process.listenerCount('exit'), before.exit, 'exit handler should be removed on release');
for (const event of signalEvents) {
  assert.equal(process.listenerCount(event), before[event], `${event} listeners should remain unchanged`);
}

console.log('index lock signal listener hygiene test passed');
