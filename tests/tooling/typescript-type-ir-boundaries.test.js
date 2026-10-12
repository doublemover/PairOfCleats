#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createTypeIrArena, classifyTypeIr, containsTypeIr, serializeTypeIr, serializeTypeIrRoots, deserializeTypeIr
} from '../../src/index/tooling/typescript/type-ir/index.js';

const invalid = action => assert.throws(action, error => error.code === 'ERR_TYPE_IR_INVALID');
const incomplete = (action, reason) => assert.throws(action, error => {
  assert.equal(error.code, 'ERR_TOOLING_REQUIRED_COMPUTATION_INCOMPLETE');
  assert.equal(error.complete, false);
  assert.equal(error.details.coverage, 'incomplete');
  assert.ok(error.operation.startsWith('type-ir.'));
  if (reason) assert.equal(error.reason, reason);
  return true;
});
const arena = createTypeIrArena({ contextKey: 'fixture:boundary:v1' });
const a = arena.literal('a');
const b = arena.literal('b');
const union = arena.union([a, b]);
const concat = arena.concat([union, union]);
const encoded = serializeTypeIrRoots(arena, [concat, union, a, union]);
const graph = JSON.parse(encoded);
assert.equal(graph.rootIds.length, 3);
const restored = deserializeTypeIr(encoded);
assert.equal(serializeTypeIrRoots(restored.arena, restored.roots), encoded);
assert.equal(restored.arena.getNode(union.id).id, union.id, 'explicit nested union root survives');
assert.equal(restored.arena.getNode(concat.id).children[0], restored.arena.getNode(union.id));
assert.equal(serializeTypeIrRoots(arena, [a, union, concat]), encoded);
const escaped = arena.literal('\u0000\b\t\n\f\r\"\\\ud800\udc00😀\ud800x\udc00');
const escapedText = serializeTypeIr(arena, escaped);
assert.equal(deserializeTypeIr(escapedText).root.value, escaped.value);
const everyCodeUnit = Array.from({ length: 65536 }, (_, code) => String.fromCharCode(code)).join('');
const allUnitsText = serializeTypeIr(arena, arena.literal(everyCodeUnit));
assert.equal(JSON.stringify(JSON.parse(allUnitsText)), allUnitsText);
assert.equal(deserializeTypeIr(allUnitsText).root.value, everyCodeUnit);
const emptyGraph = serializeTypeIrRoots(arena, []);
assert.deepEqual(deserializeTypeIr(emptyGraph).roots, []);
assert.equal(deserializeTypeIr(emptyGraph).root, null);
const equivalent = createTypeIrArena({ contextKey: arena.contextKey });
const eb = equivalent.literal('b');
const ea = equivalent.literal('a');
const eu = equivalent.union([eb, ea]);
assert.equal(serializeTypeIrRoots(equivalent, [equivalent.concat([eu, eu]), ea, eu]), encoded);
invalid(() => arena.union([ea]));
const otherContext = createTypeIrArena({ contextKey: 'fixture:other-context:v1' });
assert.notEqual(otherContext.literal('a').id, a.id);
invalid(() => arena.concat([otherContext.literal('a')]));
invalid(() => deserializeTypeIr(encoded, { contextKey: otherContext.contextKey }));
invalid(() => arena.assertNode({ ...a }));
const collision = createTypeIrArena({ contextKey: 'collision', digest: () => '0'.repeat(64) });
collision.literal('first');
invalid(() => collision.literal('second'));

const mutate = change => {
  const copy = structuredClone(graph);
  change(copy);
  return () => deserializeTypeIr(copy);
};
invalid(mutate(copy => { copy.contextKey += ':forged'; }));
invalid(mutate(copy => { copy.nodes.find(node => node.kind === 'Literal').value = 'forged'; }));
invalid(mutate(copy => { copy.nodes.reverse(); }));
invalid(mutate(copy => { copy.rootIds.reverse(); }));
invalid(mutate(copy => { copy.rootIds.push(copy.rootIds.at(-1)); }));
invalid(mutate(copy => { copy.nodes.push(copy.nodes.at(-1)); }));
invalid(mutate(copy => { copy.nodes.find(node => node.kind === 'Union').children.reverse(); }));
invalid(mutate(copy => { copy.nodes.find(node => node.kind === 'Concat').children[0] = `tir1:${'f'.repeat(64)}`; }));
invalid(mutate(copy => { const node = copy.nodes.find(item => item.kind === 'Concat'); node.children[0] = node.id; }));
invalid(mutate(copy => { copy.rootIds = [a.id]; }));
invalid(mutate(copy => { copy.extra = true; }));
incomplete(mutate(copy => { copy.nodes[0].kind = 'Recursive'; }), 'unsupported_node_kind');
invalid(() => deserializeTypeIr('{'));

