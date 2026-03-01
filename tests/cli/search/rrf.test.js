#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'search-rrf');
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
  console.error('search rrf test failed: build_index failed');
  process.exit(buildResult.status ?? 1);
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
  console.error('search rrf test failed: search returned error');
  if (result.error) console.error(result.error);
  if (result.stdout) console.error(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

let payload = null;
try {
  payload = JSON.parse(result.stdout || '{}');
} catch (err) {
  console.error('search rrf test failed: invalid JSON output');
  process.exit(1);
}

const hit = payload?.code?.[0];
if (!payload?.stats?.annActive) {
  console.error('search rrf test failed: annActive was false');
  process.exit(1);
}
if (!hit?.scoreBreakdown?.rrf) {
  console.error('search rrf test failed: scoreBreakdown.rrf missing');
  process.exit(1);
}
if (hit.scoreType !== 'rrf') {
  console.error(`search rrf test failed: expected scoreType rrf, got ${hit.scoreType}`);
  process.exit(1);
}

console.log('search rrf tests passed');

