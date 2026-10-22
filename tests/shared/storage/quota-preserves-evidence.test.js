import assert from 'node:assert/strict';
import { decideStorageLifecycle, planStorageQuota } from '../../../src/shared/storage/policy.js';

const eligible = { complete: true, ownerQualified: true, retention: 'derived', allocatedBytes: 20,
  physicalIdentity: 'device:1', allLinksAccounted: true,
  lease: { complete: true, protected: false }, references: { complete: true, retained: false } };
assert.equal(decideStorageLifecycle(eligible).eligible, true);
for (const patch of [{ retention: 'evidence' }, { pinned: true }, { forensic: true },
  { references: { complete: false, retained: false } }, { lease: { complete: false, protected: false } },
  { external: true }, { ownerQualified: false }, { retention: 'downloadable' }]) {
  assert.equal(decideStorageLifecycle({ ...eligible, ...patch }).eligible, false);
}
const evidence = { ...eligible, physicalIdentity: 'device:2', allocatedBytes: 40, retention: 'evidence' };
const plan = planStorageQuota({ items: [eligible, { ...eligible }, evidence], inventoryComplete: true, softBytes: 0, hardBytes: 10 });
assert.equal(plan.measuredUniqueAllocatedBytes, 60, 'aliases do not double allocated bytes');
assert.equal(plan.plannedReclaimBytes, 20);
assert.equal(plan.quotaSatisfied, false);
assert.equal(plan.admission, 'deny-space-needed', 'unsatisfiable quotas retain evidence');
const unknown = planStorageQuota({ items: [{ ...eligible, allocatedBytes: null }], hardBytes: 0 });
assert.equal(unknown.accountingComplete, false);
assert.equal(unknown.admission, 'defer-accounting-required');
const sharedEvidenceAlias = planStorageQuota({ items: [eligible, { ...eligible, retention: 'evidence' }], inventoryComplete: true, softBytes: 0 });
assert.equal(sharedEvidenceAlias.selected.length, 0, 'protected aliases block physical eviction');
assert.equal(decideStorageLifecycle(eligible, { maxAgeMs: 1 }).eligible, false, 'unknown last-use provenance cannot satisfy TTL');
assert.equal(planStorageQuota({ items: [], hardBytes: 0 }).admission, 'defer-accounting-required', 'an empty unqualified inventory is not proof of zero usage');
console.log('storage quota preserves evidence passed');
