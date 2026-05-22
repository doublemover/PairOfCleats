#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import { incrementalUpdateDatabase } from '../../../src/storage/sqlite/build/incremental-update.js';
import { resolveSqliteBatchSize, resolveSqliteIngestPlan } from '../../../src/storage/sqlite/utils.js';

import {
  addChangedBundle,
  setupIncrementalBundleDatabase
} from './helpers/incremental-bundle-db-fixture.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error(`better-sqlite3 missing: ${err?.message || err}`);
  process.exit(1);
}

const chunksPerFile = 3;
const {
  bundleDir,
  files,
  manifest,
  outPath
} = await setupIncrementalBundleDatabase({
  Database,
  name: 'sqlite-incremental-transaction-boundary',
  fileCount: 4,
  chunksPerFile
});

const { updatedManifest } = await addChangedBundle({
  bundleDir,
  chunksPerFile,
  files,
  manifest,
  changedFileIndex: 1
});

const probeSqliteRuntime = (dbPath) => {
  const runtime = {
    pageSize: 4096,
    journalMode: null,
    walEnabled: false,
    walBytes: 0,
    dbBytes: 0
  };
  try {
    runtime.dbBytes = Number(fsSync.statSync(dbPath).size) || 0;
  } catch {}
  try {
    runtime.walBytes = Number(fsSync.statSync(`${dbPath}-wal`).size) || 0;
  } catch {}
  let db = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const pageSize = Number(db.pragma('page_size', { simple: true }));
    if (Number.isFinite(pageSize) && pageSize > 0) {
      runtime.pageSize = Math.max(512, Math.floor(pageSize));
    }
    const journalModeRaw = db.pragma('journal_mode', { simple: true });
    runtime.journalMode = typeof journalModeRaw === 'string'
      ? journalModeRaw.trim().toLowerCase()
      : null;
    runtime.walEnabled = runtime.journalMode === 'wal' || runtime.walBytes > 0;
  } catch {
    runtime.walEnabled = runtime.walBytes > 0;
  } finally {
    try { db?.close(); } catch {}
  }
  return runtime;
};

const runtime = probeSqliteRuntime(outPath);
const adaptiveBatchConfig = {
  requested: null,
  pageSize: runtime.pageSize,
  journalMode: runtime.journalMode,
  walEnabled: true,
  walBytes: Math.max(runtime.walBytes, 32 * 1024 * 1024),
  rowCount: files.length * chunksPerFile,
  fileCount: files.length,
  inputBytes: runtime.dbBytes,
  repoBytes: runtime.dbBytes
};
const adaptivePlan = resolveSqliteIngestPlan({ batchSize: adaptiveBatchConfig });
assert.equal(
  adaptivePlan.batchSize,
  resolveSqliteBatchSize({ batchSize: adaptiveBatchConfig }),
  'expected adaptive plan batch size to match resolveSqliteBatchSize'
);
const smallRepoPlan = resolveSqliteIngestPlan({
  rowCount: chunksPerFile,
  fileCount: 1,
  pageSize: runtime.pageSize,
  walEnabled: false,
  walBytes: 0
});
assert.ok(
  adaptivePlan.transactionRows <= smallRepoPlan.transactionRows,
  'expected larger repo hints to reduce transaction row boundaries'
);
assert.ok(adaptivePlan.filesPerTransaction >= 1, 'expected adaptive filesPerTransaction to be set');

const stats = {};
const updateResult = await incrementalUpdateDatabase({
  Database,
  outPath,
  mode: 'code',
  incrementalData: { manifest: updatedManifest, bundleDir },
  modelConfig: { id: null },
  vectorConfig: { enabled: false },
  emitOutput: false,
  validateMode: 'off',
  inputBytes: runtime.dbBytes,
  batchSize: adaptiveBatchConfig,
  stats
});

if (!updateResult.used) {
  console.error(`Incremental update skipped: ${updateResult.reason || 'unknown reason'}`);
  process.exit(1);
}
assert.equal(stats.batchSize, adaptivePlan.batchSize, 'expected adaptive batch size to flow into incremental update stats');
assert.ok(stats.transactionPhases?.deletes, 'expected delete transaction phase to run');
assert.ok(stats.transactionPhases?.inserts, 'expected insert transaction phase to run');
assert.equal(
  stats.runtimeTelemetry?.plan?.source,
  'incremental',
  'expected incremental plan telemetry to be recorded'
);
assert.equal(
  stats.runtimeTelemetry?.plan?.walPressure,
  adaptivePlan.walPressure,
  'expected incremental telemetry to preserve wal pressure'
);
assert.ok(
  Array.isArray(stats.runtimeTelemetry?.walSnapshots) && stats.runtimeTelemetry.walSnapshots.length >= 1,
  'expected incremental telemetry to record WAL snapshots'
);
assert.ok(
  Array.isArray(stats.runtimeTelemetry?.checkpoints) && stats.runtimeTelemetry.checkpoints.length >= 1,
  'expected incremental telemetry to record checkpoint samples'
);

console.log('sqlite incremental transaction boundary test passed');
