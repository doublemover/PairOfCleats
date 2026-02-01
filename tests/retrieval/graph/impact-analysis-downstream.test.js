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
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  graphRelations,
  direction: 'downstream',
  depth: 1,
  caps: { maxWorkUnits: 100 },
  indexCompatKey: 'compat-impact-basic'
});

const impacted = impact.impacted.map((entry) => entry.ref?.chunkUid).filter(Boolean);
assert(impacted.includes('chunk-b'), 'expected chunk-b to be impacted downstream');

const entry = impact.impacted.find((item) => item.ref?.chunkUid === 'chunk-b');
assert(entry?.witnessPath?.nodes?.length >= 2, 'expected witness path for impacted node');

console.log('impact analysis downstream test passed');
