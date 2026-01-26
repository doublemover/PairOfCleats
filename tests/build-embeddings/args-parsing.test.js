#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseBuildEmbeddingsArgs } from '../../tools/build-embeddings/cli.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'build-embeddings-args');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });
const cacheRoot = path.join(tempRoot, 'cache');

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
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;

const parsed = parseBuildEmbeddingsArgs([
  '--repo', tempRoot,
  '--mode', 'both',
  '--index-root', path.join(tempRoot, 'index'),
  '--stub-embeddings',
  '--batch', '16'
]);

assert.deepEqual(
  parsed.modes,
  ['code', 'prose', 'extracted-prose', 'records'],
  'expected both/all mode to expand to all modes'
);
assert.equal(
  parsed.indexRoot,
  path.resolve(path.join(tempRoot, 'index')),
  'expected index-root to resolve to absolute path'
);
assert.equal(parsed.useStubEmbeddings, true, 'expected stub embeddings to be enabled');
assert.equal(parsed.embeddingBatchSize, 16, 'expected batch size to respect cli value');

restoreEnv();

console.log('build-embeddings args parsing test passed');
