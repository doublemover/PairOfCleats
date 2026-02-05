#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildGraphContextPack } from '../../../src/graph/context-pack.js';

const fixturePath = path.join(
  process.cwd(),
  'tests',
  'fixtures',
  'graph',
  'context-pack',
  'basic.json'
);
const graphRelations = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const buildOnce = () => buildGraphContextPack({
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
  indexCompatKey: 'compat-determinism',
  now: () => '2026-02-01T00:00:00.000Z'
});

const stripStats = (value) => {
  if (!value || typeof value !== 'object') return value;
  const cloned = JSON.parse(JSON.stringify(value));
  delete cloned.stats;
  return cloned;
};

const first = JSON.stringify(stripStats(buildOnce()));
const second = JSON.stringify(stripStats(buildOnce()));

if (first !== second) {
  console.error('Expected deterministic graph context pack output.');
  process.exit(1);
}

console.log('graph context pack determinism test passed');
