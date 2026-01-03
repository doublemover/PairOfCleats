#!/usr/bin/env node

import path from 'node:path';
import { parseBuildArgs } from './src/indexer/build/args.js';
import { createBuildRuntime } from './src/indexer/build/runtime.js';
import { buildIndexForMode } from './src/indexer/build/indexer.js';
import { acquireIndexLock } from './src/indexer/build/lock.js';
import { discoverFilesForModes } from './src/indexer/build/discover.js';
import { watchIndex } from './src/indexer/build/watch.js';
import { log } from './src/shared/progress.js';
import { resolveRepoRoot } from './tools/dict-utils.js';
import { runCommand } from './tools/cli-utils.js';
import { shutdownPythonAstPool } from './src/lang/python.js';

const { argv, modes } = parseBuildArgs(process.argv.slice(2));
const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const runtime = await createBuildRuntime({
  root: rootArg || resolveRepoRoot(process.cwd()),
  argv,
  rawArgv: process.argv
});

if (argv.watch) {
  const pollMs = Number.isFinite(Number(argv['watch-poll'])) ? Number(argv['watch-poll']) : 2000;
  const debounceMs = Number.isFinite(Number(argv['watch-debounce'])) ? Number(argv['watch-debounce']) : 500;
  await watchIndex({ runtime, modes, pollMs, debounceMs });
  process.exit(0);
}

const lock = await acquireIndexLock({ repoCacheRoot: runtime.repoCacheRoot, log });
if (!lock) process.exit(1);
try {
  let sharedDiscovery = null;
  if (modes.includes('code') && modes.includes('prose')) {
    const skippedByMode = { code: [], prose: [] };
    const entriesByMode = await runtime.queues.io.add(() => discoverFilesForModes({
      root: runtime.root,
      modes: ['code', 'prose'],
      ignoreMatcher: runtime.ignoreMatcher,
      skippedByMode,
      maxFileBytes: runtime.maxFileBytes
    }));
    sharedDiscovery = {
      code: { entries: entriesByMode.code, skippedFiles: skippedByMode.code },
      prose: { entries: entriesByMode.prose, skippedFiles: skippedByMode.prose }
    };
  }
  for (const mode of modes) {
    const discovery = sharedDiscovery ? sharedDiscovery[mode] : null;
    await buildIndexForMode({ mode, runtime, discovery });
  }
  const sqliteConfigured = runtime.userConfig?.sqlite?.use !== false;
  const shouldBuildSqlite = typeof argv.sqlite === 'boolean' ? argv.sqlite : sqliteConfigured;
  const sqliteModes = modes.filter((mode) => mode === 'code' || mode === 'prose');
  if (shouldBuildSqlite && sqliteModes.length) {
    const sqliteArgs = [path.join('tools', 'build-sqlite-index.js'), '--repo', runtime.root];
    if (argv.incremental) sqliteArgs.push('--incremental');
    if (sqliteModes.length === 1) sqliteArgs.push('--mode', sqliteModes[0]);
    log('Building SQLite indexes...');
    const result = runCommand(process.execPath, sqliteArgs, { stdio: 'inherit' });
    if (!result.ok) {
      console.error('SQLite index build failed.');
      process.exit(result.status ?? 1);
    }
  }
} finally {
  await lock.release();
  if (runtime.workerPool) {
    try {
      await runtime.workerPool.destroy();
    } catch {}
  }
  shutdownPythonAstPool();
}

log('\nDone.');
