#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const sloBudgetsPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-slo-budgets.json');
const sloBudgets = JSON.parse(fs.readFileSync(sloBudgetsPath, 'utf8'));
const rows = Array.isArray(sloBudgets.rows) ? sloBudgets.rows : [];

assert.equal(rows.length > 0, true, 'slo-budgets matrix must contain rows');

const rowByLaneId = new Map();
for (const row of rows) {
  assert.equal(rowByLaneId.has(row.laneId), false, `slo-budgets laneId must be unique: ${row.laneId}`);
  rowByLaneId.set(row.laneId, row);

  assert.equal(Number.isFinite(row.maxDurationMs) && row.maxDurationMs > 0, true, `slo-budgets maxDurationMs must be positive: ${row.laneId}`);
  assert.equal(Number.isFinite(row.maxMemoryMb) && row.maxMemoryMb > 0, true, `slo-budgets maxMemoryMb must be positive: ${row.laneId}`);
  assert.equal(Number.isFinite(row.maxParserTimePerSegmentMs) && row.maxParserTimePerSegmentMs > 0, true, `slo-budgets maxParserTimePerSegmentMs must be positive: ${row.laneId}`);
  assert.equal(Number.isFinite(row.maxUnknownKindRate) && row.maxUnknownKindRate >= 0 && row.maxUnknownKindRate <= 1, true, `slo-budgets maxUnknownKindRate must be [0,1]: ${row.laneId}`);
  assert.equal(Number.isFinite(row.maxUnresolvedRate) && row.maxUnresolvedRate >= 0 && row.maxUnresolvedRate <= 1, true, `slo-budgets maxUnresolvedRate must be [0,1]: ${row.laneId}`);
}

const requiredBatchRows = [
  { laneId: 'lang-batch-b1', scopeId: 'B1' },
  { laneId: 'lang-batch-b2', scopeId: 'B2' },
  { laneId: 'lang-batch-b3', scopeId: 'B3' },
  { laneId: 'lang-batch-b4', scopeId: 'B4' },
  { laneId: 'lang-batch-b5', scopeId: 'B5' },
  { laneId: 'lang-batch-b6', scopeId: 'B6' },
  { laneId: 'lang-batch-b7', scopeId: 'B7' }
];

for (const requiredRow of requiredBatchRows) {
  const row = rowByLaneId.get(requiredRow.laneId);
  assert.equal(Boolean(row), true, `slo-budgets missing required batch lane: ${requiredRow.laneId}`);
  assert.equal(row.profileScope, 'batch', `batch lane must use profileScope=batch: ${requiredRow.laneId}`);
  assert.equal(row.scopeId, requiredRow.scopeId, `batch lane scopeId mismatch: ${requiredRow.laneId}`);
  assert.equal(row.blocking, true, `batch lane must be blocking: ${requiredRow.laneId}`);
}

for (const requiredGlobalLane of ['ci', 'ci-long']) {
  const row = rowByLaneId.get(requiredGlobalLane);
  assert.equal(Boolean(row), true, `slo-budgets missing required global lane: ${requiredGlobalLane}`);
  assert.equal(row.profileScope, 'global', `global lane must use profileScope=global: ${requiredGlobalLane}`);
  assert.equal(row.blocking, true, `global lane must be blocking: ${requiredGlobalLane}`);
}

console.log('usr batch SLO threshold coverage validation checks passed');
