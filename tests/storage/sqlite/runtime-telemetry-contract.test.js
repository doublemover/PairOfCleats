#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  checkpointSqliteWithTelemetry,
  recordSqliteCommitTelemetry,
  recordSqlitePlanTelemetry,
  recordSqliteWalSnapshot,
  resolveSqliteIngestPlan
} from '../../../src/storage/sqlite/utils.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const MB = 1024 * 1024;
const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'sqlite-runtime-telemetry-contract');
const dbPath = path.join(tempRoot, 'index.db');

await fsp.rm(tempRoot, { recursive: true, force: true });
await fsp.mkdir(tempRoot, { recursive: true });
await fsp.writeFile(dbPath, Buffer.alloc(4096));
await fsp.writeFile(`${dbPath}-wal`, Buffer.alloc(12 * 1024));
await fsp.writeFile(`${dbPath}-shm`, Buffer.alloc(1024));

const stats = {};
const plan = resolveSqliteIngestPlan({
  inputBytes: 600 * MB,
  repoBytes: 600 * MB,
  rowCount: 150_000,
  fileCount: 1200,
  pageSize: 8192,
  journalMode: 'wal',
  walEnabled: true,
  walBytes: 32 * MB
});
recordSqlitePlanTelemetry(stats, plan, { source: 'contract-test' });
recordSqliteWalSnapshot(stats, {
  stage: 'before',
  dbPath,
  pageSize: plan.pageSize,
  journalMode: plan.journalMode,
  walEnabled: plan.walEnabled,
  walPressure: plan.walPressure,
  source: 'contract-test'
});
recordSqliteCommitTelemetry(stats, {
  stage: 'commit',
  durationMs: 250,
  dbPath,
  pageSize: plan.pageSize,
  journalMode: plan.journalMode,
  walEnabled: plan.walEnabled,
  walPressure: plan.walPressure,
  source: 'contract-test'
});

const fakeDb = {
  pragma(sql) {
    if (sql !== 'wal_checkpoint(TRUNCATE)') {
      throw new Error(`Unexpected pragma: ${sql}`);
    }
    fs.writeFileSync(`${dbPath}-wal`, Buffer.alloc(0));
    return [{ busy: 0, log: 0, checkpointed: 0 }];
  }
};

checkpointSqliteWithTelemetry(fakeDb, {
  stats,
  dbPath,
  stage: 'checkpoint',
  pageSize: plan.pageSize,
  journalMode: plan.journalMode,
  walEnabled: plan.walEnabled,
  walPressure: plan.walPressure,
  source: 'contract-test'
});

assert.equal(stats.runtimeTelemetry.plan.source, 'contract-test');
assert.equal(stats.runtimeTelemetry.plan.telemetry.planVersion, 1);
assert.equal(stats.runtimeTelemetry.walSnapshots.length, 2, 'expected before and post-checkpoint snapshots');
assert.equal(stats.runtimeTelemetry.commits.length, 1, 'expected one commit sample');
assert.equal(stats.runtimeTelemetry.checkpoints.length, 1, 'expected one checkpoint sample');
assert.equal(stats.runtimeTelemetry.commits[0].durationMs, 250, 'expected commit duration sample');
assert.equal(
  stats.runtimeTelemetry.checkpoints[0].after.walBytes,
  0,
  'expected checkpoint sample to capture truncated WAL'
);
assert.equal(stats.runtimeTelemetry.stallCounts.commit, 1, 'expected slow commit to increment stall count');

console.log('sqlite runtime telemetry contract test passed');
