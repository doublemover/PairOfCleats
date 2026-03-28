#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'search-ann-rrf-contract');
const cacheRoot = path.join(tempRoot, 'cache');
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    tooling: {
      autoEnableOnDetect: false
    }
  }
});

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--scm-provider', 'none', '--repo', fixtureRoot],
  { env, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  throw new Error(`search ann rrf contract build failed with status=${buildResult.status}`);
}

const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'search.js'),
    'greet',
    '--mode',
    'code',
    '--backend',
    'memory',
    '--ann',
    '--ann-backend',
    'hnsw',
    '--json',
    '--stats',
    '--explain',
    '--repo',
    fixtureRoot
  ],
  { env, encoding: 'utf8' }
);

if (result.status !== 0) {
  if (result.error) console.error(result.error);
  if (result.stdout) console.error(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
  throw new Error(`search ann rrf contract failed with status=${result.status}`);
}

let payload = null;
try {
  payload = JSON.parse(result.stdout || '{}');
} catch {
  throw new Error('search ann rrf contract returned invalid JSON');
}

const hit = payload?.code?.[0];
if (!payload?.stats?.annActive) {
  throw new Error('expected annActive to be true');
}
if (!hit?.scoreBreakdown?.rrf) {
  throw new Error('expected scoreBreakdown.rrf');
}
if (hit.scoreType !== 'rrf') {
  throw new Error(`expected scoreType=rrf, got ${hit.scoreType}`);
}

console.log('search ann rrf contract test passed');
