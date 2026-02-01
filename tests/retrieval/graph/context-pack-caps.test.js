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
  'caps.json'
);
const graphRelations = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const pack = buildGraphContextPack({
  seed: { type: 'chunk', chunkUid: 'seed' },
  graphRelations,
  direction: 'out',
  depth: 1,
  caps: {
    maxDepth: 1,
    maxFanoutPerNode: 2,
    maxNodes: 3,
    maxEdges: 2,
    maxPaths: 1,
    maxCandidates: 5,
    maxWorkUnits: 100
  },
  indexCompatKey: 'compat-caps'
});

const validation = validateGraphContextPack(pack);
if (!validation.ok) {
  console.error(`GraphContextPack validation failed: ${validation.errors.join('; ')}`);
  process.exit(1);
}

if (!Array.isArray(pack.truncation) || !pack.truncation.length) {
  console.error('Expected truncation metadata when caps are exceeded.');
  process.exit(1);
}

const caps = new Set(pack.truncation.map((entry) => entry.cap));
if (!caps.has('maxFanoutPerNode') && !caps.has('maxEdges') && !caps.has('maxNodes')) {
  console.error('Expected truncation record for graph caps.');
  process.exit(1);
}

console.log('graph context pack caps test passed');
