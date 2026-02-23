#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getBuildsRoot, getRepoId } from '../../../tools/dict-utils/paths.js';
import { resolveVersionedCacheRoot } from '../../../src/shared/cache-roots.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'dict-utils-builds');
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
process.env.PAIROFCLEATS_CACHE_ROOT = path.join(tempRoot, 'cache');

const repoRoot = path.join(tempRoot, 'repo');
await fs.mkdir(repoRoot, { recursive: true });

const expected = path.join(
  resolveVersionedCacheRoot(process.env.PAIROFCLEATS_CACHE_ROOT),
  'repos',
  getRepoId(repoRoot),
  'builds'
);

assert.equal(getBuildsRoot(repoRoot), expected);

restoreEnv();

console.log('dict-utils builds root test passed');
