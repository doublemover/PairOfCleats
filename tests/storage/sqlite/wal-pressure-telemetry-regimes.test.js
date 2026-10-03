#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveSqliteIngestPlan } from '../../../src/storage/sqlite/utils.js';

const MB = 1024 * 1024;

const makePlan = (walBytes) => resolveSqliteIngestPlan({
  inputBytes: 700 * MB,
  repoBytes: 700 * MB,
  rowCount: 250_000,
  fileCount: 1500,
  pageSize: 4096,
  journalMode: 'wal',
  walEnabled: true,
  walBytes
});

const nonePlan = makePlan(0);
const mediumPlan = makePlan(32 * MB);
const highPlan = makePlan(120 * MB);

assert.equal(nonePlan.telemetry.walPressure, 'none', 'expected none regime');
assert.equal(mediumPlan.telemetry.walPressure, 'medium', 'expected medium regime');
assert.equal(highPlan.telemetry.walPressure, 'high', 'expected high regime');
assert.ok(
  mediumPlan.batchSize < nonePlan.batchSize,
  'expected medium WAL pressure to reduce batch size'
);
assert.ok(
  highPlan.batchSize < mediumPlan.batchSize,
  'expected high WAL pressure to reduce batch size further'
);
assert.ok(
  highPlan.transactionRows < mediumPlan.transactionRows,
  'expected high WAL pressure to reduce transaction rows'
);

console.log('sqlite WAL-pressure telemetry regimes test passed');
