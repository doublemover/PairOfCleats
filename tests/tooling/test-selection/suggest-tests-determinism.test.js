#!/usr/bin/env node
import assert from 'node:assert';
import { buildSuggestTestsReport } from '../../../src/graph/suggest-tests.js';

const graphRelations = {
  version: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  callGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  importGraph: {
    nodeCount: 2,
    edgeCount: 1,
    nodes: [
      { id: 'tests/a.test.js', file: 'tests/a.test.js', out: ['src/lib.js'], in: [] },
      { id: 'src/lib.js', file: 'src/lib.js', out: [], in: ['tests/a.test.js'] }
    ]
  }
};

const now = () => '2026-01-01T00:00:00.000Z';
const reportA = buildSuggestTestsReport({
  changed: ['src/lib.js'],
  graphRelations,
  tests: ['tests/a.test.js'],
  caps: { maxSuggestions: 5 },
  indexCompatKey: 'compat-suggest-tests-determinism',
  now
});
const reportB = buildSuggestTestsReport({
  changed: ['src/lib.js'],
  graphRelations,
  tests: ['tests/a.test.js'],
  caps: { maxSuggestions: 5 },
  indexCompatKey: 'compat-suggest-tests-determinism',
  now
});

assert.deepStrictEqual(reportA, reportB, 'expected deterministic suggest-tests output');

console.log('suggest-tests determinism test passed');
