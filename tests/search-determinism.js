#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'search-determinism');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const content = 'alpha beta gamma\nalpha beta gamma\n';
const files = ['alpha-1.txt', 'alpha-2.txt', 'alpha-3.txt'];
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
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  console.error('Failed: build index');
  process.exit(buildResult.status ?? 1);
}

const searchPath = path.join(root, 'search.js');
const searchArgs = [
  searchPath,
  'alpha',
  '--mode',
  'prose',
  '--top',
  '3',
  '--ann',
  '--explain',
  '--json',
  '--backend',
  'memory',
  '--repo',
  repoRoot
];

function runSearch(label) {
  const result = spawnSync(process.execPath, searchArgs, {
    cwd: repoRoot,
    env,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  let payload = null;
  try {
    payload = JSON.parse(result.stdout || '{}');
  } catch {
    console.error(`Failed: ${label} returned invalid JSON`);
    process.exit(1);
  }
  return payload;
}

const first = runSearch('search first');
const second = runSearch('search second');

const firstHits = first.prose || [];
const secondHits = second.prose || [];
if (!firstHits.length || !secondHits.length) {
  console.error('Expected prose hits for determinism test.');
  process.exit(1);
}
for (const hit of firstHits) {
  if (!hit.scoreBreakdown) {
    console.error('Expected score breakdown for determinism test.');
    process.exit(1);
  }
}

if (JSON.stringify(firstHits) !== JSON.stringify(secondHits)) {
  console.error('Determinism test failed: search results differ between runs.');
  process.exit(1);
}

console.log('search determinism tests passed');
