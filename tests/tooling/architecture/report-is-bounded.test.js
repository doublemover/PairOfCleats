#!/usr/bin/env node
import assert from 'node:assert';
import { buildArchitectureReport } from '../../../src/graph/architecture.js';

const graphRelations = {
  version: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  callGraph: {
    nodeCount: 3,
    edgeCount: 2,
    nodes: [
      { id: 'chunk-a', file: 'src/a.js', out: ['chunk-b', 'chunk-c'], in: [] },
      { id: 'chunk-b', file: 'src/b.js', out: [], in: ['chunk-a'] },
      { id: 'chunk-c', file: 'src/c.js', out: [], in: ['chunk-a'] }
    ]
  },
  usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
};

const rules = [
  {
    id: 'no-calls',
    type: 'forbiddenCall',
    from: { anyOf: ['src/**'] },
    to: { anyOf: ['src/**'] }
  }
];

const report = buildArchitectureReport({
  rules,
  graphRelations,
  caps: { maxViolations: 1 },
  indexCompatKey: 'compat-architecture-bounded',
  now: () => '2026-01-01T00:00:00.000Z'
});

assert.strictEqual(report.violations.length, 1, 'expected a bounded violation list');
assert(
  Array.isArray(report.truncation) && report.truncation.some((entry) => entry.cap === 'maxViolations'),
  'expected maxViolations truncation record'
);

console.log('architecture bounded report test passed');
