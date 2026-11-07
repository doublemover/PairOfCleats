import assert from 'node:assert/strict';
import { planStorageQuota } from '../../../src/shared/storage/policy.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('shared/storage/coordinated-quota-scopes/')[1];
assert.ok(['overlapping-global-category-repository', 'independent-scopes-and-order', 'scoped-retention-protects-all-aliases',
  'unknown-attribution-and-invalid-policy', 'unsatisfied-protected-and-volume-pressure', 'bounded-membership-accounting'].includes(mode));
const item = (physicalIdentity, usedAt, patch = {}) => ({ physicalIdentity, allocatedBytes: 20, category: 'query', repoId: 'repo-A',
  complete: true, ownerQualified: true, retention: 'derived', allLinksAccounted: true, allocationScopeId: 'C',
  lease: { complete: true, protected: false }, references: { complete: true, retained: false },
  lastUse: { timestamp: new Date(usedAt).toISOString(), provenance: 'original-producer' }, ...patch });
const plan = (items, scopes, patch = {}) => planStorageQuota({ items, scopes, inventoryComplete: true, now: 10000, ...patch });
const scope = (scope, id, patch = {}) => ({ scope, id, ...patch });
const row = (result, kind, id) => result.scopePlans.find(value => value.scope === kind && value.id === id);
// Independent set/accounting audit of each proposal: count each physical owner
// once globally and once in every applicable scope, even with aliases.
const audit = (items, result) => {
  const selected = new Set(result.selected); assert.equal(selected.size, result.selected.length);
  const allocations = new Map(items.map(item => [item.physicalIdentity, item.allocatedBytes]));
  const sum = ids => [...ids].reduce((total, id) => total + allocations.get(id), 0);
  assert.equal(result.measuredUniqueAllocatedBytes, sum(allocations.keys()));
  assert.equal(result.plannedReclaimBytes, sum(selected));
  for (const policy of result.scopePlans) {
    const ids = new Set(items.filter(item => (policy.scope === 'category' ? item.category : item.repoId) === policy.id).map(item => item.physicalIdentity));
    assert.equal(policy.measuredUniqueAllocatedBytes, sum(ids));
    assert.equal(policy.plannedReclaimBytes, sum(new Set([...ids].filter(id => selected.has(id)))));
    assert.equal(policy.remainingBytes, policy.measuredUniqueAllocatedBytes - policy.plannedReclaimBytes);
  }
};
if (mode === 'overlapping-global-category-repository') {
  const shared = item('shared', 1000), aliases = [shared, { ...shared, category: 'embedding', repoId: 'repo-B' }];
  const items = [item('older-unrelated', 0, { category: 'probe', repoId: null }), ...aliases];
  const result = plan(items, [scope('category', 'query', { hardBytes: 0 }), scope('repository', 'repo-B', { hardBytes: 0 })], { hardBytes: 20 });
  assert.deepEqual(result.selected, ['shared'], 'mandatory shared work pays all three debts before unrelated global eviction');
  assert.equal(result.quotaSatisfied, true); assert.equal(result.admission, 'defer-reviewed-cleanup-required');
  assert.equal(row(result, 'category', 'query').plannedReclaimBytes, 20); audit(items, result);
  const noQuota = plan(items, []); assert.equal(noQuota.admission, 'admit'); assert.deepEqual(noQuota.selected, []);
} else if (mode === 'independent-scopes-and-order') {
  const items = [item('old-A', 0), item('old-B', 100, { category: 'embedding', repoId: 'repo-B' }),
    item('new-A', 200), item('new-B', 300, { category: 'embedding', repoId: 'repo-B' })];
  const policies = [scope('category', 'query', { softBytes: 20, hardBytes: 40 }), scope('repository', 'repo-B', { hardBytes: 20 })];
  const result = plan(items, policies, { hardBytes: 40 });
  assert.deepEqual(result.selected, ['old-A', 'old-B']); assert.equal(result.quotaSatisfied, true); audit(items, result);
  const reversed = plan([...items].reverse(), [...policies].reverse(), { hardBytes: 40 });
  assert.deepEqual(reversed, result, 'input and policy declaration order do not change a physical proposal');
} else if (mode === 'scoped-retention-protects-all-aliases') {
  const shared = item('shared', 0), warmAlias = { ...shared, category: 'embedding', lastUse: item('', 9500).lastUse };
  const policies = [scope('category', 'query', { hardBytes: 0, maxAgeMs: 5000 })];
  const aged = plan([shared, warmAlias], policies); assert.deepEqual(aged.selected, []);
  assert.ok(aged.blocked[0].reasons.includes('within-retention-age')); assert.equal(aged.admission, 'deny-space-needed');
  const items = [shared, { ...shared, category: 'embedding' }, item('other', 1000, { category: 'probe', repoId: null })];
  const retained = plan(items, [scope('category', 'query', { retainCount: 1 }), scope('repository', 'repo-A', { hardBytes: 0 })], { hardBytes: 0 });
  assert.deepEqual(retained.selected, ['other']); assert.equal(retained.quotaSatisfied, false);
  assert.deepEqual(retained.blocked[0].retainedScopes, [{ scope: 'category', id: 'query' }]); audit(items, retained);
} else if (mode === 'unknown-attribution-and-invalid-policy') {
  for (const [field, policies] of [['category', [scope('category', 'query', { hardBytes: 0 })]], ['repoId', [scope('repository', 'repo-A', { hardBytes: 0 })]]]) {
    const unknown = item('unknown', 0); delete unknown[field];
    const result = plan([unknown], policies); assert.equal(result.accountingComplete, false); assert.deepEqual(result.selected, []);
    assert.equal(result.admission, 'defer-accounting-required'); assert.ok(result.unknownItems.some(row => row.reason === 'unknown-category-or-repository-attribution'));
  }
  assert.equal(plan([item('shared-external-repo', 0, { repoId: null })], [scope('repository', 'repo-A', { hardBytes: 0 })]).admission, 'admit',
    'an explicit shared owner is distinct from missing attribution');
  const conflicting = plan([item('conflict', 0), item('conflict', 0, { allocatedBytes: 21 })], [scope('category', 'query', { hardBytes: 0 })]);
  assert.deepEqual(conflicting.selected, []); assert.equal(conflicting.scopePlans[0].measuredUniqueAllocatedBytes, null);
  assert.equal(conflicting.admission, 'defer-accounting-required');
  for (const policies of [[scope('category', 'query'), scope('category', 'query')], [scope('unknown', 'query')],
    [scope('category', '')], [scope('category', 'query', { hardBytes: -1 })], [scope('category', 'query', { hardBytes: null })],
    [scope('category', 'query', { hardBytes: 1, softBytes: 2 })], [scope('category', 'query', { typo: 0 })], new Array(1025)]) {
    assert.throws(() => plan([], policies));
  }
} else if (mode === 'unsatisfied-protected-and-volume-pressure') {
  const items = [item('D:unrelated', 0, { category: 'probe', repoId: null, allocationScopeId: 'D' }), item('C:mandatory', 1000),
    item('C:evidence', 2000, { retention: 'evidence' })];
  const policies = [scope('category', 'query', { hardBytes: 20 })];
  const result = plan(items, policies, { hardBytes: 40, minimumFreeBytes: 20, freeBytes: 0, freeSpaceScopeId: 'C' });
  assert.deepEqual(result.selected, ['C:mandatory']); assert.equal(result.plannedReserveReclaimBytes, 20);
  assert.equal(result.quotaSatisfied, true); audit(items, result);
  const blocked = plan(items, [scope('category', 'query', { hardBytes: 0 })]);
  assert.deepEqual(blocked.selected, ['C:mandatory']); assert.equal(blocked.quotaSatisfied, false); assert.equal(blocked.admission, 'deny-space-needed');
  assert.equal(row(blocked, 'category', 'query').remainingBytes, 20); assert.ok(blocked.blocked.some(row => row.reasons.includes('saved-or-referenced-evidence')));
  const protectedAlias = plan([items[1], { ...items[1], category: 'models', pinned: true }], policies);
  assert.deepEqual(protectedAlias.selected, []); assert.ok(protectedAlias.blocked[0].reasons.includes('pinned-or-forensic'));
} else {
  const items = Array.from({ length: 8192 }, (_, index) => item('physical:' + index, index, {
    allocatedBytes: 1, category: 'category:' + index % 32, repoId: 'repo:' + index % 32 }));
  const policies = Array.from({ length: 32 }, (_, index) => [scope('category', 'category:' + index, { hardBytes: 128, retainCount: 16 }),
    scope('repository', 'repo:' + index, { hardBytes: 128 })]).flat();
  const result = plan(items, policies, { hardBytes: 4096 });
  assert.equal(result.selected.length, 4096); assert.equal(result.plannedReclaimBytes, 4096); assert.equal(result.quotaSatisfied, true);
  assert.ok(result.scopePlans.every(row => row.remainingBytes === 128)); audit(items, result);
  const incomplete = plan(items, policies, { hardBytes: 0, inventoryComplete: false });
  assert.deepEqual(incomplete.selected, []); assert.equal(incomplete.admission, 'defer-accounting-required');
}
console.log('One coordinated physical proposal satisfies global and scoped quotas without evicting protected aliases.');
