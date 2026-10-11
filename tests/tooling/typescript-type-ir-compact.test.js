#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createTypeIrArena, classifyTypeIr, containsTypeIr, serializeTypeIr, deserializeTypeIr
} from '../../src/index/tooling/typescript/type-ir/index.js';

// Each position independently chooses one binary symbol: exactly 2^4096 strings.
// Build the flat input once; this makes no arbitrary-incremental-insertion claim.
const arena = createTypeIrArena({ contextKey: 'fixture:binary4096:v1', maxArenaNodes: 100 });
const binary = arena.union([arena.literal('0'), arena.literal('1')]);
const root = arena.concat(Array(4096).fill(binary));
assert.ok(arena.stats().nodes <= 16, 'shared positions must not enumerate products');
const classification = classifyTypeIr(arena, root);
assert.equal(classification.cardinality, 'many');
assert.equal(classification.witnesses.length, 2);
assert.notEqual(...classification.witnesses);
for (const witness of classification.witnesses) {
  assert.equal(witness.length, 4096);
  assert.equal(containsTypeIr(arena, root, witness), true);
}
assert.equal(containsTypeIr(arena, root, '0'.repeat(4096)), true);
assert.equal(containsTypeIr(arena, root, '1'.repeat(4096)), true);
assert.equal(containsTypeIr(arena, root, '01'.repeat(2048)), true);
assert.equal(containsTypeIr(arena, root, '0'.repeat(4095)), false);
assert.equal(containsTypeIr(arena, root, '0'.repeat(4095) + 'x'), false);
const serialized = serializeTypeIr(arena, root);
assert.ok(serialized.length < 5000);
const copy = deserializeTypeIr(serialized);
assert.equal(copy.root.id, root.id);
assert.equal(containsTypeIr(copy.arena, copy.root, '10'.repeat(2048)), true);

// Thousands of distinct binary positions also remain linear in graph size.
const distinct = createTypeIrArena({ contextKey: 'fixture:distinct1024:v1' });
const factors = Array.from({ length: 1024 }, (_, index) => distinct.union([
  distinct.literal(`${index}:a;`), distinct.literal(`${index}:b;`)
]));
const uniqueRoot = distinct.concat(factors);
assert.ok(distinct.stats().nodes <= 4096);
const uniqueWitnesses = classifyTypeIr(distinct, uniqueRoot);
assert.equal(uniqueWitnesses.cardinality, 'many');
for (const witness of uniqueWitnesses.witnesses) assert.equal(containsTypeIr(distinct, uniqueRoot, witness), true);

// A flat Concat normalization would allocate 2^12000 operands here. Persistent
// canonical factor ropes instead add exactly one shared node for each doubling.
const deep = createTypeIrArena({ contextKey: 'fixture:doubling:v1', maxArenaNodes: 12002 });
let repeated = deep.literal('x');
for (let index = 0; index < 12000; index += 1) repeated = deep.concat([repeated, repeated]);
assert.equal(deep.stats().nodes, 12001);
assert.ok(deep.stats().chargedBytes <= deep.stats().maxArenaBytes);
assert.equal(containsTypeIr(deep, repeated, ''), false, 'membership must walk deep DAGs without recursion');
assert.throws(() => classifyTypeIr(deep, repeated), error =>
  error.code === 'ERR_TOOLING_REQUIRED_COMPUTATION_INCOMPLETE' && error.complete === false);

const roundtripArena = createTypeIrArena({ contextKey: 'fixture:doubling-roundtrip:v1' });
let roundtripRoot = roundtripArena.literal('y');
for (let index = 0; index < 2048; index += 1) roundtripRoot = roundtripArena.concat([roundtripRoot, roundtripRoot]);
const roundtripText = serializeTypeIr(roundtripArena, roundtripRoot);
assert.ok(roundtripText.length < 600000);
const roundtrip = deserializeTypeIr(roundtripText, { budget: { maxSteps: 10000000 } });
assert.equal(roundtrip.root.id, roundtripRoot.id);
assert.equal(roundtrip.root.children[0], roundtrip.root.children[1], 'import must restore shared handles');
assert.equal(serializeTypeIr(roundtrip.arena, roundtrip.root), roundtripText);
console.log('typescript finite-string IR compact exponential products and deep sharing passed');
