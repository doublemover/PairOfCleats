#!/usr/bin/env node
import { expandContext } from '../../../src/retrieval/context-expansion.js';

const neighborCount = 50;
const neighbors = Array.from({ length: neighborCount }, (_, index) => `c${index}`);
const chunkMeta = [
  { id: 0, chunkUid: 'seed', file: 'src/seed.js', name: 'seed' },
  ...neighbors.map((id, index) => ({
    id: index + 1,
    chunkUid: id,
    file: `src/${id}.js`,
    name: id
  }))
];

const graphRelations = {
  version: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  callGraph: {
    nodeCount: neighborCount + 1,
    edgeCount: neighborCount,
    nodes: [
      { id: 'seed', out: neighbors, in: [] },
      ...neighbors.map((id) => ({ id, out: [], in: ['seed'] }))
    ]
  },
  usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
};

const result = expandContext({
  hits: [{ id: 0 }],
  chunkMeta,
  graphRelations,
  options: {
    maxPerHit: 10,
    maxTotal: 10,
    maxWorkUnits: 3,
    includeCalls: true
  }
});

if (result.stats.workUnitsUsed > 3) {
  console.error('Expected work budget to bound candidate scans.');
  process.exit(1);
}

const caps = new Set((result.stats.truncation || []).map((entry) => entry.cap));
if (!caps.has('maxWorkUnits')) {
  console.error('Expected truncation to record maxWorkUnits.');
  process.exit(1);
}

console.log('context expansion work budget test passed');
