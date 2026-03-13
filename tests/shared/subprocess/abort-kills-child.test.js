#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  captureProcessSnapshot,
  getTrackedSubprocessCount,
  snapshotTrackedSubprocesses,
  spawnSubprocess
} from '../../../src/shared/subprocess.js';
import { resolveSilentStdio } from '../../helpers/test-env.js';

const controller = new AbortController();
const args = ['-e', 'setInterval(() => {}, 1000)'];
let trackedSnapshotAtSpawn = null;

const waitFor = async (predicate, timeoutMs = 5000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
};

setTimeout(() => controller.abort(), 120);

let pid = null;
try {
  await spawnSubprocess(process.execPath, args, {
    stdio: resolveSilentStdio('ignore'),
    signal: controller.signal,
    killTree: true,
    onSpawn: (child) => {
      pid = child?.pid ?? null;
      trackedSnapshotAtSpawn = snapshotTrackedSubprocesses({ limit: 8, includeArgs: true });
    }
  });
  assert.fail('expected abort');
} catch (err) {
  assert.equal(err?.code, 'ABORT_ERR');
  pid = err?.result?.pid ?? null;
}

assert.ok(
  Array.isArray(trackedSnapshotAtSpawn?.entries)
    && trackedSnapshotAtSpawn.entries.some((entry) => entry.pid === pid),
  'expected tracked subprocess snapshot to include spawned pid before abort cleanup'
);
const trackedEntry = trackedSnapshotAtSpawn.entries.find((entry) => entry.pid === pid);
assert.equal(
  trackedEntry?.command,
  process.execPath,
  'expected tracked snapshot entry to retain command metadata'
);
assert.deepEqual(
  trackedEntry?.args || [],
  args,
  'expected tracked snapshot entry to retain argument metadata'
);

if (pid && process.platform !== 'win32') {
  await new Promise((resolve) => setTimeout(resolve, 150));
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch {
    alive = false;
  }
  assert.equal(alive, false, 'expected subprocess to be killed');
}

const trackedCleared = await waitFor(() => getTrackedSubprocessCount() === 0, 5000);
assert.equal(trackedCleared, true, 'expected aborted subprocess to be removed from tracked registry');
const trackedAfterAbort = snapshotTrackedSubprocesses({ limit: 8 });
assert.equal(
  trackedAfterAbort.entries.some((entry) => entry.pid === pid),
  false,
  'expected aborted subprocess snapshot to exclude spawned pid'
);
const processSnapshot = captureProcessSnapshot({ includeStack: true, frameLimit: 6, handleTypeLimit: 4 });
assert.equal(processSnapshot.pid, process.pid, 'expected process snapshot to include current pid');
assert.equal(Array.isArray(processSnapshot.stack?.frames), true, 'expected process snapshot stack frames');
assert.equal(processSnapshot.activeHandles.count >= 0, true, 'expected active handle count in process snapshot');

console.log('subprocess abort kill test passed');
