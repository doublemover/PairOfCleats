#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'search-topn-filters');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const allowedFiles = ['allowed-1.txt', 'allowed-2.txt'];
const blockedCount = 12;
const allowedContent = 'alpha beta gamma\nalpha beta\n';
const blockedContent = `${Array.from({ length: 200 }, () => 'alpha').join(' ')}\n`;

for (const file of allowedFiles) {
  await fsPromises.writeFile(path.join(repoRoot, file), allowedContent);
}
for (let i = 0; i < blockedCount; i += 1) {
  await fsPromises.writeFile(path.join(repoRoot, `blocked-${i + 1}.txt`), blockedContent);
}

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

function run(args, label, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
    ...options
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
  return result;
}

run([path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot], 'build index');
run([path.join(root, 'tools', 'build-sqlite-index.js'), '--repo', repoRoot], 'build sqlite index');

const searchPath = path.join(root, 'search.js');

function runSearch(backend) {
  const result = spawnSync(
    process.execPath,
    [
      searchPath,
      'alpha',
      '--mode',
      'prose',
      '--top',
      '2',
      '--file',
      'allowed',
      '--json',
      '--backend',
      backend,
      '--no-ann',
      '--repo',
      repoRoot
    ],
    { cwd: repoRoot, env, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    console.error(`Failed: search (${backend})`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  let payload = null;
  try {
    payload = JSON.parse(result.stdout || '{}');
  } catch {
    console.error(`Failed: search (${backend}) returned invalid JSON`);
    process.exit(1);
  }
  const hits = payload.prose || [];
  if (hits.length !== 2) {
    console.error(`Expected 2 results for ${backend}, got ${hits.length}`);
    process.exit(1);
  }
  for (const hit of hits) {
    const fileBase = path.basename(hit.file || '');
    if (!fileBase.startsWith('allowed-')) {
      console.error(`Unexpected file in ${backend} results: ${fileBase}`);
      process.exit(1);
    }
  }
}

runSearch('memory');
runSearch('sqlite-fts');

console.log('search top-N filter tests passed');
