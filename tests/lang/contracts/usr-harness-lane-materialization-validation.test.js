#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRunRules } from '../../runner/run-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const runRules = loadRunRules({ root: repoRoot });
const knownLanes = runRules?.knownLanes instanceof Set ? runRules.knownLanes : new Set();

for (const lane of [
  'ci',
  'ci-lite',
  'ci-long',
  'smoke',
  'conformance-c4',
  'batch-b0',
  'batch-b1',
  'batch-b2',
  'batch-b3',
  'batch-b4',
  'batch-b5',
  'batch-b6',
  'batch-b7',
  'batch-b8',
  'observability',
  'security-gates',
  'failure-injection',
  'fixture-governance',
  'benchmark-regression',
  'threat-model',
  'waiver-enforcement',
  'implementation-readiness',
  'decomposed-drift',
  'backcompat'
]) {
  assert.equal(knownLanes.has(lane), true, `run harness knownLanes must include required lane: ${lane}`);
}

const laneMaterializationMap = {
  ci: 'ci',
  'ci-long': 'ci-long',
  'lang-smoke': 'smoke',
  'lang-framework-c4': 'conformance-c4',
  'lang-batch-b1': 'batch-b1',
  'lang-batch-b2': 'batch-b2',
  'lang-batch-b3': 'batch-b3',
  'lang-batch-b4': 'batch-b4',
  'lang-batch-b5': 'batch-b5',
  'lang-batch-b6': 'batch-b6',
  'lang-batch-b7': 'batch-b7',
  'batch-b0': 'batch-b0',
  'batch-b1': 'batch-b1',
  'batch-b2': 'batch-b2',
  'batch-b3': 'batch-b3',
  'batch-b4': 'batch-b4',
  'batch-b5': 'batch-b5',
  'batch-b6': 'batch-b6',
  'batch-b7': 'batch-b7',
  'batch-b8': 'batch-b8'
};

const loadRows = (fileName) => {
  const payload = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'tests', 'lang', 'matrix', fileName), 'utf8')
  );
  return Array.isArray(payload.rows) ? payload.rows : [];
};

const laneIds = new Set();
for (const row of loadRows('usr-slo-budgets.json')) {
  if (row.laneId) laneIds.add(row.laneId);
}
for (const row of loadRows('usr-benchmark-policy.json')) {
  if (row.laneId) laneIds.add(row.laneId);
}
for (const row of loadRows('usr-language-batch-shards.json')) {
  if (row.laneId) laneIds.add(row.laneId);
}

for (const laneId of laneIds) {
  const materializedLane = laneMaterializationMap[laneId];
  assert.equal(typeof materializedLane === 'string' && materializedLane.length > 0, true, `lane materialization mapping missing for contract lane: ${laneId}`);
  assert.equal(knownLanes.has(materializedLane), true, `contract lane ${laneId} maps to unknown harness lane ${materializedLane}`);
}

const ciOrderPath = path.join(repoRoot, 'tests', 'ci', 'ci.order.txt');
const ciLiteOrderPath = path.join(repoRoot, 'tests', 'ci-lite', 'ci-lite.order.txt');
assert.equal(fs.existsSync(ciOrderPath), true, 'ci lane order file must exist');
assert.equal(fs.existsSync(ciLiteOrderPath), true, 'ci-lite lane order file must exist');
assert.equal(fs.readFileSync(ciOrderPath, 'utf8').trim().length > 0, true, 'ci lane order file must be non-empty');
assert.equal(fs.readFileSync(ciLiteOrderPath, 'utf8').trim().length > 0, true, 'ci-lite lane order file must be non-empty');

console.log('usr harness lane materialization validation checks passed');
