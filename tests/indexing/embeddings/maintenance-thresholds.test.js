#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  normalizeEmbeddingsMaintenanceConfig,
  shouldQueueSqliteMaintenance
} from '../../../tools/build/embeddings/maintenance.js';

const defaults = normalizeEmbeddingsMaintenanceConfig({});
assert.equal(defaults.background, true, 'expected maintenance background enabled by default');
assert.equal(defaults.sqliteWalMaxBytes, 128 * 1024 * 1024, 'expected default sqlite WAL threshold');
assert.equal(defaults.sqliteMinDbBytes, 512 * 1024 * 1024, 'expected default sqlite db threshold');
assert.equal(defaults.sqliteMinDenseCount, 100000, 'expected default dense count threshold');

const defaultThresholdTriggered = shouldQueueSqliteMaintenance({
  config: {},
  dbBytes: 9e9,
  walBytes: 9e9,
  denseCount: 9e9
});
assert.deepEqual(
  defaultThresholdTriggered,
  { queue: true, reason: 'wal-threshold' },
  'expected default thresholds to trigger maintenance'
);

const walTriggered = shouldQueueSqliteMaintenance({
  config: {
    background: true,
    sqliteWalMaxBytes: 1024,
    sqliteMinDbBytes: 2048,
    sqliteMinDenseCount: 10
  },
  dbBytes: 100,
  walBytes: 1024,
  denseCount: 0
});
assert.deepEqual(
  walTriggered,
  { queue: true, reason: 'wal-threshold' },
  'expected WAL threshold maintenance trigger'
);

const denseTriggered = shouldQueueSqliteMaintenance({
  config: {
    background: true,
    sqliteWalMaxBytes: 999999,
    sqliteMinDbBytes: 5000,
    sqliteMinDenseCount: 5
  },
  dbBytes: 5000,
  walBytes: 0,
  denseCount: 5
});
assert.deepEqual(
  denseTriggered,
  { queue: true, reason: 'db-and-dense-threshold' },
  'expected db+dense threshold maintenance trigger'
);

const belowThreshold = shouldQueueSqliteMaintenance({
  config: {
    background: true,
    sqliteWalMaxBytes: 999999,
    sqliteMinDbBytes: 5000,
    sqliteMinDenseCount: 5
  },
  dbBytes: 4000,
  walBytes: 100,
  denseCount: 4
});
assert.deepEqual(
  belowThreshold,
  { queue: false, reason: 'below-threshold' },
  'expected no trigger below thresholds'
);

console.log('embeddings maintenance thresholds test passed');
