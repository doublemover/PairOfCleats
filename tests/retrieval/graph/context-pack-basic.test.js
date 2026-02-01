#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildGraphContextPack } from '../../../src/graph/context-pack.js';
import { validateGraphContextPack } from '../../../src/contracts/validators/analysis.js';

const fixturePath = path.join(
  process.cwd(),
  'tests',
  'fixtures',
  'graph',
  'context-pack',
  'basic.json'
);
const graphRelations = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const pack = buildGraphContextPack({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  graphRelations,
  direction: 'out',
  depth: 1,
  caps: {
    maxDepth: 2,
    maxFanoutPerNode: 10,
    maxNodes: 10,
    maxEdges: 10,
    maxPaths: 5,
    maxCandidates: 5,
    maxWorkUnits: 100
  },
  indexCompatKey: 'compat-basic'
});

const validation = validateGraphContextPack(pack);
if (!validation.ok) {
  console.error(`GraphContextPack validation failed: ${validation.errors.join('; ')}`);
  process.exit(1);
}

const nodeIds = pack.nodes.map((node) => node.ref?.chunkUid);
if (!nodeIds.includes('chunk-a') || !nodeIds.includes('chunk-b')) {
  console.error('Expected graph context pack to include seed and neighbor nodes.');
  process.exit(1);
}

if (pack.edges.length !== 1) {
  console.error('Expected exactly one call edge in graph context pack.');
  process.exit(1);
}

console.log('graph context pack basic test passed');
