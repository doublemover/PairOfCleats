#!/usr/bin/env node

import path from 'node:path';
import { parseBuildArgs } from './src/index/build/args.js';
import { buildIndex } from './src/integrations/core/index.js';
import { createDisplay } from './src/shared/cli/display.js';
import { setProgressHandlers } from './src/shared/progress.js';
import { resolveRepoRoot } from './tools/dict-utils.js';

const { argv } = parseBuildArgs(process.argv.slice(2));
if (argv.verbose) {
  process.env.PAIROFCLEATS_VERBOSE = '1';
}
const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const display = createDisplay({
  stream: process.stderr,
  progressMode: argv.progress,
  verbose: argv.verbose === true,
  quiet: argv.quiet === true,
  json: argv.json === true
});
const restoreHandlers = setProgressHandlers(display);
try {
  await buildIndex(rootArg || resolveRepoRoot(process.cwd()), {
    ...argv,
    rawArgv: process.argv
  });
} finally {
  restoreHandlers();
  display.close();
}
