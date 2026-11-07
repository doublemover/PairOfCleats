import assert from 'node:assert/strict';
import { verifyOwnedResource, verifyOwnedInstallation, captureManagedVerificationFailure } from '../../../tools/tooling/managed-verification.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/managed-verifier-original-observation/')[1];
assert.ok(['result-before-settlement', 'failure-before-settlement', 'nested-original-receipt', 'enclosing-between-fields',
  'ok-revokes-original', 'inspection-retains-independent-work', 'function-failure-original', 'closed-shape-and-control', 'callback-inspection-original'].includes(mode));
const resourceId = 'explicit-managed-verifier-model';
const exact = () => ({ resourceId, settled: true, pending: false });
let ready = mode === 'enclosing-between-fields' || mode === 'ok-revokes-original' || mode === 'inspection-retains-independent-work', reads = 0, laterReads = 0;
const observe = value => Object.defineProperties(value, { cacheOwnershipPending: { value: false },
  cacheOwnershipReleased: { value: function () { assert.equal(this, value); return ready; } } });
const caught = async operation => {
  let failed = false, error;
  try { await operation(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true, 'original unconfirmed work cannot become successful verifier admission'); return error;
};
// Finite original-observation models use the actual verifier. They establish no
// vendor, native descriptor or physical child-close qualification.
if (mode === 'closed-shape-and-control') {
  for (const invalid of [undefined, null, '', 'x'.repeat(257)]) await assert.rejects(
    verifyOwnedResource(async () => { assert.fail('invalid identity cannot start verification'); }, {}, invalid), TypeError);
  const good = { ok: true, settlement: exact(), level: 'explicit-closed-model' };
  assert.equal(await verifyOwnedInstallation(async () => good, {}, resourceId), good);
  const original = Object.assign(new Error('settled original failure'), { settlement: exact() });
  assert.equal(await caught(() => verifyOwnedResource(async () => { throw original; }, {}, resourceId)), original);
  for (const settlement of [null, { ...exact(), resourceId: 'other' }, { ...exact(), pending: true }, { ...exact(), future: true }]) {
    const error = await caught(() => verifyOwnedInstallation(async () => ({ ok: true, settlement }), {}, resourceId));
    assert.equal(captureManagedVerificationFailure(error, resourceId).owned, true);
  }
} else {
  let original, callback, independent;
  if (mode === 'callback-inspection-original') {
    let allowed = false, released = false;
    independent = { error: Object.freeze(Object.defineProperties(new Error('original callback inspection'), {
      cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: () => released }
    })), release() { allowed = true; released = true; } };
    original = { ok: true };
    Object.defineProperties(original, { cacheOwnershipPending: { value: false },
      cacheOwnershipReleased: { value: () => { if (!allowed) throw independent.error; return ready; } },
      settlement: { get() { reads++; ready = true; return exact(); } } });
    Object.freeze(original); callback = async () => original;
  } else if (mode === 'function-failure-original') {
    original = observe(function originalVerifierFailure() {});
    Object.defineProperty(original, 'settlement', { get() { reads++; ready = true; return exact(); } });
    Object.freeze(original); callback = async () => { throw original; };
  } else if (mode === 'failure-before-settlement') {
    original = observe(new Error('original verifier still owns work'));
    Object.defineProperty(original, 'settlement', { get() { reads++; ready = true; return exact(); } });
    Object.freeze(original); callback = async () => { throw original; };
  } else if (mode === 'nested-original-receipt') {
    const receipt = observe({ settled: true, pending: false });
    Object.defineProperty(receipt, 'resourceId', { enumerable: true, get() { reads++; ready = true; return resourceId; } });
    Object.freeze(receipt); original = Object.freeze({ ok: true, settlement: receipt }); callback = async () => original;
  } else if (mode === 'enclosing-between-fields') {
    const receipt = { pending: false };
    Object.defineProperties(receipt, { resourceId: { enumerable: true, get() { reads++; ready = false; return resourceId; } },
      settled: { enumerable: true, get() { laterReads++; ready = true; return true; } } });
    Object.freeze(receipt); original = Object.freeze(observe({ ok: true, settlement: receipt })); callback = async () => original;
  } else if (mode === 'ok-revokes-original') {
    original = observe({ settlement: exact() });
    Object.defineProperty(original, 'ok', { enumerable: true, get() { reads++; ready = false; return true; } });
    Object.freeze(original); callback = async () => original;
  } else if (mode === 'inspection-retains-independent-work') {
    let released = false;
    independent = { error: Object.freeze(Object.defineProperties(new Error('original independent inspection'), {
      cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: () => released }
    })), release() { released = true; } };
    original = { ok: true };
    Object.defineProperty(original, 'settlement', { get() { reads++; throw independent.error; } });
    Object.freeze(original); callback = async () => original;
  } else {
    original = observe({ ok: true });
    Object.defineProperty(original, 'settlement', { get() { reads++; ready = true; return exact(); } });
    Object.freeze(original); callback = async () => original;
  }
  const failure = await caught(() => verifyOwnedInstallation(callback, {}, resourceId));
  assert.equal(errorGraphIncludes(failure, original), true, 'the exact original result/failure remains in the error graph');
  if (independent) assert.equal(errorGraphIncludes(failure, independent.error), true);
  assert.equal(reads, ['enclosing-between-fields', 'ok-revokes-original', 'inspection-retains-independent-work'].includes(mode) ? 1 : 0);
  assert.equal(laterReads, 0, 'a later receipt field cannot erase an unconfirmed interval');
  const captured = captureManagedVerificationFailure(failure, resourceId); assert.equal(captured.owned, true);
  assert.equal(typeof captured.observe, 'function'); assert.equal(captured.observe(), false);
  ready = true; independent?.release(); assert.equal(captured.observe(), true, 'only the original captured prerequisites can settle');
}
console.log('Managed verifier checks original result and receipt observations before every settlement/capability field.');
