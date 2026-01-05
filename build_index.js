#!/usr/bin/env node

import path from 'node:path';
import { parseBuildArgs } from './src/index/build/args.js';
import { buildIndex } from './src/integrations/core/index.js';
import { resolveRepoRoot } from './tools/dict-utils.js';

const { argv } = parseBuildArgs(process.argv.slice(2));
const rootArg = argv.repo ? path.resolve(argv.repo) : null;
await buildIndex(rootArg || resolveRepoRoot(process.cwd()), {
  ...argv,
  rawArgv: process.argv
});
