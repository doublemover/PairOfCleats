import assert from 'node:assert/strict';
import { createFiniteShapeArena, compareFiniteShapes, projectFiniteShapeFields, finiteShapePreimages }
  from '../../../src/index/semantic/types/finite-shapes.js';
import { createTypeIrArena } from '../../../src/index/tooling/typescript/type-ir/arena.js';
import { queryFiniteStringType, describeFiniteShapeCompatibility } from '../../../src/semantic/type-query.js';

const world = { generation: { baseBuildId: 'build', semanticRevision: 0 }, repositoryNamespace: 'repo',
  contextKey: 'context', providerId: 'explicit-fixture', language: 'finite-shape-fixture' };
const atom = (type, value) => ({ kind: 'atom', type, value });
const record = (tag, value) => ({ kind: 'record', fields: [['tag', atom('string', tag)], ['value', value]] });
const values = [record('A', atom('integer', 1)), record('B', atom('string', 's')),
  record('A', atom('string', 's')), { kind: 'record', fields: [] },
  { kind: 'record', fields: [['value', atom('undefined', null)]] }];
const arena = createFiniteShapeArena({ world, values });
const correlated = arena.select([0, 1]), uncorrelated = arena.select([0, 1, 2]);
assert.equal(compareFiniteShapes({ left: correlated, right: uncorrelated, operation: 'inclusion' }).status, 'proved');
const refuted = compareFiniteShapes({ left: uncorrelated, right: correlated, operation: 'inclusion' });
assert.equal(refuted.status, 'refuted'); assert.equal(refuted.witness.valueIndex, 2);
assert.equal(refuted.witness.inLeft, true); assert.equal(refuted.witness.inRight, false);
const projected = projectFiniteShapeFields({ type: arena.select([3, 4]), labels: ['value'] });
assert.deepEqual(projected.alternatives.map(row => row.fields[0].presence), ['absent', 'present']);
assert.equal(projected.alternatives[1].fields[0].value.type, 'undefined');
assert.equal(describeFiniteShapeCompatibility({ left: correlated, right: uncorrelated, labels: ['tag', 'value'] })
  .leftAlternatives.alternatives.length, 2, 'whole-record alternatives remain correlated');
const both = finiteShapePreimages({ input: arena.select([0]), outputPredicate: arena.select([1]), relation: [[0, 1], [0, 2]], complete: true });
assert.deepEqual(both.positive, [0]); assert.deepEqual(both.negative, [0]);
assert.equal(finiteShapePreimages({ input: arena.select([0]), outputPredicate: arena.select([1]), relation: [[0, 1]], complete: false }).status, 'unknown');
assert.equal(compareFiniteShapes({ left: arena.unknown('opaque-native'), right: correlated, operation: 'inclusion' }).status, 'unknown');
assert.equal(compareFiniteShapes({ left: arena.select([]), right: correlated, operation: 'inclusion', maxWork: 0 }).status, 'unknown');
const controller = new AbortController(); controller.abort();
assert.equal(compareFiniteShapes({ left: correlated, right: correlated, operation: 'equivalence', signal: controller.signal }).status, 'unknown');
const otherArena = createFiniteShapeArena({ world: { ...world, contextKey: 'changed-imports' }, values });
assert.throws(() => compareFiniteShapes({ left: correlated, right: otherArena.select([0, 1]), operation: 'equivalence' }), /same owned/);
assert.throws(() => createFiniteShapeArena({ world, values: [{ kind: 'any' }] }), /unsupported/);

// Independent finite-set oracle across every pair of subsets of the five-value universe.
const indices = mask => values.flatMap((_, index) => mask & 2 ** index ? [index] : []);
for (let leftMask = 0; leftMask < 32; leftMask++) for (let rightMask = 0; rightMask < 32; rightMask++) {
  const leftValues = indices(leftMask), rightValues = new Set(indices(rightMask));
  const left = arena.select(leftValues), right = arena.select([...rightValues]);
  assert.equal(compareFiniteShapes({ left, right, operation: 'inclusion' }).status === 'proved', leftValues.every(value => rightValues.has(value)));
  assert.equal(compareFiniteShapes({ left, right, operation: 'disjointness' }).status === 'proved', leftValues.every(value => !rightValues.has(value)));
  assert.equal(compareFiniteShapes({ left: arena.intersection(left, right), right: arena.select(leftValues.filter(value => rightValues.has(value))), operation: 'equivalence' }).status, 'proved');
  assert.equal(compareFiniteShapes({ left: arena.union(left, arena.complement(left)), right: arena.select(indices(31)), operation: 'equivalence' }).status, 'proved');
}
const strings = createTypeIrArena({ contextKey: world.contextKey });
const root = strings.union([strings.literal('before'), strings.literal('after')]);
assert.equal(queryFiniteStringType({ arena: strings, root, world, operation: 'contains', value: 'after' }).status, 'proved');
assert.equal(queryFiniteStringType({ arena: strings, root, world, operation: 'contains', value: 'other' }).status, 'refuted');
assert.equal(queryFiniteStringType({ arena: strings, root, world, operation: 'classify' }).cardinality, 'many');
assert.equal(queryFiniteStringType({ arena: strings, root, world, operation: 'classify', options: { budget: { maxSteps: 0 } } }).status, 'unknown');
assert.throws(() => queryFiniteStringType({ arena: strings, root, world: { ...world, contextKey: 'wrong' }, operation: 'classify' }), /Pinned/);
console.log('finite shape and finite-string query profiles passed');
