#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { buildGraphNeighborhood } from '../../../src/graph/neighborhood.js';

const fixturePath = path.join(
  process.cwd(),
  'tests',
  'fixtures',
  'graph',
  'context-pack',
  'caps.json'
);
const graphRelations = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const neighborhood = buildGraphNeighborhood({
  seed: { type: 'chunk', chunkUid: 'seed' },
  graphRelations,
  direction: 'out',
  depth: 1,
  caps: { maxFanoutPerNode: 2, maxNodes: 3, maxEdges: 2 }
});

const truncation = neighborhood.truncation || [];
assert(truncation.some((entry) => entry.cap === 'maxFanoutPerNode' || entry.cap === 'maxNodes' || entry.cap === 'maxEdges'),
  'expected truncation record when caps are hit');

console.log('graph caps enforced test passed');
