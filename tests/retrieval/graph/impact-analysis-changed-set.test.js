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
  'changed.json'
);
const graphRelations = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const impact = buildImpactAnalysis({
  changed: ['src/changed.js'],
  graphRelations,
  direction: 'downstream',
  depth: 1,
  caps: { maxWorkUnits: 100 },
  indexCompatKey: 'compat-impact-changed'
});

assert(impact.seed?.type === 'file', 'expected file seed derived from changed list');
assert(impact.seed?.path === 'src/changed.js', 'expected seed path to match changed input');

const impacted = impact.impacted.map((entry) => entry.ref?.path).filter(Boolean);
assert(impacted.includes('src/target.js'), 'expected changed set to impact target file');

console.log('impact analysis changed-set test passed');
