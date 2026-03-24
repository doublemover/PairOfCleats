#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveSqliteBatchSize, resolveSqliteIngestPlan } from '../../../src/storage/sqlite/utils.js';

const MB = 1024 * 1024;

assert.equal(resolveSqliteBatchSize({ batchSize: 10 }), 50, 'min clamp expected');
assert.equal(resolveSqliteBatchSize({ batchSize: 5000 }), 2000, 'max clamp expected');

assert.equal(resolveSqliteBatchSize({ inputBytes: 3000 * MB }), 200, 'large inputBytes should reduce batch size');
assert.equal(resolveSqliteBatchSize({ inputBytes: 700 * MB }), 400, 'mid inputBytes should reduce batch size');
assert.equal(resolveSqliteBatchSize({ inputBytes: 200 * MB }), 700, 'smaller inputBytes should reduce batch size');
assert.equal(resolveSqliteBatchSize({ inputBytes: 10 * MB }), 1000, 'small inputBytes should keep default');

assert.equal(
  resolveSqliteBatchSize({ inputBytes: 200 * MB, rowCount: 1_000_000 }),
  200,
  'rowCount should cap batch size'
);
assert.equal(
  resolveSqliteBatchSize({ inputBytes: 200 * MB, rowCount: 100_000 }),
  700,
  'rowCount should not increase batch size'
);

const walPlan = resolveSqliteIngestPlan({
  inputBytes: 200 * MB,
  pageSize: 4096,
  journalMode: 'wal',
  walEnabled: true,
  walBytes: 32 * MB,
  rowCount: 100_000,
  fileCount: 500
});
assert.equal(walPlan.telemetry.planVersion, 1, 'expected telemetry plan version');
assert.equal(walPlan.telemetry.walPressure, 'medium', 'expected telemetry wal pressure');
assert.ok(
  walPlan.telemetry.batchAdjustments.some((entry) => entry.reason === 'wal_pressure_medium'),
  'expected telemetry batch adjustments to retain wal-pressure rationale'
);

const requestedPlan = resolveSqliteIngestPlan({
  batchSize: {
    requested: 321,
    pageSize: 4096,
    journalMode: 'wal',
    walEnabled: true,
    walBytes: 12 * MB
  }
});
assert.equal(requestedPlan.batchSize, 321, 'expected requested override to win');
assert.equal(requestedPlan.telemetry.requestedOverride, true, 'expected requested override flag');
assert.deepEqual(
  requestedPlan.telemetry.batchAdjustments,
  [{ kind: 'requested', factor: 1, reason: 'requested_batch_size' }],
  'expected requested override rationale to be preserved'
);

console.log('sqlite batch size adaptive test passed');
