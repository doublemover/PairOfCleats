#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getRepoCacheRoot } from '../tools/dict-utils.js';

const root = process.cwd();
const baseDir = path.join(root, 'tests', '.cache', 'clean-artifacts');
const repoRoot = path.join(baseDir, 'repo');
const cacheRoot = path.join(baseDir, 'cache');

await fsPromises.rm(baseDir, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot
};

const repoCacheRoot = getRepoCacheRoot(repoRoot, null);
await fsPromises.mkdir(path.join(repoCacheRoot, 'index-code'), { recursive: true });
await fsPromises.mkdir(path.join(repoCacheRoot, 'index-prose'), { recursive: true });
await fsPromises.mkdir(path.join(repoCacheRoot, 'repometrics'), { recursive: true });
await fsPromises.writeFile(path.join(repoCacheRoot, 'index-code', 'chunk_meta.json'), '[]');
await fsPromises.writeFile(path.join(repoCacheRoot, 'index-prose', 'chunk_meta.json'), '[]');
await fsPromises.writeFile(path.join(repoCacheRoot, 'repometrics', 'metrics.json'), '{}');

const localSqliteDir = path.join(repoRoot, 'index-sqlite');
await fsPromises.mkdir(localSqliteDir, { recursive: true });
await fsPromises.writeFile(path.join(localSqliteDir, 'index-code.db'), 'code');
await fsPromises.writeFile(path.join(localSqliteDir, 'index-prose.db'), 'prose');
await fsPromises.writeFile(path.join(localSqliteDir, 'index.db'), 'legacy');

const result = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'clean-artifacts.js')],
  { cwd: repoRoot, env, stdio: 'inherit' }
);

if (result.status !== 0) {
  console.error('clean-artifacts test failed: script exited with non-zero status.');
  process.exit(result.status ?? 1);
}

const failures = [];
if (fs.existsSync(repoCacheRoot)) failures.push(`repo cache root still exists: ${repoCacheRoot}`);
if (fs.existsSync(localSqliteDir)) failures.push(`local sqlite dir still exists: ${localSqliteDir}`);

if (failures.length) {
  failures.forEach((msg) => console.error(msg));
  process.exit(1);
}

console.log('clean-artifacts test passed');
