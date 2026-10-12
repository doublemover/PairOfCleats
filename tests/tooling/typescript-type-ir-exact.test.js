#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createTypeIrArena, classifyTypeIr, containsTypeIr, serializeTypeIr, deserializeTypeIr
} from '../../src/index/tooling/typescript/type-ir/index.js';

const arena = createTypeIrArena({ contextKey: 'fixture:exact:v1' });
const literal = value => arena.literal(value);
const empty = arena.union([]);
const epsilon = arena.concat([]);
const a = literal('a');
const b = literal('b');
const c = literal('c');
assert.equal(epsilon, literal(''));
assert.deepEqual(classifyTypeIr(arena, empty), { cardinality: 'zero', witnesses: [], complete: true });
assert.deepEqual(classifyTypeIr(arena, epsilon), { cardinality: 'one', witnesses: [''], complete: true });
assert.equal(containsTypeIr(arena, empty, ''), false);
assert.equal(containsTypeIr(arena, epsilon, ''), true);
assert.equal(arena.concat([a, empty]), empty);
assert.equal(arena.concat([epsilon, a, epsilon]), a);
assert.equal(arena.union([empty, a, a]), a);
assert.equal(arena.union([a, arena.union([c, b]), b]), arena.union([c, a, b]));
assert.equal(arena.concat([a, a]).children.length, 2, 'concat must retain repeated operands');
assert.equal(containsTypeIr(arena, arena.concat([a, a]), 'aa'), true);
assert.equal(containsTypeIr(arena, arena.concat([a, a]), 'a'), false);
assert.ok(Object.isFrozen(a));
assert.ok(Object.isFrozen(arena.union([a, b]).children));

const sameString = arena.union([
  literal('abc'), arena.concat([a, literal('bc')]), arena.concat([literal('ab'), c])
]);
assert.deepEqual(classifyTypeIr(arena, sameString), { cardinality: 'one', witnesses: ['abc'], complete: true });
const optional = arena.union([epsilon, a]);
const ambiguous = arena.concat([optional, optional]);
assert.equal(classifyTypeIr(arena, ambiguous).cardinality, 'many');
for (const value of ['', 'a', 'aa']) assert.equal(containsTypeIr(arena, ambiguous, value), true);
for (const value of ['aaa', 'b']) assert.equal(containsTypeIr(arena, ambiguous, value), false);
const widths = arena.concat([arena.union([a, literal('ab')]), arena.union([b, literal('bc')])]);
for (const value of ['ab', 'abc', 'abb', 'abbc']) assert.equal(containsTypeIr(arena, widths, value), true);
assert.equal(containsTypeIr(arena, widths, 'ac'), false);
const surrogate = arena.concat([literal('\ud83d'), literal('\ude00')]);
assert.equal(containsTypeIr(arena, surrogate, '😀'), true, 'membership uses UTF-16 code units consistently');
assert.deepEqual(classifyTypeIr(arena, surrogate).witnesses, ['😀']);

// Canonical factor ropes have the same identity under every grouping tested,
// including boundaries just below/above powers of two. No distribution is used.
let seed = 219;
const next = maximum => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % maximum; };
const group = nodes => {
  if (nodes.length === 1) return nodes[0];
  const split = 1 + next(nodes.length - 1);
  return arena.concat([group(nodes.slice(0, split)), group(nodes.slice(split))]);
};
for (const size of [1, 2, 3, 4, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129]) {
  const factors = Array.from({ length: size }, (_, index) => literal(`${index}:`));
  const canonical = arena.concat(factors);
  for (let sample = 0; sample < 5; sample += 1) assert.equal(group(factors), canonical, `size ${size}`);
  assert.equal(containsTypeIr(arena, canonical, factors.map(node => node.value).join('')), true);
}

// Bounded independent reference enumeration is confined to this tiny oracle.
// The production query algorithms never enumerate the represented products.
const choices = ['', 'a', 'b', 'ab'].map(value => ({ node: literal(value), values: new Set([value]) }));
choices.push({ node: empty, values: new Set() });
for (let index = 0; index < 100; index += 1) {
  const left = choices[next(choices.length)];
  const right = choices[next(choices.length)];
  if (Math.max(...[...left.values, ...right.values].map(value => value.length), 0) > 6) continue;
  const union = next(2) === 0;
  const values = union ? new Set([...left.values, ...right.values])
    : new Set([...left.values].flatMap(x => [...right.values].map(y => x + y)));
  if (values.size > 128) continue;
  const node = union ? arena.union([left.node, right.node]) : arena.concat([left.node, right.node]);
  choices.push({ node, values });
  const classification = classifyTypeIr(arena, node);
  assert.equal(classification.cardinality, values.size === 0 ? 'zero' : values.size === 1 ? 'one' : 'many');
  assert.equal(new Set(classification.witnesses).size, classification.witnesses.length);
  for (const witness of classification.witnesses) assert.ok(values.has(witness));
  for (const value of values) assert.equal(containsTypeIr(arena, node, value), true);
  for (const candidate of ['', 'a', 'b', 'ab', 'ba', 'aaa', 'bbb', 'abab', 'wrong']) {
    assert.equal(containsTypeIr(arena, node, candidate), values.has(candidate));
  }
}
const encoded = serializeTypeIr(arena, widths);
const restored = deserializeTypeIr(encoded);
assert.equal(serializeTypeIr(restored.arena, restored.root), encoded);
console.log('typescript finite-string IR exact algebra, witnesses, membership, and bounded oracle passed');
