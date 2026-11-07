import assert from 'node:assert/strict';
import { buildSuggestTestsReport } from '../../src/graph/suggest-tests.js';

const report = buildSuggestTestsReport({
  changed: ['src/app.js'],
  tests: ['tests/app.test.js', 'tests/mapping.test.js', 'tests/happy.test.js', 'tests/app-config.test.js'],
  indexCompatKey: 'name-boundaries'
});
assert.deepEqual(report.suggestions.map((entry) => entry.testPath).sort(), [
  'tests/app-config.test.js', 'tests/app.test.js'
]);
assert.equal(report.fidelity.source, 'heuristic');
assert.ok(report.suggestions.every((entry) => entry.witnessPath === null));
console.log('test suggestions do not confuse incidental substrings with source names');
