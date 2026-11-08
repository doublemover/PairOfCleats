import assert from 'node:assert/strict';
import { runQualificationCapsule } from '../../../tools/bench/qualification-capsule.js';
const primary = Object.freeze(Object.assign(new Error('original child failure'), { result: {
  pid: 42, exitCode: 1, signal: null, stdout: 'original bounded stdout', stderr: 'original bounded stderr',
  outputCapture: { stdout: { truncated: false }, stderr: { truncated: false } } } }));
let saved, releaseCalls = 0;
const pending = Object.freeze({ cacheOwnershipPending: true, cacheOwnershipReleased() { releaseCalls++; return false; } });
await assert.rejects(runQualificationCapsule({ args: ['explicit-non-native-adapter'], receiptPath: 'inert-receipt' }, {
  spawn: async (_executable, _args, options) => { assert.equal(options.timeoutMs, 30000); assert.equal(options.killTree, true); throw primary; },
  publish: async (_file, body) => { saved = body; }
}), error => error === primary);
assert.equal(saved.failures[0].result.stderr, 'original bounded stderr');
assert.match(saved.state, /not-resource-settlement-authority/u);
await assert.rejects(runQualificationCapsule({ args: [], receiptPath: 'inert' }, { spawn: async () => { throw pending; }, publish: async () => {} }),
  error => error === pending);
assert.equal(releaseCalls, 0, 'observational receipts must not invoke or replace resource settlement');
const publication = Object.freeze(new Error('original receipt publication failure'));
const contains = (error, target, seen = new Set()) => {
  if (error === target) return true;
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error); return contains(error.cause, target, seen) || (error.errors || []).some(child => contains(child, target, seen));
};
await assert.rejects(runQualificationCapsule({ args: [], receiptPath: 'inert' }, {
  spawn: async () => { throw primary; }, publish: async () => { throw publication; }
}), error => contains(error, primary) && contains(error, publication));
const result = { pid: 101, exitCode: 0, signal: null, durationMs: 4, stdout: '{}', stderr: '' };
assert.equal(await runQualificationCapsule({ args: [], receiptPath: 'inert' }, {
  spawn: async () => result, publish: async (_file, body) => { saved = body; }
}), result);
assert.match(saved.state, /consumer-validation-still-required/u);
console.log('Qualification capsules retain original captures/errors and cannot upgrade process exit or reporting into acceptance/cleanup authority.');
