import assert from 'node:assert/strict';
import { mergeTypeEntries } from '../../src/shared/type-entry-utils.js';
import { normalizeProviderPayload } from '../../src/index/tooling/provider-output-contract.js';
import { mergeToolingEntry } from '../../src/integrations/tooling/providers/shared.js';

// UNVALIDATED: existing merger plus actual provider admission/merge consumers.
const strong = { type: 'ZResult', source: 'annotation', confidence: .95 };
const weak = ['A', 'B', 'C', 'D', 'E'].map(type => ({ type, source: 'flow', confidence: .2 }));
const rows = [strong, ...weak], expected = ['A', 'B', 'C', 'D', 'ZResult'];
for (let offset = 0; offset < rows.length; offset++) {
  const rotated = [...rows.slice(offset), ...rows.slice(0, offset)];
  for (const ordered of [rotated, rotated.toReversed()]) for (let split = 0; split <= ordered.length; split++) {
    const merged = mergeTypeEntries(ordered.slice(0, split), ordered.slice(split), { cap: 5 });
    assert.equal(merged.truncated, true); assert.deepEqual(merged.list.map(row => row.type), expected);
    assert.equal(merged.list.at(-1).confidence, .95); assert.equal(merged.list.at(-1).source, 'annotation');
    assert.deepEqual(mergeTypeEntries([], merged.list, { cap: 5 }).list, merged.list, 'selected facts remain stable on repeat merge');
  }
}
const observations = [];
const payload = normalizeProviderPayload({ paramTypes: { value: rows } }, { observations });
assert.deepEqual(payload.paramTypes.value.map(row => row.type), expected);
assert.deepEqual(observations.map(row => row.code), ['tooling_param_types_truncated']);
const tooling = { returns: [], params: { value: [strong] } };
mergeToolingEntry(tooling, { params: { value: weak } });
assert.deepEqual(tooling.params.value, expected, 'actual default-five provider merge preserves stronger existing facts');

const scored = [
  { type: 'Unknown', source: 'annotation' },
  { type: 'Zero', source: 'flow', confidence: 0 },
  { type: 'Low', source: 'tooling', confidence: .1 }
];
assert.deepEqual(mergeTypeEntries([], scored, { cap: 2 }).list.map(row => row.type), ['Low', 'Zero']);
assert.equal(mergeTypeEntries([], [{ type: 'Same', source: 'flow' },
  { type: 'Same', source: 'flow', confidence: 0 }], { cap: 1 }).list[0].confidence, 0);
const strengthened = mergeTypeEntries([{ type: 'Same', source: 'flow', confidence: .1 }],
  [{ type: 'Same', source: 'flow', confidence: .9 }], { cap: 1 });
assert.equal(strengthened.list[0].confidence, .9); assert.equal(strengthened.truncated, false);
const distinct = [{ type: 'Same', source: 'annotation', confidence: .9 }, { type: 'Same', source: 'flow', confidence: .8 }];
assert.equal(mergeTypeEntries([], distinct, { cap: 2 }).list.length, 2, 'different provenance remains distinct');
assert.equal(mergeTypeEntries([], distinct, { cap: 2 }).truncated, false);
assert.equal(mergeTypeEntries([], distinct, { cap: 1 }).truncated, true);

// A discarded key may return with stronger evidence. Its old weaker score is
// unnecessary once it lies below the retained admission threshold.
const returned = mergeTypeEntries([], [
  { type: 'C', confidence: .1 }, { type: 'B', confidence: .2 }, { type: 'A', confidence: .3 },
  { type: 'C', confidence: .9 }, { type: 'B', confidence: .1 }, { type: 'A', confidence: .3 }
], { cap: 2 });
assert.deepEqual(returned.list.map(row => [row.type, row.confidence]), [['A', .3], ['C', .9]]);
assert.equal(returned.truncated, true);
const variants = [{ type: 'Map < User >', source: 'annotation', confidence: .9 },
  { type: 'Map<User>', source: 'annotation', confidence: .9 }];
assert.deepEqual(mergeTypeEntries([], variants, { cap: 1 }), mergeTypeEntries([], variants.toReversed(), { cap: 1 }));
assert.equal(mergeTypeEntries([], variants, { cap: 1 }).truncated, false);
assert.equal(mergeTypeEntries([], [null, false, '', ...rows.slice(0, 5)], { cap: 5 }).truncated, false);

let observed = 0;
function* streamed() {
  for (let index = 0; index < 1024; index++) {
    observed++; yield { type: `T${String(index).padStart(4, '0')}`, source: 'flow', confidence: index / 1024 };
  }
}
const streamedResult = mergeTypeEntries([], streamed(), { cap: 5 });
assert.equal(observed, 1024); assert.equal(streamedResult.truncated, true);
assert.deepEqual(streamedResult.list.map(row => row.type), ['T1019', 'T1020', 'T1021', 'T1022', 'T1023']);
assert.equal(mergeTypeEntries(new Set(rows), null, { cap: 0 }).list.length, 6, 'zero retains legacy uncapped semantics');
assert.equal(mergeTypeEntries(new Map(rows.map((row, index) => [index, row])), []).list.length, 6);
assert.equal(mergeTypeEntries([], []).truncated, false);
console.log('Type candidate admission retains stronger evidence before deterministic display capping.');
