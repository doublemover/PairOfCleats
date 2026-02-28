#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  getTrackedSubprocessCount,
  registerChildProcessForCleanup,
  resetTrackedSubprocessEvents,
  snapshotTrackedSubprocessEvents,
  terminateTrackedSubprocesses
} from '../../../src/shared/subprocess.js';

const ownershipId = `event-ledger-${process.pid}-${Date.now()}`;

const waitFor = async (predicate, timeoutMs = 5000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
};

try {
  resetTrackedSubprocessEvents();
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {
    stdio: 'ignore',
    detached: process.platform !== 'win32'
  });
  assert.ok(Number.isFinite(child.pid) && child.pid > 0, 'expected child pid for event-ledger test');

  const unregister = registerChildProcessForCleanup(child, {
    killTree: true,
    detached: process.platform !== 'win32',
    scope: ownershipId,
    ownershipId,
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000);'],
    name: 'tracked-event-ledger'
  });

  const tracked = await waitFor(() => getTrackedSubprocessCount(ownershipId) > 0, 5000);
  assert.equal(tracked, true, 'expected tracked subprocess registration');

  const spawnedSnapshot = snapshotTrackedSubprocessEvents({ ownershipId, limit: 32 });
  assert.ok(
    spawnedSnapshot.events.some((event) => event.kind === 'process_spawned' && event.pid === child.pid),
    'expected process_spawned event in tracked subprocess ledger'
  );

  const summary = await terminateTrackedSubprocesses({
    reason: 'tracked-event-ledger-test',
    force: true,
    ownershipId
  });
  assert.equal(summary.failures, 0, 'expected tracked subprocess termination without failures');
  assert.equal(getTrackedSubprocessCount(ownershipId), 0, 'expected tracked scope to be empty after cleanup');

  const postSnapshot = snapshotTrackedSubprocessEvents({ ownershipId, limit: 64 });
  assert.ok(
    postSnapshot.events.some((event) => event.kind === 'process_untracked' && event.reason === 'terminate'),
    'expected process_untracked(terminate) event for ownership scope'
  );
  assert.ok(
    postSnapshot.events.some((event) => event.kind === 'process_reaped' && event.reason === 'tracked-event-ledger-test'),
    'expected process_reaped event with termination reason'
  );

  unregister();
  console.log('tracked subprocess event ledger test passed');
} finally {
  await terminateTrackedSubprocesses({
    reason: 'tracked-event-ledger-finally',
    force: true,
    ownershipId
  });
  resetTrackedSubprocessEvents();
}
