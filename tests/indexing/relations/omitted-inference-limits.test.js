import assert from 'node:assert/strict';
import { applyRelationInferenceBudget, applyFileUsageInferenceBudget } from '../../../src/index/build/file-processor/relations.js';

const original = () => ({ calls: [['a', 'b'], ['a', 'c']],
  callDetails: [{ caller: 'a', callee: 'b' }, { caller: 'a', callee: 'c' }], usages: ['b', 'c'] });
const unchanged = { before: 2, after: 2, dropped: 0 };
for (const absent of [undefined, null, '', '  ', false, true, 'not-a-number', NaN, Infinity, -1]) {
  const relations = original();
  const arrays = { ...relations };
  const report = applyRelationInferenceBudget({ relations, maxCalls: absent, maxCallDetails: absent, maxUsages: absent });
  assert.deepEqual(report, { calls: unchanged, callDetails: unchanged, usages: unchanged });
  for (const key of ['calls', 'callDetails', 'usages']) assert.equal(relations[key], arrays[key]);
  const file = original();
  assert.deepEqual(applyFileUsageInferenceBudget({ fileRelations: file, maxUsages: absent }), unchanged);
  assert.deepEqual(file.usages, ['b', 'c']);
}
for (const cap of [0, '0', 1, '1', 1.9, 20]) {
  const relations = original();
  const after = Math.min(2, Math.floor(Number(cap)));
  const expected = { before: 2, after, dropped: 2 - after };
  assert.deepEqual(applyRelationInferenceBudget({ relations, maxCalls: cap, maxCallDetails: cap, maxUsages: cap }),
    { calls: expected, callDetails: expected, usages: expected });
  assert.deepEqual(relations, Object.fromEntries(Object.entries(original()).map(([key, values]) => [key, values.slice(0, after)])));
  const file = original();
  assert.deepEqual(applyFileUsageInferenceBudget({ fileRelations: file, maxUsages: cap }), expected);
  assert.deepEqual(file.usages, original().usages.slice(0, after));
}
const partial = original();
const report = applyRelationInferenceBudget({ relations: partial, maxCalls: 0 });
assert.deepEqual(partial.calls, []); assert.deepEqual(partial.callDetails, original().callDetails);
assert.deepEqual(partial.usages, original().usages); assert.deepEqual(report.usages, unchanged);
const missing = {};
applyRelationInferenceBudget({ relations: missing });
assert.deepEqual(missing, {});
applyRelationInferenceBudget({ relations: missing, ensureUsageArray: true });
assert.deepEqual(missing, { usages: [] });
console.log('Omitted/invalid inference limits preserve each relation array; explicit zero and positive budgets report exact drops.');
