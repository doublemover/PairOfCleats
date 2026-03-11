#!/usr/bin/env node
import assert from 'node:assert/strict';
import { attachCleanupSignalHandlers } from '../../../src/shared/process-signals.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const beforeSigterm = process.listenerCount('SIGTERM');

let cleanupSignals = [];
let reemitted = [];
const detach = attachCleanupSignalHandlers({
  signals: ['SIGTERM'],
  cleanup: (signal) => cleanupSignals.push(signal),
  reemitSignal: (signal) => reemitted.push(signal)
});

process.emit('SIGTERM', 'SIGTERM');

assert.deepEqual(cleanupSignals, ['SIGTERM'], 'expected cleanup to run for SIGTERM');
assert.deepEqual(reemitted, ['SIGTERM'], 'expected default termination preservation to re-emit SIGTERM');
assert.equal(process.listenerCount('SIGTERM'), beforeSigterm, 'expected SIGTERM listeners restored after signal handling');

detach();

const externalListener = () => {};
process.once('SIGTERM', externalListener);
cleanupSignals = [];
reemitted = [];

const detachWithExternal = attachCleanupSignalHandlers({
  signals: ['SIGTERM'],
  cleanup: (signal) => cleanupSignals.push(signal),
  reemitSignal: (signal) => reemitted.push(signal)
});

process.emit('SIGTERM', 'SIGTERM');

assert.deepEqual(cleanupSignals, ['SIGTERM'], 'expected cleanup to run with existing external listener');
assert.deepEqual(reemitted, [], 'expected no re-emit when external listeners already own SIGTERM');
assert.equal(process.listenerCount('SIGTERM'), beforeSigterm, 'expected SIGTERM listeners restored after external-listener run');

detachWithExternal();

console.log('cleanup signal handler preservation test passed');
