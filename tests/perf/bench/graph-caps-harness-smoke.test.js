#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGraphCapsHarness } from '../../../tools/bench/graph-caps-harness.js';

const fixturePath = path.join(
  process.cwd(),
  'tests',
  'fixtures',
  'graph',
  'context-pack',
  'basic.json'
);
const graphRelations = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-caps-'));

const result = await runGraphCapsHarness({
  graphRelations,
  outDir,
  depth: 1,
  caps: { maxFanoutPerNode: 5, maxNodes: 10, maxEdges: 10 }
});

assert(fs.existsSync(result.outputPath), 'expected harness output file');
const payload = JSON.parse(fs.readFileSync(result.outputPath, 'utf8'));
assert(payload.graphStats, 'expected graphStats in harness output');
assert(Array.isArray(payload.samples), 'expected samples array in harness output');

console.log('graph caps harness smoke test passed');
