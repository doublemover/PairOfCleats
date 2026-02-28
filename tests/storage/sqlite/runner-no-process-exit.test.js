#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {
  runBuildSqliteIndexWithConfig
} from '../../../src/storage/sqlite/build/runner.js';
import { executeSqliteModeBuilds } from '../../../src/storage/sqlite/build/runner/execution-orchestration.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv();

const root = process.cwd();
const outDir = resolveTestCachePath(root, 'sqlite-runner-no-process-exit');
await fsPromises.rm(outDir, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });

const originalProcessExit = process.exit;
const exitCalls = [];
process.exit = ((code = 0) => {
  exitCalls.push(code);
  throw new Error(`process.exit invoked with code ${code}`);
});

try {
  const parsed = {
    argv: {
      repo: root,
      mode: 'code',
      incremental: false,
      compact: true,
      'no-compact': true,
      validate: 'off',
      out: null,
      'index-root': null,
      'as-of': null,
      snapshot: null,
      'code-dir': null,
      'prose-dir': null,
      'extracted-prose-dir': null,
      'records-dir': null,
      'batch-size': null,
      progress: 'auto',
      verbose: false,
      quiet: true
    },
    emitOutput: false,
    exitOnError: true,
    validateMode: 'off',
    modeArg: 'code',
    rawArgs: []
  };

  let runnerFailure = null;
  try {
    await runBuildSqliteIndexWithConfig(parsed, {
      logger: { log() {}, warn() {}, error() {} },
      root
    });
  } catch (err) {
    runnerFailure = err;
  }

  assert.ok(runnerFailure, 'expected sqlite runner to fail for conflicting compact flags');
  assert.equal(runnerFailure?.code, 'ERR_SQLITE_BUILD_FAILED');
  assert.equal(runnerFailure?.exitCode, 1);
  assert.equal(runnerFailure?.exitOnError, true);
  assert.equal(exitCalls.length, 0, 'runner should not invoke process.exit');

  const indexRoot = path.join(outDir, 'index-root');
  const metricsDir = path.join(outDir, 'metrics');
  const repoCacheRoot = path.join(outDir, 'repo-cache');
  const modeIndexDir = path.join(indexRoot, 'code');
  await fsPromises.mkdir(modeIndexDir, { recursive: true });
  await fsPromises.mkdir(metricsDir, { recursive: true });
  await fsPromises.mkdir(repoCacheRoot, { recursive: true });

  const modeOutputPath = path.join(outDir, 'mode-code.sqlite');
  const syntheticFailure = new Error('synthetic index piece load error');

  let orchestrationFailure = null;
  try {
    await executeSqliteModeBuilds({
      Database: function MockDatabase() {},
      argv: { compact: false, 'no-compact': false },
      validateMode: 'off',
      emitOutput: false,
      exitOnError: true,
      externalLogger: { log() {}, warn() {}, error() {} },
      taskFactory: () => ({ set() {} }),
      logger: { log() {}, warn() {}, error() {} },
      schemaVersion: '1.0.0',
      bail: (message) => {
        const err = new Error(message || 'bail');
        err.code = 'ERR_SQLITE_BAIL';
        throw err;
      },
      modeList: ['code'],
      indexRoot,
      modeIndexDirs: { code: modeIndexDir },
      modeOutputPaths: { code: modeOutputPath },
      modeChunkCountHints: { code: 1 },
      root,
      userConfig: {},
      metricsDir,
      modelConfig: {},
      vectorExtension: { enabled: false },
      vectorAnnEnabled: false,
      vectorConfig: { hasVectorTable: () => false },
      sqliteSharedDb: false,
      logPrefix: '[sqlite]',
      repoCacheRoot,
      bundleWorkerProfilePath: path.join(outDir, 'bundle-profile.json'),
      bundleWorkerProfile: { modes: {} },
      incrementalRequested: false,
      batchSizeOverride: null,
      resolveAdaptiveBatchConfig: () => ({
        config: {},
        plan: {
          batchSize: 1000,
          transactionRows: 64000,
          filesPerTransaction: 100,
          walPressure: 'off'
        }
      }),
      indexPieces: {},
      indexPieceErrors: { code: syntheticFailure },
      compactMode: false,
      envConfig: {},
      threadLimits: {
        cpuCount: 1,
        maxConcurrencyCap: 1,
        fileConcurrency: 1,
        importConcurrency: 1,
        ioConcurrency: 1,
        cpuConcurrency: 1
      }
    });
  } catch (err) {
    orchestrationFailure = err;
  }

  assert.ok(orchestrationFailure, 'expected orchestration failure from synthetic piece error');
  assert.equal(orchestrationFailure?.code, 'ERR_SQLITE_MODE_BUILD_FAILED');
  assert.equal(orchestrationFailure?.exitCode, 1);
  assert.equal(orchestrationFailure?.exitOnError, true);
  assert.equal(exitCalls.length, 0, 'orchestration should not invoke process.exit');
} finally {
  process.exit = originalProcessExit;
}

console.log('sqlite runner no-process-exit test passed');
