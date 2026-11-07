import assert from 'node:assert/strict';
import { verifyRetainedManagedInstallation } from '../../../tools/tooling/managed-verification.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/managed-recovery-receipt-observation/')[1];
assert.ok(['original-before-fields', 'between-fields', 'field-inspection', 'shape-inspection', 'closed-positive-and-invalid'].includes(mode));
const resourceId = 'explicit-recovery-receipt-model', exact = () => ({ resourceId, settled: true, pending: false });
let releases = 0, ready = mode === 'between-fields', reads = 0, laterReads = 0;
const original = Object.freeze(new Error('original verifier did not provide its receipt'));
let failure;
try { await verifyRetainedManagedInstallation({ release() { releases++; return true; } }, async () => { throw original; }, {}, resourceId); }
catch (error) { failure = error; }
assert.equal(errorGraphIncludes(failure, original), true); assert.equal(releases, 0);
const session = failure.managedInstallSession; assert.ok(session);
const inspection = Object.freeze(Object.defineProperties(new Error('original receipt inspection owns independent work'), {
  cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: () => ready }
}));
const receipt = { settled: true, pending: false };
if (mode === 'closed-positive-and-invalid') {
  for (const invalid of [null, { ...exact(), resourceId: 'other' }, { ...exact(), pending: true }, { ...exact(), extra: true }]) {
    assert.throws(() => session.releaseAfterSettlement(invalid)); assert.equal(releases, 0);
  }
} else {
  let input;
  if (mode === 'shape-inspection') {
    input = new Proxy(exact(), { ownKeys() { reads++; throw inspection; } });
  } else {
    Object.defineProperty(receipt, 'resourceId', { enumerable: true, get() {
      reads++;
      if (mode === 'field-inspection') throw inspection;
      ready = mode !== 'between-fields'; return resourceId;
    } });
    if (mode === 'original-before-fields' || mode === 'between-fields') Object.defineProperties(receipt, {
      cacheOwnershipPending: { value: false }, cacheOwnershipReleased: { value() { assert.equal(this, receipt); return ready; } }
    });
    if (mode === 'between-fields') Object.defineProperty(receipt, 'settled', { enumerable: true, get() { laterReads++; ready = true; return true; } });
    input = Object.freeze(receipt);
  }
  let rejected;
  try { session.releaseAfterSettlement(input); } catch (error) { rejected = error; }
  assert.ok(rejected); assert.equal(releases, 0); assert.equal(laterReads, 0);
  assert.equal(reads, mode === 'original-before-fields' ? 0 : 1);
  if (mode.endsWith('inspection')) assert.equal(errorGraphIncludes(rejected, inspection), true);
  assert.throws(() => session.releaseAfterSettlement(exact()), 'fresh receipt fields cannot replace the original pending observation');
  assert.equal(releases, 0);
}
ready = true;
assert.equal(session.releaseAfterSettlement(exact()), true); assert.equal(releases, 1);
assert.equal(session.releaseAfterSettlement(exact()), true); assert.equal(releases, 1, 'actual original release remains idempotent');
assert.equal(failure.cacheOwnershipReleased(), true);
console.log('Original recovery receipt observations guard the retained verification owner before release.');
