#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mergeDefinitionStates, createDefinitionTransfer, definitionStatesEqual } from '../../../src/index/semantic/compiler-definition-state.js';
const initial = new Map(Array.from({ length: 1000 }, (_, index) => ['s' + index, new Set(['unknown' + index])]));
assert.equal(mergeDefinitionStates([initial]), initial);
assert.equal(mergeDefinitionStates([initial, initial]), initial);
assert.equal(createDefinitionTransfer(initial).finish(), initial);
const transfer = createDefinitionTransfer(initial);
transfer.set('s0', new Set(['write'])); transfer.set('s1', new Set(['unknown1', 'may-write']));
const output = transfer.finish();
assert.notEqual(output, initial); assert.equal(output.get('s999'), initial.get('s999'));
assert.deepEqual([...initial.get('s0')], ['unknown0']); assert.deepEqual([...output.get('s0')], ['write']);
const noop = createDefinitionTransfer(output); noop.set('s0', new Set(['write'])); assert.equal(noop.finish(), output);
const merged = mergeDefinitionStates([initial, output]);
assert.deepEqual([...merged.get('s0')], ['unknown0', 'write']); assert.equal(merged.get('s999'), initial.get('s999'));
assert.equal(definitionStatesEqual(merged, new Map([...merged].map(([key, values]) => [key, new Set(values)]))), true);
assert.equal(definitionStatesEqual(output, initial), false);

assert.throws(() => createDefinitionTransfer(initial, { spend: () => false }).set('s0', new Set(['changed'])),
  { code: 'ERR_COMPILER_DEFINITION_BUDGET' });
assert.equal(initial.get('s0').has('changed'), false, 'exhaustion never mutates the shared source environment');
