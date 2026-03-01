#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { buildGraphIndex } from '../../src/graph/store.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const seed = { type: 'chunk', chunkUid: 'chunk-a' };

const graphRelations = {
  version: 1,
  generatedAt: '2026-02-01T00:00:00.000Z',
  callGraph: {
    nodeCount: 3,
    edgeCount: 4,
    nodes: [
      { id: 'chunk-a', out: ['chunk-b', 'chunk-c', 'chunk-c'], in: ['chunk-b'] },
      { id: 'chunk-b', out: ['chunk-a'], in: ['chunk-a'] },
      { id: 'chunk-c', out: [], in: ['chunk-a'] }
    ]
  },
  usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
};

const buildLegacy = (direction) => buildGraphNeighborhood({
  seed,
  graphRelations: JSON.parse(JSON.stringify(graphRelations)),
  direction,
  depth: 2,
  includePaths: true,
  caps: {
    maxDepth: 3,
    maxFanoutPerNode: 25,
    maxNodes: 50,
    maxEdges: 50,
    maxPaths: 25,
    maxWorkUnits: 1000
  }
});

const graphIndex = buildGraphIndex({
  graphRelations: JSON.parse(JSON.stringify(graphRelations)),
  repoRoot: null,
  includeCsr: true
});

const buildCsr = (direction) => buildGraphNeighborhood({
  seed,
  graphIndex,
  direction,
  depth: 2,
  includePaths: true,
  caps: {
    maxDepth: 3,
    maxFanoutPerNode: 25,
    maxNodes: 50,
    maxEdges: 50,
    maxPaths: 25,
    maxWorkUnits: 1000
  }
});

const stripStats = (value) => {
  const cloned = JSON.parse(JSON.stringify(value));
  delete cloned.stats;
  return cloned;
};

for (const direction of ['out', 'in', 'both']) {
  const legacy = stripStats(buildLegacy(direction));
  const csrFirst = stripStats(buildCsr(direction));
  const csrSecond = stripStats(buildCsr(direction));

  assert.deepStrictEqual(csrFirst, legacy, `expected CSR=${direction} to match legacy output`);
  assert.deepStrictEqual(csrSecond, legacy, `expected CSR cache=${direction} to preserve output determinism`);
}

console.log('graph CSR neighbors determinism test passed');

