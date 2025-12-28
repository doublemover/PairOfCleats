#!/usr/bin/env node

import { parseBuildArgs } from './src/indexer/build/args.js';
import { createBuildRuntime } from './src/indexer/build/runtime.js';
import { buildIndexForMode } from './src/indexer/build/indexer.js';
import { log } from './src/shared/progress.js';

const { argv, modes } = parseBuildArgs(process.argv.slice(2));
const runtime = await createBuildRuntime({
  root: process.cwd(),
  argv,
  rawArgv: process.argv
});

for (const mode of modes) {
  await buildIndexForMode({ mode, runtime });
}

log('\nDone.');
