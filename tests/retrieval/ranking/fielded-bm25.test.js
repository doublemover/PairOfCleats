#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'fielded-bm25');
const cacheRoot = path.join(tempRoot, 'cache');
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', fixtureRoot],
  { env, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  console.error('fielded bm25 test failed: build_index failed');
  process.exit(buildResult.status ?? 1);
}

process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
const userConfig = loadUserConfig(fixtureRoot);
const fieldPostings = path.join(
  getIndexDir(fixtureRoot, 'code', userConfig),
  'field_postings.json'
);

if (!fs.existsSync(fieldPostings)) {
  console.error('fielded bm25 test failed: field_postings.json missing');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'search.js'),
    'greet',
    '--mode',
    'code',
    '--no-ann',
    '--backend',
    'memory',
    '--explain',
    '--json',
    '--repo',
    fixtureRoot
  ],
  { env, encoding: 'utf8' }
);

if (result.status !== 0) {
  console.error('fielded bm25 test failed: search returned error');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

let payload = null;
try {
  payload = JSON.parse(result.stdout || '{}');
} catch (err) {
  console.error('fielded bm25 test failed: invalid JSON output');
  process.exit(1);
}

const hit = payload?.code?.[0];
if (!hit) {
  console.error('fielded bm25 test failed: no hits');
  process.exit(1);
}
if (hit.scoreType !== 'bm25-fielded') {
  console.error(`fielded bm25 test failed: expected bm25-fielded, got ${hit.scoreType}`);
  process.exit(1);
}
if (hit.scoreBreakdown?.sparse?.fielded !== true) {
  console.error('fielded bm25 test failed: sparse.fielded not true');
  process.exit(1);
}

console.log('fielded bm25 tests passed');

