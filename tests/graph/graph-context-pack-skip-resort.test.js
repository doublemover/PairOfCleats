#!/usr/bin/env node
import assert from 'node:assert';
import { renderGraphContextPack } from '../../src/retrieval/output/graph-context-pack.js';

const pack = {
  seed: { type: 'chunk', chunkUid: 'seed' },
  stats: { sorted: true },
  nodes: [
    { ref: { type: 'chunk', chunkUid: 'b' }, distance: 2 },
    { ref: { type: 'chunk', chunkUid: 'a' }, distance: 1 }
  ],
  edges: [
    {
      from: { type: 'chunk', chunkUid: 'b' },
      to: { type: 'chunk', chunkUid: 'a' },
      edgeType: 'call',
      graph: 'callGraph'
    },
    {
      from: { type: 'chunk', chunkUid: 'a' },
      to: { type: 'chunk', chunkUid: 'b' },
      edgeType: 'call',
      graph: 'callGraph'
    }
  ]
};

const output = renderGraphContextPack(pack).split('\n');
const nodeSection = output.indexOf('## Nodes');
const edgeSection = output.indexOf('## Edges');
assert(nodeSection !== -1 && edgeSection !== -1, 'expected node/edge sections');

const nodeLines = output.slice(nodeSection + 1, edgeSection).filter((line) => line.startsWith('-'));
const [firstNodeLine, secondNodeLine] = nodeLines;
assert(firstNodeLine.includes('chunk:b'), 'expected first node to remain b');
assert(secondNodeLine.includes('chunk:a'), 'expected second node to remain a');

const edgeLines = output.slice(edgeSection + 1).filter((line) => line.startsWith('-'));
const [firstEdgeLine, secondEdgeLine] = edgeLines;
assert(firstEdgeLine.includes('chunk:b') && firstEdgeLine.includes('chunk:a'));
assert(secondEdgeLine.includes('chunk:a') && secondEdgeLine.includes('chunk:b'));

console.log('graph context-pack sorted skip test passed');
