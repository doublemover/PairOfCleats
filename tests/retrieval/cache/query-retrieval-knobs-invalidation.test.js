#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveVersionedCacheRoot } from '../../../src/shared/cache-roots.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { rmDirRecursive } from '../../helpers/temp.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'query-cache-retrieval-knobs');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const cacheRootResolved = resolveVersionedCacheRoot(cacheRoot);
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');

await rmDirRecursive(tempRoot, { retries: 6, delayMs: 120 });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const buildTestConfig = ({
  relationBoostEnabled,
  annCandidateCap,
  sqliteTailLatencyTuning = false,
  sqliteFtsOverfetchRowCap = null
}) => ({
  quality: 'max',
  indexing: {
    scm: { provider: 'none' }
  },
  retrieval: {
    relationBoost: {
      enabled: relationBoostEnabled,
      perCall: 0.5,
      perUse: 0.2,
      maxBoost: 2.0
    },
    annCandidateCap,
    annCandidateMinDocCount: 100,
    annCandidateMaxDocCount: 20000,
    sqliteTailLatencyTuning,
    ...(Number.isFinite(Number(sqliteFtsOverfetchRowCap))
      ? { sqliteFtsOverfetchRowCap: Number(sqliteFtsOverfetchRowCap) }
      : {})
  }
});

const envA = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: buildTestConfig({ relationBoostEnabled: false, annCandidateCap: 20000 })
});
const envB = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: buildTestConfig({ relationBoostEnabled: true, annCandidateCap: 20000 })
});
const envC = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: buildTestConfig({ relationBoostEnabled: true, annCandidateCap: 100 })
});
const envD = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: buildTestConfig({
    relationBoostEnabled: false,
    annCandidateCap: 20000,
    sqliteTailLatencyTuning: true,
    sqliteFtsOverfetchRowCap: 4096
  })
});
const envE = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: buildTestConfig({
    relationBoostEnabled: false,
    annCandidateCap: 20000,
    sqliteTailLatencyTuning: true,
    sqliteFtsOverfetchRowCap: 2048
  })
});

const run = (args, label, env) => {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result.stdout || '';
};

run([path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot], 'build index', envA);

const searchArgs = [
  path.join(root, 'search.js'),
  'greet',
  '--json',
  '--stats',
  '--backend',
  'memory',
  '--repo',
  repoRoot
];

const runSearch = (env, label, expectedHit, args = searchArgs) => {
  const payload = JSON.parse(run(args, label, env));
  const cacheHit = payload?.stats?.cache?.hit;
  if (cacheHit !== expectedHit) {
    console.error(`${label} failed: expected cache hit=${expectedHit}, got ${cacheHit}`);
    process.exit(1);
  }
};

runSearch(envA, 'search config A first', false);
runSearch(envA, 'search config A second', true);
runSearch(envB, 'search config B first', false);
runSearch(envB, 'search config B second', true);
runSearch(envC, 'search config C first', false);
runSearch(envC, 'search config C second', true);
const bm25ArgsA = [
  ...searchArgs,
  '--bm25-k1',
  '1.2',
  '--bm25-b',
  '0.75'
];
const bm25ArgsB = [
  ...searchArgs,
  '--bm25-k1',
  '1.7',
  '--bm25-b',
  '0.75'
];
runSearch(envA, 'search bm25 A first', false, bm25ArgsA);
runSearch(envA, 'search bm25 A second', true, bm25ArgsA);
runSearch(envA, 'search bm25 B first', false, bm25ArgsB);
runSearch(envA, 'search bm25 B second', true, bm25ArgsB);
runSearch(envD, 'search sqlite tail tuning A first', false);
runSearch(envD, 'search sqlite tail tuning A second', true);
runSearch(envE, 'search sqlite tail tuning B first', false);
runSearch(envE, 'search sqlite tail tuning B second', true);

const repoCacheDirs = await fsPromises.readdir(path.join(cacheRootResolved, 'repos'));
if (!repoCacheDirs.length) {
  console.error('query cache retrieval knobs invalidation test failed: repo cache not created.');
  process.exit(1);
}
const repoCacheRoot = path.join(cacheRootResolved, 'repos', repoCacheDirs[0]);
const queryCachePath = path.join(repoCacheRoot, 'query-cache', 'queryCache.json');
if (!fs.existsSync(queryCachePath)) {
  console.error(`query cache retrieval knobs invalidation test failed: missing cache file at ${queryCachePath}`);
  process.exit(1);
}

console.log('query cache retrieval knobs invalidation test passed');
