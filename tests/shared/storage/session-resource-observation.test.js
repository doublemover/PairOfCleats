import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireStorageSession, runWithStorageSession } from '../../../src/shared/storage/session.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { isPathWithinRoot } from '../../../src/shared/file-paths.js';

// UNVALIDATED: actual disposable metadata leases with inert resource controls.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['success-result', 'success-capture', 'receipt-pending', 'receipt-getter', 'receipt-mutation',
  'observer-error', 'mutable-primary', 'frozen-primary', 'callable-primary', 'falsey-primary', 'direct-receipt',
  'receipt-field-interval', 'direct-field-interval'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const temporary = await fs.mkdtemp(path.join(parent, 'session-observation-'));
const marker = randomUUID(); await fs.writeFile(path.join(temporary, '.owned-test-fixture'), marker);
const root = path.join(temporary, 'assets'), coordinationRoot = path.join(temporary, 'state', 'access');
const input = { roots: [root], coordinationRoot, authorizedRoots: [temporary] };
let firstReady = false, secondReady = false, held;
let fieldReads = 0, laterReads = 0;
const primary = selected === 'callable-primary' ? function originalThrownOwner() { assert.fail('a thrown resource is not a diagnostic coercion'); }
  : new Error('original action resource');
Object.assign(primary, { cacheOwnershipPending: false, cacheOwnershipReleased() {
  assert.equal(this, primary); if (selected === 'observer-error' && !firstReady) throw secondary; return firstReady;
} });
const secondary = Object.freeze(Object.assign(new Error('independent receipt or observer owner'), {
  cacheOwnershipReleased() { assert.equal(this, secondary); return secondReady; }
}));
if (selected === 'frozen-primary') Object.freeze(primary);
const rejected = async action => { try { await action(); } catch (error) { return error; } assert.fail('original resources must prevent metadata release'); };
const releasedReceipt = resourceId => ({ resourceId, settled: true, pending: false });
const intervalReceipt = resourceId => {
  secondReady = true;
  const receipt = Object.defineProperties({}, {
    cacheOwnershipReleased: { value() { assert.equal(this, receipt); return secondReady; } },
    resourceId: { get() { fieldReads++; secondReady = false; return resourceId; } },
    settled: { get() { laterReads++; secondReady = true; return true; } }, pending: { value: false }
  });
  return receipt;
};
const protectedRoot = async expected => assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, expected);
try {
  if (selected === 'falsey-primary') {
    for (const value of [null, undefined, false, 0, '']) {
      const error = await rejected(() => runWithStorageSession(input, async () => { throw value; }, {
        settlement: ({ resourceId }) => releasedReceipt(resourceId)
      }));
      assert.equal(Object.hasOwn(error, 'cause'), true); assert.equal(error.cause, value);
      await protectedRoot(false);
    }
  } else if (selected === 'direct-receipt' || selected === 'direct-field-interval') {
    held = acquireStorageSession(input);
    const receipt = selected === 'direct-field-interval' ? intervalReceipt(held.resourceId) : Object.assign(releasedReceipt(held.resourceId), {
      cacheOwnershipReleased() { assert.equal(this, receipt); return secondReady; }
    });
    assert.throws(() => held.releaseAfterSettlement(receipt)); await protectedRoot(true);
    if (selected === 'direct-field-interval') { assert.equal(fieldReads, 1); assert.equal(laterReads, 0); }
    secondReady = true; held.releaseAfterSettlement(selected === 'direct-field-interval' ? releasedReceipt(held.resourceId) : receipt);
    await protectedRoot(false); held = null;
  } else {
    let actionReturned = false, settlements = 0;
    const success = selected.startsWith('success') || selected.startsWith('receipt');
    const error = await rejected(() => runWithStorageSession(input, async () => {
      if (success) { actionReturned = true; return selected.startsWith('success') ? primary : 'complete'; }
      throw primary;
    }, { settlement: ({ resourceId, value, error: original }) => {
      settlements++; assert.equal(original, success ? null : primary);
      if (selected === 'success-capture') primary.cacheOwnershipReleased = () => true;
      if (selected === 'receipt-field-interval') return intervalReceipt(resourceId);
      const receipt = releasedReceipt(resourceId);
      if (selected === 'receipt-pending') Object.assign(receipt, {
        cacheOwnershipReleased() { assert.equal(this, receipt); return secondReady; }
      });
      if (selected === 'receipt-getter') Object.defineProperty(receipt, 'pending', { get() { throw secondary; } });
      if (selected === 'receipt-mutation') {
        firstReady = true;
        let reads = 0;
        Object.defineProperty(receipt, 'resourceId', { get() { assert.equal(++reads, 1, 'receipt fields are captured once'); return resourceId; } });
        Object.defineProperty(receipt, 'pending', { get() { firstReady = false; return false; } });
        // A successful action result remains guarded through receipt projection.
        Object.defineProperty(receipt, 'cacheOwnershipReleased', { value: () => firstReady });
      }
      if (selected === 'mutable-primary') assert.equal(value, undefined);
      return receipt;
    } }));
    held = error.storageSession; assert.ok(held); assert.equal(settlements, 1);
    if (selected === 'receipt-field-interval') { assert.equal(fieldReads, 1); assert.equal(laterReads, 0); }
    assert.equal(actionReturned, success); await protectedRoot(true);
    assert.equal(error.cacheOwnershipReleased(), false);
    if (['mutable-primary', 'callable-primary'].includes(selected)) assert.equal(error, primary);
    if (selected === 'frozen-primary') { assert.equal(error.cause, primary); assert.equal(error.errors[0], primary); }
    if (selected === 'success-capture') assert.equal(error.cacheOwnershipReleased(), false, 'public replacement cannot change captured original observer');
    firstReady = true;
    if (selected === 'observer-error' || selected === 'receipt-getter' || selected === 'receipt-pending' || selected === 'receipt-field-interval') {
      assert.equal(error.cacheOwnershipReleased(), false, 'a ready primary cannot erase independently pending work');
      secondReady = true;
    }
    assert.equal(error.cacheOwnershipReleased(), true);
    await protectedRoot(true, 'resource observation is not metadata-release authority');
    held.releaseAfterSettlement(releasedReceipt(held.resourceId)); held = null; await protectedRoot(false);
  }
} finally {
  firstReady = true; secondReady = true;
  held?.releaseAfterSettlement(releasedReceipt(held.resourceId));
  const physicalParent = await fs.realpath(parent), physicalRoot = await fs.realpath(temporary);
  assert.ok(isPathWithinRoot(physicalRoot, physicalParent) && physicalRoot !== physicalParent);
  assert.equal(await fs.readFile(path.join(physicalRoot, '.owned-test-fixture'), 'utf8'), marker);
  await fs.rm(physicalRoot, { recursive: true, force: true });
}
console.log(`Storage session original action/receipt observation: ${selected}`);
