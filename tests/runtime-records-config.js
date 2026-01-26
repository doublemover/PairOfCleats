#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { parseBuildArgs } from '../src/index/build/args.js';
import { createBuildRuntime } from '../src/index/build/runtime.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'runtime-records-config');
const repoRoot = path.join(tempRoot, 'repo');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = tempRoot;

const defaults = parseBuildArgs([]).argv;
const runtime = await createBuildRuntime({ root: repoRoot, argv: defaults, rawArgv: [] });

if (!Object.prototype.hasOwnProperty.call(runtime, 'recordsDir')) {
  console.error('runtime missing recordsDir');
  process.exit(1);
}
if (!Object.prototype.hasOwnProperty.call(runtime, 'recordsConfig')) {
  console.error('runtime missing recordsConfig');
  process.exit(1);
}

console.log('runtime records config test passed');

