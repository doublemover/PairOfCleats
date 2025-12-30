#!/usr/bin/env node

import path from 'node:path';
import { parseBuildArgs } from './src/indexer/build/args.js';
import { createBuildRuntime } from './src/indexer/build/runtime.js';
import { buildIndexForMode } from './src/indexer/build/indexer.js';
import { acquireIndexLock } from './src/indexer/build/lock.js';
import { watchIndex } from './src/indexer/build/watch.js';
import { log } from './src/shared/progress.js';
import { resolveRepoRoot } from './tools/dict-utils.js';

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
  for (const mode of modes) {
    await buildIndexForMode({ mode, runtime });
  }
} finally {
  await lock.release();
}

log('\nDone.');
