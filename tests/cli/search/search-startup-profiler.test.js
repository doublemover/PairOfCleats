#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'search-startup-profiler');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(path.join(repoRoot, 'alpha.txt'), 'alpha beta gamma\n');

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' }
    }
  }
});

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--stage', 'stage2', '--mode', 'code', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);

if (buildResult.status !== 0) {
  console.error('Failed: build index');
  process.exit(buildResult.status ?? 1);
}

const searchArgs = [
  path.join(root, 'search.js'),
  'alpha',
  '--mode',
  'code',
  '--json',
  '--stats',
  '--backend',
  'memory',
  '--no-ann',
  '--repo',
  repoRoot
];

const result = spawnSync(process.execPath, searchArgs, {
  cwd: repoRoot,
  env,
  encoding: 'utf8'
});

if (result.status !== 0) {
  console.error('Failed: search startup profiler');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(result.stdout || '{}');
} catch {
  console.error('Failed: search startup profiler returned invalid JSON');
  process.exit(1);
}

const pipeline = payload?.stats?.pipeline;
if (!Array.isArray(pipeline) || pipeline.length === 0) {
  console.error('Expected startup pipeline stats to be present.');
  process.exit(1);
}

const stages = new Set(pipeline.map((entry) => entry.stage));
if (!stages.has('startup.backend') || !stages.has('startup.search')) {
  console.error('Expected startup backend/search stages in pipeline stats.');
  process.exit(1);
}

console.log('search startup profiler test passed');
