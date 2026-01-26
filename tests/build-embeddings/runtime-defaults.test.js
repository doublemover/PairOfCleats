#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseBuildEmbeddingsArgs } from '../../tools/build-embeddings/cli.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'build-embeddings-defaults');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const savedEnv = { ...process.env };
const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(savedEnv)) {
    process.env[key] = value;
  }
};

process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = path.join(tempRoot, 'cache');
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

const parsed = parseBuildEmbeddingsArgs([
  '--repo', tempRoot,
  '--mode', 'code',
  '--dims', '384'
]);

assert.equal(parsed.useStubEmbeddings, true, 'expected stub embeddings when env requests stub');
assert.equal(parsed.resolvedEmbeddingMode, 'stub');
assert.equal(parsed.configuredDims, 384, 'expected dims to parse as number');
assert.ok(parsed.embeddingBatchSize > 0, 'expected auto batch size to be resolved');

restoreEnv();

console.log('build-embeddings runtime defaults test passed');
