import assert from 'node:assert/strict';
import { selectThroughputRunInputs } from '../../../tools/reports/show-throughput/selection.js';
import { compareLedgerRegressions } from '../../../tools/reports/show-throughput/analysis.js';
const inputs = [
  { file: 'a.json', repoIdentity: 'target', generatedAtMs: 300, payload: {} },
  { file: 'z.json', repoIdentity: 'target', generatedAtMs: 100, payload: {} },
  { file: 'other.json', repoIdentity: 'other', generatedAtMs: 500, payload: {} },
  { file: 'unknown.json', repoIdentity: 'target', generatedAtMs: null, payload: {} }
];
assert.deepEqual(selectThroughputRunInputs(inputs, { repoFilter: 'target', latestCount: 1 }).map(row => row.file), ['a.json']);
assert.deepEqual(selectThroughputRunInputs(inputs, { repoFilter: 'target' }).map(row => row.file), ['unknown.json', 'z.json', 'a.json']);
const rows = [
  { folder: 'a', repoIdentity: 'same', metricKind: 'duration', deltaPct: 0.2 },
  { folder: 'z', repoIdentity: 'same', metricKind: 'rate', deltaPct: -0.8 },
  { folder: 'b', repoIdentity: 'same', metricKind: 'duration', deltaPct: 0.8 }
];
const expected = [...rows].sort(compareLedgerRegressions).map(row => row.folder);
for (const permutation of [rows, [...rows].reverse(), [rows[1], rows[0], rows[2]]]) assert.deepEqual([...permutation].sort(compareLedgerRegressions).map(row => row.folder), expected);
for (const left of rows) for (const right of rows) {
  assert.equal(Math.sign(compareLedgerRegressions(left, right)), -Math.sign(compareLedgerRegressions(right, left)) || 0);
  assert.equal(compareLedgerRegressions(left, left), 0);
}
console.log('throughput selection and total regression ordering passed');
