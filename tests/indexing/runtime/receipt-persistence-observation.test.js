import assert from 'node:assert/strict';
import path from 'node:path';
import { createRuntimeAttempt } from '../../../src/shared/runtime-envelope/receipt.js';
import { persistRuntimeAttempt } from '../../../src/index/build/build-state/runtime.js';

// UNVALIDATED: real receipt producer with inert write-boundary observations.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['confirmed', 'ordinary', 'pending-marker-true', 'pending-marker-false', 'callback-capture',
  'diagnostic-owner', 'frozen-attempt', 'falsey-primary', 'unconfirmed', 'pending-success', 'getter-success', 'captured-attempt'].includes(selected));
const buildRoot = path.resolve('.tmp', 'receipt-observation-no-disk-write');
const make = () => createRuntimeAttempt({ buildId: 'receipt-generation', stage: 'stage2' });
const failed = async work => { try { await work(); } catch (error) { return error; } assert.fail('required persistence must fail'); };
const contains = (value, expected, seen = new Set()) => {
  if (value === expected) return true;
  if (!value || !['object', 'function'].includes(typeof value) || seen.has(value)) return false;
  seen.add(value);
  return contains(value.cause, expected, seen) || (Array.isArray(value.errors) && value.errors.some(error => contains(error, expected, seen)));
};
if (selected === 'confirmed') {
  const attempt = await make(); let writes = 0;
  const result = await persistRuntimeAttempt(buildRoot, attempt, { lifecycle: 'running' }, { write: async (_root, patch) => {
    writes++; assert.equal(patch.runtime.attempts[0].attemptId, attempt.attemptId); return patch;
  } });
  assert.equal(result.lifecycle, 'running'); assert.equal(attempt.persistence.status, 'durable'); assert.equal(writes, 1);
} else if (selected === 'ordinary' || selected === 'frozen-attempt' || selected === 'captured-attempt') {
  let attempt = await make(); const originalId = attempt.attemptId;
  if (selected === 'frozen-attempt') attempt = Object.freeze(attempt);
  const primary = Object.freeze(Object.assign(new Error('actual write rejected'), { code: 'EIO' })); let writes = 0;
  const error = await failed(() => persistRuntimeAttempt(buildRoot, attempt, {}, { write: async () => {
    writes++; if (selected === 'captured-attempt') attempt.attemptId = 'changed-after-admission'; throw primary;
  } }));
  assert.equal(error.code, 'ERR_RUNTIME_RECEIPT_PERSIST'); assert.equal(error.cause, primary);
  assert.equal(error.attemptId, originalId); assert.equal(error.cacheOwnershipReleased(), true); assert.equal(writes, 1);
  assert.equal(Object.getOwnPropertyDescriptor(error, 'storageFailureObservation').enumerable, false);
  if (selected !== 'frozen-attempt') assert.deepEqual(attempt.persistence, { status: 'degraded', lastErrorCode: 'EIO' });
  else {
    assert.equal(attempt.persistence.status, 'pending');
    assert.equal(error.storageFailureObservation.errors.some(value => value instanceof TypeError), true,
      'failed degraded-state projection retains its own diagnostic cause');
  }
} else if (['pending-marker-true', 'pending-marker-false', 'callback-capture'].includes(selected)) {
  const attempt = await make(); let settled = false, reads = 0, writes = 0;
  const primary = Object.defineProperties(new Error('original write owns outstanding work'), {
    cacheOwnershipPending: { value: selected !== 'pending-marker-false', writable: true },
    cacheOwnershipReleased: { value() { assert.equal(this, primary); return settled; }, writable: true },
    code: { get() { reads++; return 'EIO'; } }
  });
  const error = await failed(() => persistRuntimeAttempt(buildRoot, attempt, {}, { write: async () => { writes++; throw primary; } }));
  assert.equal(error.code, 'ERR_RUNTIME_RECEIPT_PERSIST'); assert.equal(error.cause, primary);
  assert.equal(error.cacheOwnershipReleased(), false); assert.equal(reads, 0, 'unconfirmed original work precedes diagnostic inspection');
  assert.equal(attempt.persistence.status, 'degraded');
  if (selected === 'callback-capture') {
    primary.cacheOwnershipPending = false; primary.cacheOwnershipReleased = () => true;
    assert.equal(error.cacheOwnershipReleased(), false, 'replacement diagnostics cannot replace the original callback');
  }
  settled = true; assert.equal(error.cacheOwnershipReleased(), true); assert.equal(writes, 1); assert.equal(reads, 0);
  assert.equal(Object.getOwnPropertyDescriptor(error, 'cacheOwnershipReleased').writable, false);
  assert.equal(Object.getOwnPropertyDescriptor(error, 'cacheOwnershipReleased').configurable, false);
} else if (selected === 'diagnostic-owner' || selected === 'getter-success') {
  const attempt = await make(); let settled = false, writes = 0, reads = 0;
  const secondary = Object.freeze(Object.assign(new Error('independent diagnostic remains pending'), {
    cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, secondary); return settled; }
  }));
  const original = Object.freeze(Object.defineProperty(new Error('original write error'), 'causeCode', { get() { reads++; throw secondary; } }));
  const result = Object.freeze(Object.defineProperty({}, 'runtime', { get() { reads++; throw secondary; } }));
  const error = await failed(() => persistRuntimeAttempt(buildRoot, attempt, {}, { write: async () => {
    writes++; if (selected === 'diagnostic-owner') throw original; return result;
  } }));
  assert.equal(error.code, 'ERR_RUNTIME_RECEIPT_PERSIST');
  if (selected === 'diagnostic-owner') assert.equal(error.cause, original);
  assert.equal(contains(error.storageFailureObservation, secondary), true);
  assert.equal(error.cacheOwnershipReleased(), false); settled = true; assert.equal(error.cacheOwnershipReleased(), true);
  assert.equal(writes, 1); assert.equal(reads, 1);
} else if (selected === 'pending-success') {
  const attempt = await make(); let settled = false, reads = 0, writes = 0;
  const result = Object.freeze(Object.defineProperties({}, {
    cacheOwnershipPending: { value: true },
    cacheOwnershipReleased: { value() { assert.equal(this, result); return settled; } },
    runtime: { get() { reads++; assert.fail('pending successful reply cannot be inspected as durable'); } }
  }));
  const error = await failed(() => persistRuntimeAttempt(buildRoot, attempt, {}, { write: async () => { writes++; return result; } }));
  assert.equal(error.code, 'ERR_RUNTIME_RECEIPT_PERSIST'); assert.equal(attempt.persistence.status, 'degraded');
  assert.equal(error.cacheOwnershipReleased(), false); settled = true; assert.equal(error.cacheOwnershipReleased(), true);
  assert.equal(reads, 0); assert.equal(writes, 1);
} else if (selected === 'falsey-primary') {
  for (const primary of [undefined, null, false, 0, '']) {
    const attempt = await make();
    const error = await failed(() => persistRuntimeAttempt(buildRoot, attempt, {}, { write: async () => { throw primary; } }));
    assert.equal(error.code, 'ERR_RUNTIME_RECEIPT_PERSIST'); assert.equal(error.cause, primary);
    assert.equal(error.cacheOwnershipReleased(), true); assert.equal(attempt.persistence.status, 'degraded');
  }
} else {
  for (const result of [undefined, null, false, {}, { runtime: { schemaVersion: 1, attempts: [] } },
    { runtime: { schemaVersion: 1, attempts: [{ attemptId: 'another-attempt' }] } }]) {
    const attempt = await make(); let writes = 0;
    const error = await failed(() => persistRuntimeAttempt(buildRoot, attempt, {}, { write: async () => { writes++; return result; } }));
    assert.equal(error.code, 'ERR_RUNTIME_RECEIPT_PERSIST'); assert.equal(error.cause.code, 'ERR_RUNTIME_RECEIPT_WRITE_UNCONFIRMED');
    assert.equal(error.cacheOwnershipReleased(), true); assert.equal(attempt.persistence.status, 'degraded'); assert.equal(writes, 1);
  }
}
console.log('runtime receipt persistence observation ' + selected + ' passed');
