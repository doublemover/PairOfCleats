#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getRepoCacheRoot } from '../../../tools/dict-utils.js';

const root = process.cwd();
const baseDir = path.join(root, '.testCache', 'clean-artifacts');
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
await fsPromises.mkdir(path.join(repoCacheRoot, 'metrics'), { recursive: true });
await fsPromises.writeFile(path.join(repoCacheRoot, 'index-code', 'chunk_meta.json'), '[]');
await fsPromises.writeFile(path.join(repoCacheRoot, 'index-prose', 'chunk_meta.json'), '[]');
await fsPromises.writeFile(path.join(repoCacheRoot, 'metrics', 'metrics.json'), '{}');

const cacheSqliteDir = path.join(repoCacheRoot, 'index-sqlite');
await fsPromises.mkdir(cacheSqliteDir, { recursive: true });
await fsPromises.writeFile(path.join(cacheSqliteDir, 'index-code.db'), 'code');
await fsPromises.writeFile(path.join(cacheSqliteDir, 'index-prose.db'), 'prose');
await fsPromises.writeFile(path.join(cacheSqliteDir, 'index.db'), 'legacy');
await fsPromises.writeFile(path.join(cacheSqliteDir, 'index-code.db.bak'), 'code-bak');
await fsPromises.writeFile(path.join(cacheSqliteDir, 'index.db.bak'), 'legacy-bak');

const legacySqliteDir = path.join(repoRoot, 'index-sqlite');
await fsPromises.mkdir(legacySqliteDir, { recursive: true });
await fsPromises.writeFile(path.join(legacySqliteDir, 'index-code.db'), 'legacy-code');
await fsPromises.writeFile(path.join(legacySqliteDir, 'index-prose.db'), 'legacy-prose');
await fsPromises.writeFile(path.join(legacySqliteDir, 'index.db'), 'legacy-index');
await fsPromises.writeFile(path.join(legacySqliteDir, 'index.db.bak'), 'legacy-index-bak');

const modelsDir = path.join(cacheRoot, 'models');
const dictDir = path.join(cacheRoot, 'dictionaries');
const extensionsDir = path.join(cacheRoot, 'extensions');
await fsPromises.mkdir(modelsDir, { recursive: true });
await fsPromises.mkdir(dictDir, { recursive: true });
await fsPromises.mkdir(extensionsDir, { recursive: true });
await fsPromises.writeFile(path.join(modelsDir, 'model.bin'), 'model');
await fsPromises.writeFile(path.join(dictDir, 'en.txt'), 'word');
await fsPromises.writeFile(path.join(extensionsDir, 'ext.bin'), 'ext');

const result = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'clean-artifacts.js'), '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);

if (result.status !== 0) {
  console.error('clean-artifacts test failed: script exited with non-zero status.');
  process.exit(result.status ?? 1);
}

const failures = [];
if (fs.existsSync(repoCacheRoot)) failures.push(`repo cache root still exists: ${repoCacheRoot}`);
if (fs.existsSync(legacySqliteDir)) failures.push(`legacy sqlite dir still exists: ${legacySqliteDir}`);
if (fs.existsSync(path.join(cacheSqliteDir, 'index-code.db.bak'))) {
  failures.push('sqlite .bak file still exists after clean-artifacts.');
}
if (fs.existsSync(path.join(legacySqliteDir, 'index.db.bak'))) {
  failures.push('legacy sqlite .bak file still exists after clean-artifacts.');
}
if (!fs.existsSync(modelsDir)) failures.push('models dir missing after clean-artifacts.');
if (!fs.existsSync(dictDir)) failures.push('dictionaries dir missing after clean-artifacts.');
if (!fs.existsSync(extensionsDir)) failures.push('extensions dir missing after clean-artifacts.');

await fsPromises.mkdir(repoCacheRoot, { recursive: true });
await fsPromises.writeFile(path.join(repoCacheRoot, 'marker.txt'), 'marker');

const resultAll = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'clean-artifacts.js'), '--repo', repoRoot, '--all'],
  { cwd: repoRoot, env, stdio: 'inherit' }
);

if (resultAll.status !== 0) {
  console.error('clean-artifacts --all test failed: script exited with non-zero status.');
  process.exit(resultAll.status ?? 1);
}

if (fs.existsSync(path.join(cacheRoot, 'repos'))) {
  failures.push(`cache repos dir still exists after --all: ${path.join(cacheRoot, 'repos')}`);
}
if (!fs.existsSync(modelsDir)) failures.push('models dir missing after clean-artifacts --all.');
if (!fs.existsSync(dictDir)) failures.push('dictionaries dir missing after clean-artifacts --all.');
if (!fs.existsSync(extensionsDir)) failures.push('extensions dir missing after clean-artifacts --all.');

if (failures.length) {
  failures.forEach((msg) => console.error(msg));
  process.exit(1);
}

console.log('clean-artifacts test passed');

