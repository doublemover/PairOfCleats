#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadUserConfig, resolveSqlitePaths } from '../tools/dict-utils.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, 'tests', '.cache', 'sqlite-sidecar-cleanup');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

const run = (args, label) => {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, env, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

run([path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot], 'build index');
run([path.join(root, 'tools', 'build-sqlite-index.js'), '--mode', 'code', '--repo', repoRoot], 'build sqlite');

const userConfig = loadUserConfig(repoRoot);
const sqlitePaths = resolveSqlitePaths(repoRoot, userConfig);
const walPath = `${sqlitePaths.codePath}-wal`;
const shmPath = `${sqlitePaths.codePath}-shm`;
await fsPromises.writeFile(walPath, 'stale-wal');
await fsPromises.writeFile(shmPath, 'stale-shm');

run([path.join(root, 'tools', 'build-sqlite-index.js'), '--mode', 'code', '--repo', repoRoot], 'rebuild sqlite');

const staleWal = fs.existsSync(walPath) ? fs.readFileSync(walPath) : null;
const staleShm = fs.existsSync(shmPath) ? fs.readFileSync(shmPath) : null;
if (staleWal && staleWal.toString('utf8') === 'stale-wal') {
  console.error('Stale WAL sidecar was not cleaned up.');
  process.exit(1);
}
if (staleShm && staleShm.toString('utf8') === 'stale-shm') {
  console.error('Stale SHM sidecar was not cleaned up.');
  process.exit(1);
}

console.log('sqlite sidecar cleanup test passed');
