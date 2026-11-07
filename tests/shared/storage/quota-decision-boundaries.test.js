import assert from 'node:assert/strict';
import { decideStorageLifecycle, planStorageQuota } from '../../../src/shared/storage/policy.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('shared/storage/quota-decision-boundaries/')[1];
assert.ok(['invalid-clock-and-age', 'epoch-and-stable-alias-order', 'explained-retention-and-link-blockers',
  'conflicting-and-unknown-allocation', 'volume-scoped-free-space-reserve'].includes(mode));
const item = (identity, usedAt = 0, patch = {}) => ({ complete: true, ownerQualified: true, retention: 'derived',
  physicalIdentity: identity, allocatedBytes: 20, allocationScopeId: 'volume:C', allLinksAccounted: true,
  lease: { complete: true, protected: false }, references: { complete: true, retained: false },
  lastUse: { timestamp: new Date(usedAt).toISOString(), provenance: 'original-producer-touch' }, ...patch });
const plan = (items, options = {}) => planStorageQuota({ items, inventoryComplete: true, now: 10000, hardBytes: 0, ...options });
if (mode === 'invalid-clock-and-age') {
  for (const value of [NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => decideStorageLifecycle(item('a'), { now: value }));
    assert.throws(() => decideStorageLifecycle(item('a'), { now: 10000, maxAgeMs: value }));
    assert.throws(() => plan([item('a')], { now: value }));
    assert.throws(() => plan([item('a')], { maxAgeMs: value }));
  }
  assert.equal(decideStorageLifecycle(item('a'), { now: 10000, maxAgeMs: 5000 }).eligible, true);
  assert.equal(decideStorageLifecycle(item('a', 9500), { now: 10000, maxAgeMs: 5000 }).eligible, false);
  assert.equal(decideStorageLifecycle(item('a', 0, { lastUse: { timestamp: 0, provenance: 'touch' } }), { now: 10000, maxAgeMs: 5000 }).eligible, false);
  assert.equal(decideStorageLifecycle(item('a', 0, { lastUse: { timestamp: new Date(0).toISOString(), provenance: {} } }), { now: 10000, maxAgeMs: 5000 }).eligible, false);
} else if (mode === 'epoch-and-stable-alias-order') {
  const early = item('volume:epoch', 0), later = item('volume:later', 1000);
  assert.deepEqual(plan([early, later], { hardBytes: 20 }).selected, ['volume:epoch'], 'the Unix epoch is a valid oldest touch');
  const ordered = plan([item('volume:a', 1), item('volume:Z', 1)], { hardBytes: 20 });
  assert.deepEqual(ordered.selected, ['volume:Z'], 'equal-age plans use code-unit identity order');
  assert.deepEqual(plan([item('volume:Z', 1), item('volume:a', 1)], { hardBytes: 20 }).selected, ordered.selected);
  const alias = plan([early, { ...early, lastUse: later.lastUse }, item('volume:middle', 500)], { hardBytes: 20 });
  assert.deepEqual(alias.selected, ['volume:middle'], 'the most recent actual alias touch protects its physical owner from earlier eviction');
  const retainedByAge = plan([early, item('warm', 9500)], { maxAgeMs: 5000 });
  assert.deepEqual(retainedByAge.selected, ['volume:epoch']);
  assert.ok(retainedByAge.blocked.find(row => row.physicalIdentity === 'warm').reasons.includes('within-retention-age'));
} else if (mode === 'explained-retention-and-link-blockers') {
  const protectedItem = item('shared', 0), linked = item('outside-link', 1000, { allLinksAccounted: false }), newest = item('newest', 2000);
  const result = plan([protectedItem, { ...protectedItem, retention: 'evidence' }, linked, newest], { retainCount: 1 });
  assert.equal(result.measuredUniqueAllocatedBytes, 60); assert.equal(result.plannedReclaimBytes, 0); assert.deepEqual(result.selected, []);
  assert.equal(result.admission, 'deny-space-needed'); assert.equal(result.quotaSatisfied, false);
  const reasons = new Map(result.blocked.map(row => [row.physicalIdentity, row.reasons]));
  assert.ok(reasons.get('shared').includes('saved-or-referenced-evidence'));
  assert.ok(reasons.get('outside-link').includes('unaccounted-file-links')); assert.ok(reasons.get('newest').includes('retained-by-count-policy'));
} else if (mode === 'conflicting-and-unknown-allocation') {
  const original = item('same'), conflict = plan([original, { ...original, allocatedBytes: 21 }]);
  assert.equal(conflict.accountingComplete, false); assert.equal(conflict.measuredUniqueAllocatedBytes, null); assert.deepEqual(conflict.selected, []);
  assert.ok(conflict.blocked[0].reasons.includes('conflicting-allocation-evidence'));
  const unknown = plan([original, item('unknown', 1, { allocatedBytes: null })]);
  assert.equal(unknown.accountingComplete, false); assert.equal(unknown.measuredUniqueAllocatedBytes, 20); assert.deepEqual(unknown.selected, []);
  assert.deepEqual(unknown.unknownItems, [{ index: 1, reason: 'unknown-physical-identity-or-allocated-bytes' }]);
  const invalidId = plan([item({ unsafe: true })]); assert.equal(invalidId.accountingComplete, false);
  assert.throws(() => planStorageQuota({ items: new Array(100001) }));
} else {
  const otherDrive = item('D:oldest', 0, { allocatedBytes: 100, allocationScopeId: 'volume:D' });
  const requiredDrive = item('C:newer', 1000, { allocatedBytes: 100 });
  const options = { hardBytes: 100, minimumFreeBytes: 100, freeBytes: 0, freeSpaceScopeId: 'volume:C' };
  const result = plan([otherDrive, requiredDrive], options);
  assert.deepEqual(result.selected, ['C:newer'], 'same-volume reserve work satisfies the global quota without an unrelated eviction');
  assert.equal(result.plannedReclaimBytes, 100); assert.equal(result.plannedReserveReclaimBytes, 100);
  assert.equal(result.quotaSatisfied, true); assert.equal(result.admission, 'defer-reviewed-cleanup-required');
  const wrongVolume = plan([otherDrive], { ...options, hardBytes: 0 });
  assert.equal(wrongVolume.plannedReserveReclaimBytes, 0); assert.equal(wrongVolume.quotaSatisfied, false); assert.equal(wrongVolume.admission, 'deny-space-needed');
  assert.deepEqual(wrongVolume.reserveBlocked, [{ physicalIdentity: 'D:oldest', reason: 'different-free-space-scope' }]);
  const noScope = plan([requiredDrive], { minimumFreeBytes: 100, freeBytes: 0 });
  assert.equal(noScope.admission, 'defer-accounting-required'); assert.deepEqual(noScope.selected, []);
  assert.equal(noScope.reserveObservation, 'unknown-free-space-or-allocation-scope');
  const unlocated = plan([item('unlocated', 0, { allocationScopeId: null })], options);
  assert.equal(unlocated.admission, 'defer-accounting-required'); assert.equal(unlocated.reserveObservation, 'unqualified-object-allocation-scope');
  const zero = plan([], { hardBytes: 0, minimumFreeBytes: 0 }); assert.equal(zero.admission, 'admit', 'zero reserve requires no fabricated free-space probe');
  const contradictory = plan([requiredDrive, { ...requiredDrive, allocationScopeId: 'volume:D' }], options);
  assert.equal(contradictory.accountingComplete, false); assert.deepEqual(contradictory.selected, []);
  assert.ok(contradictory.blocked[0].reasons.includes('conflicting-allocation-scope'));
}
console.log('Quota planning preserves exact age, alias accounting, explained blockers and same-volume reserve debt.');
