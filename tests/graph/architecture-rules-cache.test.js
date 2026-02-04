#!/usr/bin/env node
import assert from 'node:assert';
import { buildArchitectureReport } from '../../src/graph/architecture.js';

const rules = {
  version: 1,
  rules: [
    {
      id: 'no-b',
      type: 'forbiddenImport',
      from: { anyOf: ['src/a.js'] },
      to: { anyOf: ['src/b.js'] }
    }
  ]
};

const graphRelations = {
  version: 1,
  callGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  importGraph: {
    nodeCount: 2,
    edgeCount: 1,
    nodes: [
      { id: 'src/a.js', out: ['src/b.js'], in: [] },
      { id: 'src/b.js', out: [], in: ['src/a.js'] }
    ]
  }
};

const build = () => buildArchitectureReport({
  rules,
  graphRelations,
  repoRoot: null,
  now: () => '2026-02-04T00:00:00.000Z'
});

const first = build();
const second = build();

assert.deepStrictEqual(second, first);
console.log('architecture rules cache test passed');
