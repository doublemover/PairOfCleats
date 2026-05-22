#!/usr/bin/env node
import fsSync from 'node:fs';
import { performance } from 'node:perf_hooks';
import { buildDatabaseFromBundles } from '../../../src/storage/sqlite/build/from-bundles.js';
import { incrementalUpdateDatabase } from '../../../src/storage/sqlite/build/incremental-update.js';
import { resolveSqliteIngestPlan } from '../../../src/storage/sqlite/utils.js';
import { parseSimpleBenchArgs, resolveCompareMode } from '../shared.js';
import {
  createSqliteBenchBundleFixture,
  createSqliteBenchWorkspace,
  loadSqliteBenchDatabase,
  requireSqliteDb,
  writeSqliteBenchBundle
} from './shared.js';

const Database = await loadSqliteBenchDatabase();
const args = parseSimpleBenchArgs();
const fileCount = Number(args.files) || 12;
const chunksPerFile = Number(args.chunks) || 6;
const mode = resolveCompareMode(args.mode);

const { bundleDir, outPathBaseline, outPathCurrent } = await createSqliteBenchWorkspace({
  name: 'sqlite-incremental-update'
});
const { manifest, buildChunks } = await createSqliteBenchBundleFixture({
  bundleDir,
  fileCount,
  chunksPerFile
});

const envConfig = { bundleThreads: 1 };
const threadLimits = { fileConcurrency: 1 };

const updatedManifest = { files: { ...manifest.files } };
const changedFile = `src/file-${Math.min(2, fileCount - 1)}.js`;
const changedBundleName = 'bundle-changed.json';
await writeSqliteBenchBundle({
  bundleDir,
  bundleName: changedBundleName,
  chunks: buildChunks(changedFile, 'v2')
});
updatedManifest.files[changedFile] = {
  ...updatedManifest.files[changedFile],
  hash: 'hash-changed',
  mtimeMs: 9999,
  bundle: changedBundleName
};

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
  if (!fsSync.existsSync(dbPath)) {
    runtime.walEnabled = runtime.walBytes > 0;
    return runtime;
  }
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

const resolveAdaptiveBatchConfig = ({ outPath, rowCount, fileCount }) => {
  const runtime = probeSqliteRuntime(outPath);
  const config = {
    requested: null,
    pageSize: runtime.pageSize,
    journalMode: runtime.journalMode,
    walEnabled: runtime.walEnabled,
    walBytes: runtime.walBytes,
    rowCount,
    fileCount,
    inputBytes: runtime.dbBytes,
    repoBytes: runtime.dbBytes
  };
  const plan = resolveSqliteIngestPlan({ batchSize: config });
  return { config, plan };
};

const buildBaselineDatabase = async ({ outPath, buildPragmas, optimize }) => {
  await buildDatabaseFromBundles({
    Database,
    outPath,
    mode: 'code',
    incrementalData: { manifest, bundleDir },
    envConfig,
    threadLimits,
    emitOutput: false,
    validateMode: 'off',
    vectorConfig: { enabled: false },
    modelConfig: { id: null },
    buildPragmas,
    optimize
  });
};

const runUpdate = async ({ label, outPath, buildPragmas }) => {
  requireSqliteDb(outPath, 'Expected sqlite DB to be created before incremental update.');

  const adaptive = resolveAdaptiveBatchConfig({
    outPath,
    rowCount: fileCount * chunksPerFile,
    fileCount
  });
  const stats = {};
  const start = performance.now();
  const updateResult = await incrementalUpdateDatabase({
    Database,
    outPath,
    mode: 'code',
    incrementalData: { manifest: updatedManifest, bundleDir },
    modelConfig: { id: null },
    vectorConfig: { enabled: false },
    emitOutput: false,
    validateMode: 'off',
    inputBytes: adaptive.plan.repoBytes,
    batchSize: adaptive.config,
    buildPragmas,
    stats
  });
  const durationMs = performance.now() - start;

  if (!updateResult.used) {
    console.error(`Incremental update skipped: ${updateResult.reason || 'unknown reason'}`);
    process.exit(1);
  }

  console.log(`[bench] incremental-update ${label} files=${fileCount} chunks=${updateResult.insertedChunks} ms=${durationMs.toFixed(1)}`);
  console.log(
    `[bench] ${label} ingest-plan ` +
    `batch=${adaptive.plan.batchSize} txRows=${adaptive.plan.transactionRows} ` +
    `txFiles=${adaptive.plan.filesPerTransaction} wal=${adaptive.plan.walPressure} ` +
    `page=${adaptive.plan.pageSize}`
  );
  if (stats.tables) {
    console.log(`[bench] ${label} tables`, stats.tables);
  }
  if (stats.transactionPhases) {
    console.log(`[bench] ${label} transaction-phases`, stats.transactionPhases);
  }
  return { durationMs, insertedChunks: updateResult.insertedChunks };
};

let baselineResult = null;
let currentResult = null;
if (mode !== 'current') {
  await buildBaselineDatabase({
    outPath: outPathBaseline,
    buildPragmas: false,
    optimize: false
  });
  baselineResult = await runUpdate({
    label: 'baseline',
    outPath: outPathBaseline,
    buildPragmas: false
  });
}
if (mode !== 'baseline') {
  await buildBaselineDatabase({
    outPath: outPathCurrent,
    buildPragmas: true,
    optimize: true
  });
  currentResult = await runUpdate({
    label: 'current',
    outPath: outPathCurrent,
    buildPragmas: true
  });
}
if (baselineResult && currentResult) {
  const deltaMs = currentResult.durationMs - baselineResult.durationMs;
  const deltaPct = baselineResult.durationMs > 0
    ? (deltaMs / baselineResult.durationMs) * 100
    : null;
  console.log(`[bench] delta ms=${deltaMs.toFixed(1)} (${deltaPct?.toFixed(1)}%)`);
}
