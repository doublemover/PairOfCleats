#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getBuildsRoot, getRepoId } from '../../../tools/dict-utils/paths.js';
import { resolveVersionedCacheRoot } from '../../../src/shared/cache-roots.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';

const root = process.cwd();
const { dir: tempRoot } = await prepareTestCacheDir('dict-utils-builds', { root });
const cacheRoot = path.join(tempRoot, 'cache');

await withTemporaryEnv(applyTestEnv({ cacheRoot, syncProcess: false }), async () => {
  const repoRoot = path.join(tempRoot, 'repo');
  await fs.mkdir(repoRoot, { recursive: true });

  const expected = path.join(
    resolveVersionedCacheRoot(cacheRoot),
    'repos',
    getRepoId(repoRoot),
    'builds'
  );

  assert.equal(getBuildsRoot(repoRoot), expected);
});

console.log('dict-utils builds root test passed');
