import assert from 'node:assert/strict';
import { createFiniteHeapVersion, writeFiniteHeapVersion, readFiniteHeapCell, joinFiniteHeapVersions,
  admitFiniteHeapVersion, getFiniteHeapOperationDiagnostics } from '../../../src/index/semantic/heap/finite-versions.js';
import { queryFiniteHeapValues } from '../../../src/semantic/heap-values.js';
import { semanticHash } from '../../../src/index/semantic/identity.js';

for (const count of [8, 16, 32]) {
  const initial = createFiniteHeapVersion({ worldId: 'world', regionId: `region-${count}`, contextId: 'context', allocationId: 'allocation',
    cardinality: 'one', closedProperties: true, properties: Array.from({ length: count }, (_, index) => ({
      property: `p${index}`, values: ['v0', 'v1', 'v2', 'v3'], presence: 'knownPresent'
    })) });
  const payload = JSON.parse(JSON.stringify(initial)); delete payload.versionId;
  assert.equal(initial.versionId, semanticHash('pairofcleats.finite-heap-version.v1', payload), 'accepted model content identities remain compatible');
  const branches = Array.from({ length: 4 }, (_, index) => writeFiniteHeapVersion({ version: initial,
    property: 'p0', values: [`branch-${index}`], writeSite: `write-${index}` }));
  const before = getFiniteHeapOperationDiagnostics(), joined = joinFiniteHeapVersions(branches), after = getFiniteHeapOperationDiagnostics();
  assert.equal(after.payloadEncodes - before.payloadEncodes, 1, 'join encodes its new payload once; it never rehashes each predecessor/property pair');
  assert.deepEqual(readFiniteHeapCell({ version: initial, property: 'p0' }).values, ['v0', 'v1', 'v2', 'v3']);
  const expected = ['branch-0', 'branch-1', 'branch-2', 'branch-3', 'v0', 'v1', 'v2', 'v3'];
  let page = queryFiniteHeapValues({ version: joined, property: 'p0', limit: 2 }), actual = [...page.values];
  const firstPage = getFiniteHeapOperationDiagnostics();
  while (page.nextOffset !== null) {
    page = queryFiniteHeapValues({ version: joined, property: 'p0', limit: 2, offset: page.nextOffset }); actual.push(...page.values);
    assert.equal(page.noFlow, false); assert.equal(page.concreteWitness, false); assert.equal(page.responseComplete, false);
  }
  assert.deepEqual(actual, expected);
  const lastPage = getFiniteHeapOperationDiagnostics();
  assert.equal(lastPage.payloadEncodes, firstPage.payloadEncodes, 'owned pages reuse private identity without whole-version serialization');
  assert.equal(lastPage.valueVisits, firstPage.valueVisits, 'later pages do not rematerialize the complete candidate union');
  assert.equal(lastPage.readCacheHits - firstPage.readCacheHits, 3);
  const detached = readFiniteHeapCell({ version: joined, property: 'p0' }); detached.values.push('caller-poison');
  detached.dependencies.wildcardEpochs.push(999);
  assert.deepEqual(readFiniteHeapCell({ version: joined, property: 'p0' }).values, expected);
  assert.deepEqual(readFiniteHeapCell({ version: joined, property: 'p0' }).dependencies.wildcardEpochs, []);

  const transferred = structuredClone(joined), beforeAdmission = getFiniteHeapOperationDiagnostics();
  const owned = admitFiniteHeapVersion(transferred);
  assert.notEqual(owned, transferred); assert.equal(owned.versionId, joined.versionId);
  assert.equal(getFiniteHeapOperationDiagnostics().externalAdmissions - beforeAdmission.externalAdmissions, 1);
  const encodedAtAdmission = getFiniteHeapOperationDiagnostics().payloadEncodes;
  for (let offset = 0; offset < expected.length; offset++) {
    assert.deepEqual(queryFiniteHeapValues({ version: owned, property: 'p0', offset, limit: 1 }).values, [expected[offset]]);
  }
  assert.equal(getFiniteHeapOperationDiagnostics().payloadEncodes, encodedAtAdmission);
  transferred.cells.find(cell => cell.property === 'p0').values[0] = 'tampered';
  assert.deepEqual(readFiniteHeapCell({ version: owned, property: 'p0' }).values, expected);
  assert.throws(() => readFiniteHeapCell({ version: transferred, property: 'p0' }), /identity mismatch/u);
  const unbranded = structuredClone(joined); Object.freeze(unbranded);
  readFiniteHeapCell({ version: unbranded, property: 'p0' });
  unbranded.cells[0].values[0] = 'changed after a prior read';
  assert.throws(() => readFiniteHeapCell({ version: unbranded, property: 'p0' }), /identity mismatch/u, 'a prior hash or frozen outer object never blesses mutable nested content');
  for (let index = 0; index < 40; index++) queryFiniteHeapValues({ version: joined, property: `missing-${index}`, limit: 1 });
  const bounded = getFiniteHeapOperationDiagnostics();
  assert.ok(bounded.readCacheEntries <= 32); assert.ok(bounded.readCacheBytes <= 8 * 1024 * 1024);
}
console.log('Finite heap owned versions reuse identity and bounded read projections across pages/joins while transferred mutable payloads retain tamper checks.');
