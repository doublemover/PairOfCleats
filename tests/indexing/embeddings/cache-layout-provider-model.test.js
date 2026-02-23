#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveEmbeddingsCacheBase, resolveEmbeddingsCacheModeDir } from '../../../src/shared/embeddings-cache/layout.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const cacheRoot = resolveTestCachePath(process.cwd(), 'cache-layout');
const base = resolveEmbeddingsCacheBase({
  cacheRoot,
  provider: 'provider:alpha',
  modelId: 'model/beta',
  dims: 384
});
const rel = path.relative(cacheRoot, base);
const parts = rel.split(path.sep).filter(Boolean);
assert.equal(parts.length, 3, 'expected provider/model/dims partitioning');
assert.equal(parts[0], 'provider_alpha', 'expected provider segment to be sanitized');
assert.equal(parts[1], 'model_beta', 'expected model segment to be sanitized');
assert.equal(parts[2], '384d', 'expected dims segment');

const modeDir = resolveEmbeddingsCacheModeDir(base, 'code');
const modeRel = path.relative(base, modeDir);
assert.equal(modeRel, 'code', 'expected mode segment to be appended');

console.log('embeddings cache layout provider/model test passed');
