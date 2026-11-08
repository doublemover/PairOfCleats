import assert from 'node:assert/strict';
import { minimizeRevisionSequence, minimizeRevisionSequenceAsync } from '../../../tools/eval/revisions/minimize.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

// Explicit code-owned boundary model. These outcomes exercise asynchronous
// ownership/admission; they are not forged real-index execution receipts.
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/eval/revision-minimizer-async/')[1];
const scenario = Object.freeze({ initial: 'owned-input', revisions: Object.freeze([
  Object.freeze({ id: 'setup' }), Object.freeze({ id: 'target' }), Object.freeze({ id: 'noise' })]) });
const originalReceipt = Object.freeze({ executionId: 'original-boundary-model', outcome: 'fail', targetFailure: true, witness: 'original-witness' });
const active = new Set(), events = [];
let runs = 0;
const owner = { originalScenario: scenario, originalReceipt, selection: { checkpointId: 'target' }, kind: 'async-minimizer-boundary-model', predicate: 'named-model-failure',
  matches: receipt => receipt.outcome === 'fail' && receipt.targetFailure === true,
  seal: (input, revisions) => ({ ...input, revisions }), invalidScenario: () => false,
  async run(candidate) { assert.equal(active.size, 0); const handle = { id: ++runs, candidate }; active.add(handle); events.push('run-' + handle.id); return handle; },
  read(handle) { assert.ok(active.has(handle)); return { executionId: 'trial-' + handle.id, scenarioId: String(handle.id).repeat(64), outcome: 'fail', targetFailure: true, witness: 'witness-' + handle.id }; },
  async dispose(handle) { await Promise.resolve(); assert.equal(active.delete(handle), true); events.push('dispose-' + handle.id); } };
const options = { checkpointId: 'target' };
if (mode === 'await-original-retirement') {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = minimizeRevisionSequenceAsync({ ...owner, async dispose(handle) {
    entered(); await new Promise(resolve => { release = resolve; }); assert.equal(active.delete(handle), true);
  } }, { ...options, maxAttempts: 1 });
  await started; assert.equal(runs, 1); assert.equal(active.size, 1);
  let complete = false; pending.then(() => { complete = true; }); await Promise.resolve(); assert.equal(complete, false);
  release(); const receipt = await pending; assert.equal(receipt.changed, true); assert.equal(active.size, 0);
} else if (mode === 'predicate-and-witness-retention') {
  const receipt = await minimizeRevisionSequenceAsync({ ...owner, captureWitness: value => value.witness }, options);
  assert.equal(receipt.changed, true); assert.equal(receipt.scenario.revisions.length, 1); assert.equal(receipt.scenario.revisions[0].id, 'target');
  assert.equal(receipt.witness, 'witness-2'); assert.deepEqual(events, ['run-1', 'dispose-1', 'run-2', 'dispose-2']);
  assert.ok(Object.isFrozen(receipt.attempts[0])); assert.equal(scenario.revisions.length, 3);
} else if (mode === 'unknown-other-and-invalid') {
  for (const outcome of [{ outcome: 'unknown', targetFailure: true }, { outcome: 'pass', targetFailure: true }, { outcome: 'fail', targetFailure: false }]) {
    const receipt = await minimizeRevisionSequenceAsync({ ...owner, read(handle) { return { ...owner.read(handle), ...outcome }; } }, options);
    assert.equal(receipt.changed, false); assert.ok(receipt.attempts.every(row => !row.accepted)); assert.equal(active.size, 0);
  }
  const invalid = new Error('invalid proposed state');
  const receipt = await minimizeRevisionSequenceAsync({ ...owner, seal() { throw invalid; }, invalidScenario: value => value === invalid }, options);
  assert.ok(receipt.attempts.every(row => row.outcome === 'invalid-precondition')); assert.equal(receipt.changed, false);
} else if (mode === 'read-and-retirement-failures') {
  const original = Object.freeze(new Error('original receipt read failed')); let ready = false;
  const cleanup = Object.freeze({ cacheOwnershipPending: true, cacheOwnershipReleased: () => ready });
  let failure;
  try { await minimizeRevisionSequenceAsync({ ...owner, read() { throw original; }, async dispose(handle) { active.delete(handle); throw cleanup; } }, options); }
  catch (error) { failure = error; }
  assert.ok(failure); assert.equal(errorGraphIncludes(failure, original), true); assert.equal(errorGraphIncludes(failure, cleanup), true);
  assert.equal(failure.cacheOwnershipReleased(), false); ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
  assert.equal(runs, 1, 'no new trial follows an uncertain original retirement');
} else if (mode === 'falsey-read-and-release-only-failures') {
  for (const original of [null, undefined, false, 0, '']) {
    const cleanup = Object.freeze(new Error('independent trial retirement failed'));
    await assert.rejects(minimizeRevisionSequenceAsync({ ...owner, read() { throw original; }, async dispose(handle) { active.delete(handle); throw cleanup; } }, options), error =>
      errorGraphIncludes(error, original) && errorGraphIncludes(error, cleanup));
  }
  const cleanup = Object.freeze(new Error('original retirement failure'));
  await assert.rejects(minimizeRevisionSequenceAsync({ ...owner, async dispose(handle) { active.delete(handle); throw cleanup; } }, options), error => error === cleanup);
} else if (mode === 'cancellation-after-retirement') {
  const controller = new AbortController();
  await assert.rejects(minimizeRevisionSequenceAsync({ ...owner, async dispose(handle) {
    await owner.dispose(handle); controller.abort(null);
  } }, { ...options, signal: controller.signal, maxAttempts: 1 }), error => error.name === 'AbortError' && error.cause === null);
  assert.equal(active.size, 0); assert.equal(runs, 1);
} else if (mode === 'bounds-and-healthy-preflight') {
  for (const budget of [{ maxMs: 1001 }, { maxAttempts: 65 }, { maxMs: 0 }]) await assert.rejects(minimizeRevisionSequenceAsync(owner, { ...options, ...budget }), RangeError);
  await assert.rejects(minimizeRevisionSequenceAsync({ ...owner, originalReceipt: { outcome: 'pass' } }, options), /no matching independent failure/);
  assert.equal(runs, 0);
  const receipt = await minimizeRevisionSequenceAsync({ ...owner, maximumMs: 25000 }, { ...options, maxMs: 25000, maxAttempts: 1 });
  assert.equal(receipt.attempts.length, 1); assert.equal(active.size, 0);
} else if (mode === 'shared-sync-owner-and-failure-graph') {
  const sync = { ...owner, run(candidate) { const handle = { id: ++runs, candidate }; active.add(handle); return handle; }, dispose(handle) { active.delete(handle); } };
  const receipt = minimizeRevisionSequence(sync, options); assert.equal(receipt.changed, true); assert.equal(active.size, 0);
  const original = Object.freeze(new Error('synchronous original read')), cleanup = Object.freeze(new Error('synchronous original retirement'));
  assert.throws(() => minimizeRevisionSequence({ ...sync, read() { throw original; }, dispose(handle) { active.delete(handle); throw cleanup; } }, options), error =>
    errorGraphIncludes(error, original) && errorGraphIncludes(error, cleanup));
} else assert.fail('Select an independently bounded asynchronous minimizer case.');
assert.equal(active.size, 0);
console.log('One revision minimizer awaits original asynchronous retirement and retains independent read/cleanup failures.');
