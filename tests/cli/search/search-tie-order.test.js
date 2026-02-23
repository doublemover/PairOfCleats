#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'search-tie-order');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const content = '# Title\n\nalpha beta gamma\nalpha beta gamma\n';
const files = ['alpha-1.md', 'alpha-2.md', 'alpha-3.md'];
for (const file of files) {
  await fsPromises.writeFile(path.join(repoRoot, file), content);
}

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--scm-provider', 'none', '--sqlite', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  console.error('Failed: build index for search tie-order');
  process.exit(buildResult.status ?? 1);
}

const memoryFirst = runSearch('memory', env, repoRoot);
const memorySecond = runSearch('memory', env, repoRoot);
assertTie(memoryFirst);
assert.deepEqual(
  memoryFirst.map((hit) => hit.file),
  memorySecond.map((hit) => hit.file),
  'expected stable ordering under ties for memory backend'
);

const sqliteFirst = runSearch('sqlite', env, repoRoot);
const sqliteSecond = runSearch('sqlite', env, repoRoot);
assertTie(sqliteFirst);
assert.deepEqual(
  sqliteFirst.map((hit) => hit.file),
  sqliteSecond.map((hit) => hit.file),
  'expected stable ordering under ties for sqlite backend'
);

console.log('search tie-order tests passed');

function runSearch(backend, env, repoRoot) {
  const searchPath = path.join(root, 'search.js');
  const args = [
    searchPath,
    'alpha',
    '--mode',
    'prose',
    '--top',
    '3',
    '--no-ann',
    '--json',
    '--backend',
    backend,
    '--repo',
    repoRoot
  ];
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, env, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`Failed: search tie-order (${backend})`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  let payload = null;
  try {
    payload = JSON.parse(result.stdout || '{}');
  } catch {
    console.error(`Failed: search tie-order (${backend}) returned invalid JSON`);
    process.exit(1);
  }
  const hits = payload?.prose || [];
  if (!Array.isArray(hits) || hits.length < 3) {
    console.error(`Expected at least 3 prose hits for backend=${backend}.`);
    process.exit(1);
  }
  return hits.slice(0, 3);
}

function assertTie(hits) {
  const scores = hits.map((hit) => hit.score).filter((score) => Number.isFinite(score));
  if (scores.length !== hits.length) {
    console.error('Expected scores for tie-order hits.');
    process.exit(1);
  }
  const baseline = Number(scores[0].toFixed(6));
  for (const score of scores) {
    const normalized = Number(score.toFixed(6));
    if (normalized !== baseline) {
      console.error('Tie-order test failed: scores are not tied.');
      process.exit(1);
    }
  }
}

