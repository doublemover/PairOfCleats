#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { parseBuildArgs } from '../../../src/index/build/args.js';
import { createBuildRuntime } from '../../../src/index/build/runtime.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'embedding-batch-autotune');
const repoRoot = path.join(tempRoot, 'repo');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = tempRoot;

const defaults = parseBuildArgs([]).argv;
const argv = { ...defaults, 'stub-embeddings': true };
const runtime = await createBuildRuntime({ root: repoRoot, argv, rawArgv: [] });

if (runtime.embeddingBatchSize < 8 || runtime.embeddingBatchSize > 256) {
  console.error(`Unexpected embedding batch size: ${runtime.embeddingBatchSize}`);
  process.exit(1);
}
if (runtime.embeddingConcurrency < 1) {
  console.error(`Unexpected embedding concurrency: ${runtime.embeddingConcurrency}`);
  process.exit(1);
}

console.log('embedding auto-tune test passed');

