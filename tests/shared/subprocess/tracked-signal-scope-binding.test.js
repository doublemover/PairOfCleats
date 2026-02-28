#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  getTrackedSubprocessCount,
  registerChildProcessForCleanup,
  spawnSubprocess,
  terminateTrackedSubprocesses,
  withTrackedSubprocessSignalScope
} from '../../../src/shared/subprocess.js';

const waitFor = async (predicate, timeoutMs = 5000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
};

const controller = new AbortController();
const scope = 'scope-signal-binding';

const pending = withTrackedSubprocessSignalScope(controller.signal, scope, () => spawnSubprocess(
  process.execPath,
  ['-e', 'setInterval(() => {}, 60000);'],
  {
    stdio: 'ignore',
    rejectOnNonZeroExit: false,
    detached: process.platform !== 'win32'
  }
));
let unregisterRawChild = () => {};
await withTrackedSubprocessSignalScope(controller.signal, scope, () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000);'], {
    stdio: 'ignore',
    detached: process.platform !== 'win32'
  });
  unregisterRawChild = registerChildProcessForCleanup(child, {
    killTree: true,
    detached: process.platform !== 'win32'
  });
  return child;
});

const tracked = await waitFor(() => getTrackedSubprocessCount(scope) > 0, 5000);
assert.equal(tracked, true, 'expected subprocess to inherit tracked scope from bound signal');
const scopedTrackedCount = getTrackedSubprocessCount(scope);
assert.ok(scopedTrackedCount >= 2, 'expected both shared-runner and raw-registered subprocesses in bound scope');

const scopedSummary = await terminateTrackedSubprocesses({
  reason: 'signal-scope-test',
  force: true,
  ownershipId: scope
});
assert.ok(
  scopedSummary.attempted >= scopedTrackedCount,
  'expected scoped terminate to kill inherited-scope subprocesses'
);
assert.equal(scopedSummary.failures, 0, 'expected scoped terminate to succeed');
assert.equal(scopedSummary.ownershipId, scope, 'expected scoped terminate to report ownership id');
assert.ok(
  scopedSummary.terminatedOwnershipIds.includes(scope),
  'expected terminated ownership list to include inherited scope'
);
assert.ok(
  scopedSummary.killAudit.every((entry) => entry.ownershipId === scope),
  'expected kill-audit ownership ids to stay scoped'
);

await pending;
unregisterRawChild();
assert.equal(getTrackedSubprocessCount(scope), 0, 'expected scope registry to be empty after terminate');

console.log('tracked subprocess signal scope binding test passed');
