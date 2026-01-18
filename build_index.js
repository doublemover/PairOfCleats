#!/usr/bin/env node

import path from 'node:path';
import { parseBuildArgs } from './src/index/build/args.js';
import { buildIndex } from './src/integrations/core/index.js';
import { createDisplay } from './src/shared/cli/display.js';
import { setProgressHandlers } from './src/shared/progress.js';
import { getCurrentBuildInfo, getRepoCacheRoot, resolveRepoRoot } from './tools/dict-utils.js';

const { argv, modes } = parseBuildArgs(process.argv.slice(2));
const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const display = createDisplay({
  stream: process.stderr,
  progressMode: argv.progress,
  verbose: argv.verbose === true,
  quiet: argv.quiet === true,
  json: argv.json === true
});
const restoreHandlers = setProgressHandlers(display);
let result = null;
const resolvedRoot = rootArg || resolveRepoRoot(process.cwd());
const repoCacheRoot = getRepoCacheRoot(resolvedRoot);
const crashLogPath = repoCacheRoot
  ? path.join(repoCacheRoot, 'logs', 'index-crash.log')
  : null;
try {
  result = await buildIndex(resolvedRoot, {
    ...argv,
    modes,
    rawArgv: process.argv
  });
  const buildInfo = getCurrentBuildInfo(resolvedRoot);
  const buildStatePath = buildInfo?.buildRoot
    ? path.join(buildInfo.buildRoot, 'build_state.json')
    : null;
  if (result?.stage3?.embeddings?.cancelled) {
    display.warn('Index build cancelled during embeddings.');
  } else {
    display.log('Index build done.');
  }
  if (buildStatePath) {
    display.log(`Build state: ${buildStatePath}`);
  }
} catch (err) {
  display.error(`Index build failed: ${err?.message || err}`);
  if (crashLogPath) {
    display.error(`Crash log: ${crashLogPath}`);
  }
  process.exitCode = 1;
} finally {
  restoreHandlers();
  display.close();
}
