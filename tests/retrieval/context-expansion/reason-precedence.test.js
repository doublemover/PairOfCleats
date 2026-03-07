#!/usr/bin/env node
import { expandContext } from '../../../src/retrieval/context-expansion.js';

const chunkMeta = [
  { id: 0, chunkUid: 'seed', file: 'src/a.js', name: 'alpha' },
  { id: 1, chunkUid: 'target', file: 'src/b.js', name: 'beta' }
];

const graphRelations = {
  version: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  callGraph: {
    nodeCount: 2,
    edgeCount: 1,
    nodes: [
      { id: 'seed', out: ['target'], in: [] },
      { id: 'target', out: [], in: ['seed'] }
    ]
  },
  usageGraph: {
    nodeCount: 2,
    edgeCount: 1,
    nodes: [
      { id: 'seed', out: ['target'], in: [] },
      { id: 'target', out: [], in: ['seed'] }
    ]
  },
  importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
};

const result = expandContext({
  hits: [{ id: 0 }],
  chunkMeta,
  graphRelations,
  options: {
    maxPerHit: 5,
    maxTotal: 5,
    includeCalls: true,
    includeUsages: true
  }
});

const firstReason = result.contextHits[0]?.context?.reason || '';
if (!firstReason.startsWith('call')) {
  console.error('Expected call reason to take precedence over usage.');
  process.exit(1);
}

console.log('context expansion reason precedence test passed');
