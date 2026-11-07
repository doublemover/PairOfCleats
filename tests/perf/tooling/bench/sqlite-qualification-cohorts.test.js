import assert from 'node:assert/strict';
import { selectSqliteRowQualification } from '../../../../tools/bench/sqlite/qualification-plan.js';

const odd = ['small-low-build', 'small-low-update', 'large-low-build', 'large-low-update', 'large-high-update'];
const even = ['large-high-update', 'large-low-build', 'large-low-update', 'small-low-build', 'small-low-update'];
const all = selectSqliteRowQualification();
assert.equal(all.scope, 'complete-campaign');
assert.deepEqual(all.shapes, ['small-low', 'large-low', 'large-high']);
assert.deepEqual(all.omittedCohorts, []);
assert.equal(all.pairs.length, 30, 'Six independent trials retain all five original paired workloads.');
for (const trial of [1, 2, 3, 4, 5, 6]) {
  assert.deepEqual(all.pairs.filter(row => row.trial === trial).map(row => row.shape + '-' + row.operation), trial % 2 ? odd : even);
}
const key = row => row.trial + ':' + row.shape + ':' + row.operation;
const selected = [];
for (const cohort of odd) {
  const result = selectSqliteRowQualification(cohort);
  assert.equal(result.scope, 'selected-cohort'); assert.equal(result.cohort, cohort);
  assert.equal(result.pairs.length, 6); assert.deepEqual(result.pairs.map(row => row.trial), [1, 2, 3, 4, 5, 6]);
  assert.ok(result.pairs.every(row => row.shape + '-' + row.operation === cohort));
  assert.deepEqual(result.shapes, cohort.startsWith('small-') ? ['small-low'] : ['large-low', 'large-high']);
  assert.deepEqual(result.omittedCohorts, odd.filter(value => value !== cohort));
  selected.push(...result.pairs.map(key));
}
assert.equal(new Set(selected).size, 30);
assert.deepEqual(selected.sort(), all.pairs.map(key).sort(), 'Selected cohorts exactly conserve the default campaign without duplicate or missing trial pairs.');
for (const invalid of ['', 'large-high-build', 'small-low', 'current', '__proto__', null, 1]) {
  assert.throws(() => selectSqliteRowQualification(invalid), /Unknown SQLite qualification cohort/);
}
console.log('SQLite cohort selection retains all six trials, paired arms, source-identity prerequisites and explicit omissions.');
