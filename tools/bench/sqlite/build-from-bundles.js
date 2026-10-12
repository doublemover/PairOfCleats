#!/usr/bin/env node
import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import { performance } from 'node:perf_hooks';
const { buildDatabaseFromBundles } = await import('../../../src/storage/sqlite/build/from-bundles.js');
const { parseSimpleBenchArgs, resolveCompareMode } = await import('../shared.js');
const {
  createSqliteBenchBundleFixture,
  createSqliteBenchWorkspace,
  loadSqliteBenchDatabase,
  requireSqliteDb
} = await import('./shared.js');

const Database = await loadSqliteBenchDatabase();
const args = parseSimpleBenchArgs();
const fileCount = Number(args.files) || 20;
const chunksPerFile = Number(args.chunks) || 6;
const benchMode = resolveCompareMode(args.mode);
const sqliteMode = ['code', 'prose', 'extracted-prose', 'records'].includes(
  String(args['sqlite-mode'] || '').toLowerCase()
)
  ? String(args['sqlite-mode']).toLowerCase()
  : 'code';

const { bundleDir, outPathBaseline, outPathCurrent } = await createSqliteBenchWorkspace({
  name: 'sqlite-build-from-bundles',
  sqliteMode
});
const { manifest } = await createSqliteBenchBundleFixture({
  bundleDir,
  fileCount,
  chunksPerFile,
  sqliteMode
});

const envConfig = { bundleThreads: 1 };
const threadLimits = { fileConcurrency: 1 };
const runBuild = async ({ label, outPath, buildPragmas, optimize }) => {
  const stats = {};
  const start = performance.now();
  const result = await buildDatabaseFromBundles({
    Database,
    outPath,
    mode: sqliteMode,
    incrementalData: { manifest, bundleDir },
    envConfig,
    threadLimits,
    emitOutput: false,
    validateMode: 'off',
    vectorConfig: { enabled: false },
    modelConfig: { id: null },
    buildPragmas,
    optimize,
    stats
  });
  const durationMs = performance.now() - start;

  requireSqliteDb(outPath);

  console.log(
    `[bench] build-from-bundles ${label} mode=${sqliteMode} files=${fileCount} chunks=${result.count} ms=${durationMs.toFixed(1)}`
  );
  if (stats.pragmas) {
    console.log(`[bench] ${label} pragmas`, stats.pragmas);
  }
  if (stats.tables) {
    console.log(`[bench] ${label} tables`, stats.tables);
  }
  return { durationMs, count: result.count };
};

let baselineResult = null;
let currentResult = null;
if (benchMode !== 'current') {
  baselineResult = await runBuild({
    label: 'baseline',
    outPath: outPathBaseline,
    buildPragmas: false,
    optimize: false
  });
}
if (benchMode !== 'baseline') {
  currentResult = await runBuild({
    label: 'current',
    outPath: outPathCurrent,
    buildPragmas: true,
    optimize: true
  });
}
if (baselineResult && currentResult) {
  const deltaMs = currentResult.durationMs - baselineResult.durationMs;
  const deltaPct = baselineResult.durationMs > 0
    ? (deltaMs / baselineResult.durationMs) * 100
    : null;
  console.log(`[bench] delta ms=${deltaMs.toFixed(1)} (${deltaPct?.toFixed(1)}%)`);
}
