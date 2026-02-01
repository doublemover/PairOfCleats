#!/usr/bin/env node
import assert from 'node:assert';
import { buildSuggestTestsReport } from '../../../src/graph/suggest-tests.js';

const graphRelations = {
  version: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  callGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  importGraph: {
    nodeCount: 4,
    edgeCount: 3,
    nodes: [
      { id: 'tests/a.test.js', file: 'tests/a.test.js', out: ['src/lib.js'], in: [] },
      { id: 'tests/b.test.js', file: 'tests/b.test.js', out: ['src/lib.js'], in: [] },
      { id: 'tests/c.test.js', file: 'tests/c.test.js', out: ['src/lib.js'], in: [] },
      { id: 'src/lib.js', file: 'src/lib.js', out: [], in: ['tests/a.test.js', 'tests/b.test.js', 'tests/c.test.js'] }
    ]
  }
};

const report = buildSuggestTestsReport({
  changed: ['src/lib.js'],
  graphRelations,
  tests: ['tests/a.test.js', 'tests/b.test.js', 'tests/c.test.js'],
  caps: { maxSuggestions: 1 },
  indexCompatKey: 'compat-suggest-tests-bounded',
  now: () => '2026-01-01T00:00:00.000Z'
});

assert.strictEqual(report.suggestions.length, 1, 'expected suggestions to be bounded');
assert(
  Array.isArray(report.truncation) && report.truncation.some((entry) => entry.cap === 'maxSuggestions'),
  'expected maxSuggestions truncation record'
);

console.log('suggest-tests bounded test passed');
