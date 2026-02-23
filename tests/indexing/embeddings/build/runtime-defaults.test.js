#!/usr/bin/env node
import { applyTestEnv } from '../../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseBuildEmbeddingsArgs } from '../../../../tools/build/embeddings/cli.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'build-embeddings-defaults');
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

applyTestEnv();
try {
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

  console.log('build-embeddings runtime defaults test passed');
} finally {
  restoreEnv();
}