// Output caps are UTF-8 byte caps, admitted before constructing witness strings.
incomplete(() => classifyTypeIr(arena, arena.literal('éé'), { maxWitnessBytes: 3 }), 'maxWitnessBytes_exceeded');
incomplete(() => classifyTypeIr(arena, union, { maxWitnessBytes: 1 }), 'maxWitnessBytes_exceeded');
assert.equal(classifyTypeIr(arena, union, { maxWitnessBytes: 2 }).witnesses.length, 2);
const paired = arena.concat([arena.literal('\ud83d'), arena.literal('\ude00')]);
assert.deepEqual(classifyTypeIr(arena, paired, { maxWitnessBytes: 4 }).witnesses, ['😀']);
incomplete(() => classifyTypeIr(arena, paired, { maxWitnessBytes: 3 }), 'maxWitnessBytes_exceeded');
const pairChoices = arena.concat([arena.union([arena.literal('\ud83d'), arena.literal('\ud83e')]), arena.literal('\ude00')]);
assert.equal(classifyTypeIr(arena, pairChoices, { maxWitnessBytes: 8 }).witnesses.length, 2);
incomplete(() => classifyTypeIr(arena, pairChoices, { maxWitnessBytes: 7 }), 'maxWitnessBytes_exceeded');
incomplete(() => classifyTypeIr(arena, union, { maxWitnessBytes: 0 }), 'maxWitnessBytes_exceeded');
assert.equal(classifyTypeIr(arena, arena.union([]), { maxWitnessBytes: 0 }).cardinality, 'zero');
assert.deepEqual(classifyTypeIr(arena, arena.literal(''), { maxWitnessBytes: 0 }).witnesses, ['']);
invalid(() => classifyTypeIr(arena, union, { maxWitnessBytes: -1 }));

const zeroSteps = { budget: { maxSteps: 0 } };
for (const action of [
  () => arena.literal('new', zeroSteps), () => arena.union([a, b], zeroSteps),
  () => arena.concat([a, b], zeroSteps), () => classifyTypeIr(arena, union, zeroSteps),
  () => containsTypeIr(arena, union, 'a', zeroSteps), () => serializeTypeIr(arena, union, zeroSteps),
  () => deserializeTypeIr(encoded, zeroSteps)
]) incomplete(action, 'maxSteps_exceeded');
incomplete(() => createTypeIrArena({ contextKey: 'initial-context', maxArenaBytes: 0 }), 'maxArenaBytes_exceeded');
incomplete(() => arena.literal('large', { budget: { maxAllocationBytes: 1 } }), 'maxAllocationBytes_exceeded');
incomplete(() => arena.concat(Array(10000).fill(a), { budget: { maxAllocationBytes: 1024 } }), 'maxAllocationBytes_exceeded');
incomplete(() => classifyTypeIr(arena, concat, { budget: { maxStates: 0 } }), 'maxStates_exceeded');
incomplete(() => containsTypeIr(arena, union, 'a', { budget: { maxStates: 0 } }), 'maxStates_exceeded');
incomplete(() => containsTypeIr(arena, union, 'aa', { budget: { maxInputChars: 1 } }), 'maxInputChars_exceeded');
incomplete(() => deserializeTypeIr(encoded, { budget: { maxInputChars: 1 } }), 'maxInputChars_exceeded');
incomplete(() => serializeTypeIr(arena, concat, { budget: { maxAllocationBytes: 1 } }), 'maxAllocationBytes_exceeded');
const limited = createTypeIrArena({ contextKey: 'limit', maxArenaNodes: 1 });
const retained = limited.literal('a');
incomplete(() => limited.literal('b'), 'maxArenaNodes_exceeded');
assert.equal(limited.literal('a'), retained);
assert.equal(limited.stats().nodes, 1);
assert.ok(limited.stats().chargedBytes <= limited.stats().maxArenaBytes);
invalid(() => arena.literal('x', { budget: { maxSteps: -1 } }));
invalid(() => arena.literal('x', { budget: { unknownLimit: 4 } }));
for (const action of [
  () => arena.literal('x', { deadlineAtMs: 0 }),
  () => classifyTypeIr(arena, concat, { deadlineAtMs: 0 }),
  () => containsTypeIr(arena, concat, 'ab', { deadlineAtMs: 0 }),
  () => serializeTypeIr(arena, concat, { deadlineAtMs: 0 }),
  () => deserializeTypeIr(encoded, { deadlineAtMs: 0 })
]) incomplete(action, 'deadline_exceeded');
invalid(() => arena.literal('x', { deadlineAtMs: NaN }));
const signal = AbortSignal.abort();
for (const action of [
  () => arena.literal('x', { signal }), () => arena.union([a, b], { signal }),
  () => arena.concat([a, b], { signal }), () => classifyTypeIr(arena, concat, { signal }),
  () => containsTypeIr(arena, concat, 'ab', { signal }), () => serializeTypeIr(arena, concat, { signal }),
  () => deserializeTypeIr(encoded, { signal })
]) assert.throws(action, error => error.code === 'ABORT_ERR' && error.name === 'AbortError');
// A synchronously observable abort during traversal must stop, not return false.
let observations = 0;
const duringTraversal = { get aborted() { return ++observations > 8; } };
assert.throws(() => containsTypeIr(arena, concat, 'ab', { signal: duringTraversal }),
  error => error.code === 'ABORT_ERR');
assert.ok(observations > 8);
console.log('typescript finite-string IR canonical multi-root serialization, rejection, limits, and abort passed');
