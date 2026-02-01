#!/usr/bin/env node
import assert from 'node:assert';
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

const impact = buildImpactAnalysis({
  seed: { type: 'chunk', chunkUid: 'chunk-b' },
  graphRelations,
  direction: 'upstream',
  depth: 1,
  caps: { maxWorkUnits: 100 },
  indexCompatKey: 'compat-impact-upstream'
});

const impacted = impact.impacted.map((entry) => entry.ref?.chunkUid).filter(Boolean);
assert(impacted.includes('chunk-a'), 'expected chunk-a to be impacted upstream');

console.log('impact analysis upstream test passed');
