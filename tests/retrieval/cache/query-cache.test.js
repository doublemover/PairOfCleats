#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'query-cache');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_TEST_CONFIG: JSON.stringify({ quality: 'max' }),
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

function run(args, label, cwd, envVars) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env: envVars,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result.stdout || '';
}

run([path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot], 'build index', repoRoot, env);

const query = 'greet';
const searchArgs = [
  path.join(root, 'search.js'),
  query,
  '--json',
  '--stats',
  '--backend',
  'memory',
  '--no-ann',
  '--repo',
  repoRoot
];
const first = JSON.parse(run(searchArgs, 'search (first)', repoRoot, env));
const second = JSON.parse(run(searchArgs, 'search (second)', repoRoot, env));

if (!first?.stats?.cache || first.stats.cache.hit !== false) {
  console.error('Query cache test failed: first request should be cache miss.');
  process.exit(1);
}
if (!second?.stats?.cache || second.stats.cache.hit !== true) {
  console.error('Query cache test failed: second request should be cache hit.');
  process.exit(1);
}

const repoCacheDirs = await fsPromises.readdir(path.join(cacheRoot, 'repos'));
if (!repoCacheDirs.length) {
  console.error('Query cache test failed: repo cache not created.');
  process.exit(1);
}
const repoCacheRoot = path.join(cacheRoot, 'repos', repoCacheDirs[0]);
const queryCachePath = path.join(repoCacheRoot, 'query-cache', 'queryCache.json');
if (!fs.existsSync(queryCachePath)) {
  console.error(`Query cache test failed: missing cache file at ${queryCachePath}`);
  process.exit(1);
}

console.log('Query cache test passed');

