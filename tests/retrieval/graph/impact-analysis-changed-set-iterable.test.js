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
  changed: new Set(['src/changed.js']),
  graphRelations,
  direction: 'downstream',
  depth: 1,
  caps: { maxWorkUnits: 100 },
  indexCompatKey: 'compat-impact-changed-iterable'
});

assert(impact.seed?.type === 'file', 'expected file seed derived from changed iterable');
assert(impact.seed?.path === 'src/changed.js', 'expected iterable changed path to normalize correctly');
assert(impact.impacted.some((entry) => entry.ref?.path === 'src/target.js'), 'expected impacted file');

console.log('impact analysis changed-set iterable test passed');
