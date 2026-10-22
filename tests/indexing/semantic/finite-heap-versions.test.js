import assert from 'node:assert/strict';
import { createFiniteHeapVersion, writeFiniteHeapVersion, readFiniteHeapCell, joinFiniteHeapVersions }
  from '../../../src/index/semantic/heap/finite-versions.js';
import { queryFiniteHeapValues } from '../../../src/semantic/heap-values.js';

const initial = createFiniteHeapVersion({ worldId: 'world', regionId: 'region', contextId: 'caller-1', allocationId: 'alloc',
  cardinality: 'one', properties: [{ property: 'key', values: ['old'], presence: 'knownPresent' }] });
const proof = { state: 'one-concrete-live-object', worldId: 'world', regionId: 'region', contextId: 'caller-1', receiptId: 'unique' };
const write = (version, property, values, extra = {}) => writeFiniteHeapVersion({ version, property, values,
  writeSite: 'write', receiverProof: proof, unconditional: true, plainDataProperty: true, noConcurrentWriters: true, ...extra });
const read = (version, property = 'key') => readFiniteHeapCell({ version, property });
const strong = write(initial, 'key', ['new']);
assert.deepEqual(read(strong).values, ['new']);
assert.deepEqual(read(initial).values, ['old'], 'old version must remain immutable');
assert.deepEqual(read(write(initial, 'key', ['new'], { receiverProof: null })).values, ['new', 'old']);
assert.deepEqual(read(write(initial, 'key', ['new'], { unconditional: false })).values, ['new', 'old']);
const repeatedAllocation = createFiniteHeapVersion({ worldId: 'world', regionId: 'region', contextId: 'caller-1', allocationId: 'alloc',
  cardinality: 'many', properties: [{ property: 'key', values: ['old'], presence: 'knownPresent' }] });
assert.equal(write(repeatedAllocation, 'key', ['new']).lastWrite.update, 'weak', 'one abstract allocation is not one concrete object');
const wildcard = write(initial, null, ['unknown-key-value']);
assert.deepEqual(read(wildcard).values, ['old', 'unknown-key-value']);
assert.deepEqual(read(write(wildcard, 'key', ['replacement'])).values, ['replacement'], 'definite overwrite cuts off older wildcard writes for this cell');
assert.deepEqual(read(write(strong, null, ['later'])).values, ['later', 'new']);
assert.equal(read(initial, 'missing').presence, 'unknown');
assert.equal(read(initial, 'missing').unknown, true);
const joined = joinFiniteHeapVersions([initial, strong]);
assert.deepEqual(read(joined).values, ['new', 'old'], 'join retains both branch and zero-iteration alternatives');
const foreign = createFiniteHeapVersion({ worldId: 'world', regionId: 'region', contextId: 'caller-2', allocationId: 'alloc' });
assert.throws(() => joinFiniteHeapVersions([initial, foreign]), /different heap worlds/);
const paged = queryFiniteHeapValues({ version: joined, property: 'key', limit: 1 });
assert.equal(paged.nextOffset, 1); assert.equal(paged.noFlow, false);
assert.equal(paged.concreteWitness, false);
assert.throws(() => read({ ...initial, cardinality: 'many' }), /identity mismatch/);
console.log('finite mutation-version heap contract passed');
