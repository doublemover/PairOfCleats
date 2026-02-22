#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  getTrackedSubprocessCount,
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

const tracked = await waitFor(() => getTrackedSubprocessCount(scope) > 0, 5000);
assert.equal(tracked, true, 'expected subprocess to inherit tracked scope from bound signal');
const scopedTrackedCount = getTrackedSubprocessCount(scope);
assert.ok(scopedTrackedCount > 0, 'expected at least one subprocess in bound scope');

const scopedSummary = await terminateTrackedSubprocesses({
  reason: 'signal-scope-test',
  force: true,
  scope
});
assert.ok(
  scopedSummary.attempted >= scopedTrackedCount,
  'expected scoped terminate to kill inherited-scope subprocesses'
);
assert.equal(scopedSummary.failures, 0, 'expected scoped terminate to succeed');

await pending;
assert.equal(getTrackedSubprocessCount(scope), 0, 'expected scope registry to be empty after terminate');

console.log('tracked subprocess signal scope binding test passed');
