#!/usr/bin/env node
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { once } from 'node:events';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { getTrackedSubprocessCount } from '../../../src/shared/subprocess/tracking.js';

const normal = new AbortController();
let child;
let observed;
const closedError = await spawnSubprocess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore', killTree: false, signal: normal.signal, timeoutAbortReapWaitMs: 100,
  onSpawn: value => { child = value; value.once('close', () => { observed = true; }); normal.abort(); }
}).then(() => assert.fail('abort must reject'), error => error);
assert.equal(observed, true);
assert.equal(closedError.result.termination.closeObserved, true);
assert.equal(closedError.result.termination.closeTimedOut, false);
assert.equal(closedError.cacheOwnershipPending, undefined);
assert.equal(closedError.result.termination.scope, 'spawned-child-close-only');

const nativeSpawn = childProcess.spawn;
let suppressClose = true, actualClose = null, nativeEmit;
childProcess.spawn = (...args) => {
  child = nativeSpawn(...args);
  nativeEmit = child.emit;
  child.emit = function(event, ...payload) {
    if (event === 'close' && suppressClose) { actualClose = payload; return true; }
    return nativeEmit.call(this, event, ...payload);
  };
  return child;
};
syncBuiltinESMExports();
try {
  const delayed = new AbortController();
  const error = await spawnSubprocess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore', killTree: false, signal: delayed.signal, timeoutAbortReapWaitMs: 25,
    onSpawn: () => delayed.abort()
  }).then(() => assert.fail('abort must reject'), value => value);
  assert.equal(error.code, 'ABORT_ERR');
  assert.equal(error.result.termination.closeObserved, false, 'signal acknowledgement and actual process exit cannot substitute for a missing close event');
  assert.equal(error.result.termination.closeTimedOut, true);
  assert.equal(error.cacheOwnershipPending, true);
  assert.equal(error.cacheOwnershipReleased(), false);
  assert.equal(getTrackedSubprocessCount(), 1, 'unconfirmed close retains tracked cleanup ownership');
  if (child.exitCode == null && child.signalCode == null) await once(child, 'exit');
  suppressClose = false;
  if (actualClose) nativeEmit.call(child, 'close', ...actualClose);
  else await once(child, 'close');
  assert.equal(getTrackedSubprocessCount(), 0);
  assert.equal(error.cacheOwnershipReleased(), true,
    'only the delayed close of this exact spawned handle reconciles missing-close ownership');
} finally {
  suppressClose = false;
  if (actualClose) nativeEmit.call(child, 'close', ...actualClose);
  childProcess.spawn = nativeSpawn; syncBuiltinESMExports();
}
console.log('Actual child close and bounded missing-close fault remain distinct termination evidence.');
