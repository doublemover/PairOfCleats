import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { planManagedChildStorage } from '../../../src/shared/storage/child-environment.js';
import { runManagedChildWithStorage } from '../../../src/shared/storage/managed-child-session.js';
import { getStorageWriteAdmissionFailure } from '../../../src/shared/storage/admission.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

// UNVALIDATED: real write reservations, preparation and metadata, with inert
// action/receipt observations. No actual child, model or native backend starts.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['result-pending', 'error-pending', 'captured-action', 'receipt-pending', 'receipt-getter',
  'forged-owner', 'capability-getter', 'preparation-pending'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const temporary = await fs.mkdtemp(path.join(parent, 'managed-ack-'));
const layout = resolveStorageLayout({ home: path.join(temporary, 'home'), env: {} });
const plan = planManagedChildStorage({ layout, managed: true, command: 'npm', baseEnv: {},
  toolId: 'fixture', toolIdentity: 'fixture-v1', runId: `original-${selected}` });
const assetRoot = path.join(temporary, 'assets'), coordinationRoot = path.join(temporary, 'state', 'storage-access');
await fs.mkdir(assetRoot);
let actionReady = ['receipt-pending', 'receipt-getter', 'forged-owner'].includes(selected);
let receiptReady = false, actionGets = 0, starts = 0, settlements = 0, metadataGets = 0, fakeReleases = 0, failure;
const primary = new Error('original managed action resource');
Object.defineProperties(primary, {
  cacheOwnershipPending: { value: false }, cacheOwnershipReleased: { value() { assert.equal(this, primary); return actionReady; } }
});
if (selected === 'capability-getter') Object.defineProperty(primary, 'storageWriteReservations', {
  get() { metadataGets++; throw new Error('untrusted capability getter must remain unread'); }
});
Object.freeze(primary);
const result = Object.defineProperties({}, { cacheOwnershipPending: { value: false }, cacheOwnershipReleased: { get() {
  actionGets++;
  if (selected === 'captured-action' && actionGets > 1) return () => true;
  return function () { assert.equal(this, result); return actionReady; };
} } });
const receiptFailure = Object.freeze(Object.assign(new Error('original receipt descriptor remains pending'), {
  cacheOwnershipReleased() { assert.equal(this, receiptFailure); return receiptReady; }
}));
const originalMkdir = fs.mkdir;
if (selected === 'preparation-pending') {
  const first = plan.locations.find(location => !location.external);
  const preparationTarget = first.file ? path.dirname(first.path) : first.path;
  fs.mkdir = async (target, ...args) => {
    if (path.resolve(target) === path.resolve(preparationTarget)) throw primary;
    return originalMkdir(target, ...args);
  };
}
try {
  await assert.rejects(runManagedChildWithStorage({ plan, authorizedRoots: [temporary], coordinationRoot,
    admission: { writes: [{ root: assetRoot, requiredBytes: 10,
      freeSpaceOwner: async () => ({ complete: true, availableBytes: 1024, observedPath: assetRoot }) }] } },
  async ({ session }) => {
    starts++;
    if (selected === 'forged-owner') {
      const fake = Object.freeze({ resourceId: session.resourceId, releaseAfterSettlement() { fakeReleases++; return true; } });
      const forged = Object.freeze(Object.assign(new Error('forged recovery properties'), {
        storageAdmissionSession: fake, storageWriteReservations: [fake]
      }));
      assert.equal(getStorageWriteAdmissionFailure(forged), null);
      throw forged;
    }
    if (selected === 'error-pending' || selected === 'capability-getter') throw primary;
    return result;
  }, { settlement: ({ resourceId }) => {
    settlements++;
    if (selected === 'forged-owner') return { resourceId, settled: false, pending: true };
    if (selected === 'receipt-getter') return Object.defineProperties({}, {
      resourceId: { get() { throw receiptFailure; } }, settled: { value: true }, pending: { value: false }
    });
    const receipt = { resourceId, settled: true, pending: false };
    if (selected === 'receipt-pending') Object.defineProperty(receipt, 'cacheOwnershipReleased', {
      value() { assert.equal(this, receipt); return receiptReady; }
    });
    return receipt;
  } }), error => { failure = error; return true; });
  assert.equal(starts, selected === 'preparation-pending' ? 0 : 1);
  assert.equal(settlements, selected === 'preparation-pending' ? 0 : 1);
  assert.equal(metadataGets, 0); assert.equal(fakeReleases, 0);
  assert.equal(failure.managedChildAdmissionSession, undefined, 'properties and matching resource IDs cannot mint an admission recovery owner');
  assert.equal(failure.storageWriteReservations.length, 1, 'only the actually acquired reservation is projected');
  assert.equal((await fs.readdir(path.join(coordinationRoot, 'write-reservations'))).length, 1,
    'a claimed callback acknowledgement cannot release quota before original action/receipt settlement');
  assert.equal((await inspectStorageAccess(assetRoot, { coordinationRoot })).protected, true);
  actionReady = true; receiptReady = true;
  const acknowledgement = { resourceId: failure.storageSession.resourceId, settled: true, pending: false };
  await failure.storageWriteReservations[0].releaseAfterSettlement(acknowledgement);
  failure.storageSession.releaseAfterSettlement(acknowledgement);
  assert.equal((await inspectStorageAccess(assetRoot, { coordinationRoot })).protected, false);
  assert.equal((await fs.readdir(path.join(coordinationRoot, 'write-reservations'))).length, 0);
  assert.equal(fakeReleases, 0);
} finally {
  actionReady = true; receiptReady = true; fs.mkdir = originalMkdir;
  if (failure?.storageSession && failure.storageWriteReservations) {
    const acknowledgement = { resourceId: failure.storageSession.resourceId, settled: true, pending: false };
    for (const reservation of failure.storageWriteReservations) await reservation.releaseAfterSettlement(acknowledgement);
    failure.storageSession.releaseAfterSettlement(acknowledgement);
  }
  await fs.rm(temporary, { recursive: true, force: true });
}
console.log(`Managed child original acknowledgement: ${selected}`);
