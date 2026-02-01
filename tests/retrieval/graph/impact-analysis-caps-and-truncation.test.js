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
  'caps.json'
);
const graphRelations = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const impact = buildImpactAnalysis({
  seed: { type: 'chunk', chunkUid: 'seed' },
  graphRelations,
  direction: 'downstream',
  depth: 1,
  caps: { maxFanoutPerNode: 2, maxWorkUnits: 100 },
  indexCompatKey: 'compat-impact-caps'
});

const truncation = impact.truncation || [];
const hasCap = truncation.some((record) => record.cap === 'maxFanoutPerNode');
assert(hasCap, 'expected truncation record for maxFanoutPerNode');

console.log('impact analysis caps/truncation test passed');
