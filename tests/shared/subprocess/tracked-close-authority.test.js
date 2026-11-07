// Authored source controls; UNVALIDATED during the deferred implementation pass.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerChildProcessForCleanup, terminateTrackedSubprocesses,
  terminateTrackedSubprocessesSync, getTrackedSubprocessCount } from '../../../src/shared/subprocess/tracking.js';
import { assertSubprocessTerminationReceipt } from '../../../src/shared/subprocess/termination-receipt.js';

const owner = `tracked-close-authority:${process.pid}`;
// An inert already-exited handle exercises the observation boundary without
// sending any signal. Its old PID and exit status do not constitute close.
const child = Object.assign(new EventEmitter(), { pid: 900001, exitCode: 0, signalCode: null });
const unregister = registerChildProcessForCleanup(child, { ownershipId: owner });
try {
  const synchronous = terminateTrackedSubprocessesSync({ ownershipId: owner });
  assert.equal(synchronous.killAudit[0].terminated, true);
  assert.equal(synchronous.killAudit[0].closeObserved, false);
  assert.equal(getTrackedSubprocessCount(owner), 1, 'synchronous cleanup cannot publish an unobserved event');
  assert.throws(() => assertSubprocessTerminationReceipt(synchronous), /unconfirmed/);

  const bounded = await terminateTrackedSubprocesses({ ownershipId: owner });
  assert.equal(bounded.killAudit[0].closeObserved, false);
  assert.equal(getTrackedSubprocessCount(owner), 1);
  assert.throws(() => assertSubprocessTerminationReceipt(bounded), /unconfirmed/);

  const closing = terminateTrackedSubprocesses({ ownershipId: owner });
  child.emit('close', 0, null);
  const confirmed = await closing;
  assert.equal(confirmed.killAudit[0].closeObserved, true);
  assert.equal(getTrackedSubprocessCount(owner), 0);
  assert.equal(assertSubprocessTerminationReceipt(confirmed), confirmed);

  const replacement = Object.assign(new EventEmitter(), { pid: child.pid, exitCode: 0, signalCode: null });
  const releaseReplacement = registerChildProcessForCleanup(replacement, { ownershipId: owner });
  try {
    child.emit('close', 0, null);
    assert.equal(getTrackedSubprocessCount(owner), 1, 'an old handle close cannot release a replacement with the same PID/scope');
    assert.throws(() => assertSubprocessTerminationReceipt(confirmed), /unconfirmed/);
    replacement.emit('close', 0, null);
  } finally { releaseReplacement(); }
} finally { unregister(); }
console.log('Tracked termination requires exact-handle close and preserves replacement ownership.');
