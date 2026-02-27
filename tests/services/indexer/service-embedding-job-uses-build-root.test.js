#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildEmbeddingsArgs, normalizeEmbeddingJob } from '../../../tools/service/indexer-service-helpers.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const repoRoot = resolveTestCachePath(process.cwd(), 'indexer-service-embedding-job');
const buildRoot = path.join(repoRoot, 'builds', 'b1');
const indexDir = path.join(buildRoot, 'index-code');

const normalized = normalizeEmbeddingJob({
  repoRoot,
  buildRoot,
  indexDir,
  mode: 'code',
  embeddingPayloadFormatVersion: 2
});

assert.equal(normalized.buildRoot, path.resolve(buildRoot));
assert.equal(normalized.indexDir, path.resolve(indexDir));

const buildPath = path.join(process.cwd(), 'tools', 'build/embeddings.js');
const args = buildEmbeddingsArgs({
  buildPath,
  repoPath: repoRoot,
  mode: 'code',
  indexRoot: normalized.buildRoot
});

const indexFlag = args.indexOf('--index-root');
assert.ok(indexFlag >= 0, 'expected --index-root arg');
assert.equal(args[indexFlag + 1], normalized.buildRoot);

console.log('indexer-service embedding job build-root test passed');
