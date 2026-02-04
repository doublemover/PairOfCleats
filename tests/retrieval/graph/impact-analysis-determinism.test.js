#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildImpactAnalysis } from '../../../src/graph/impact.js';

const fixturePath = path.join(
  process.cwd(),
  'tests',
  'fixtures',
  'graph',
  'impact',
  'basic.json'
);
const graphRelations = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const buildOnce = () => buildImpactAnalysis({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  graphRelations,
  direction: 'downstream',
  depth: 1,
  caps: { maxWorkUnits: 100 },
  indexCompatKey: 'compat-impact-determinism',
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
  console.error('Expected deterministic impact analysis output.');
  process.exit(1);
}

console.log('impact analysis determinism test passed');
