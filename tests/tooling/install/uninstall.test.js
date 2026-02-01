#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot } from '../../helpers/root.js';

const root = repoRoot();
const baseDir = path.join(root, '.testCache', 'uninstall');
const repoDir = path.join(baseDir, 'repo');
const cacheRoot = path.join(baseDir, 'cache');
const dictDir = path.join(cacheRoot, 'dictionaries');
const modelsDir = path.join(cacheRoot, 'models');
const appDataRoot = path.join(baseDir, 'LocalAppData');
const defaultCacheRoot = path.join(appDataRoot, 'PairOfCleats');
const extensionsDir = path.join(defaultCacheRoot, 'extensions');

await fsPromises.rm(baseDir, { recursive: true, force: true });
await fsPromises.mkdir(repoDir, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.mkdir(dictDir, { recursive: true });
await fsPromises.mkdir(modelsDir, { recursive: true });
await fsPromises.mkdir(extensionsDir, { recursive: true });

await fsPromises.writeFile(
  path.join(repoDir, '.pairofcleats.json'),
  JSON.stringify({
    cache: { root: cacheRoot }
  }, null, 2)
);

await fsPromises.writeFile(path.join(cacheRoot, 'marker.txt'), 'cache');
await fsPromises.writeFile(path.join(dictDir, 'dict.txt'), 'dict');
await fsPromises.writeFile(path.join(modelsDir, 'model.bin'), 'model');
await fsPromises.writeFile(path.join(extensionsDir, 'vec0.dll'), 'ext');

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  LOCALAPPDATA: appDataRoot
};

const result = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'uninstall.js'), '--yes', '--repo', repoDir],
  { env, stdio: 'inherit', cwd: repoDir }
);

if (result.status !== 0) {
  console.error('Uninstall test failed: script exited with non-zero status.');
  process.exit(result.status ?? 1);
}

const exists = (target) => fs.existsSync(target);
const failures = [];
if (exists(cacheRoot)) failures.push(`cache root still exists: ${cacheRoot}`);
if (exists(dictDir)) failures.push(`dict dir still exists: ${dictDir}`);
if (exists(modelsDir)) failures.push(`models dir still exists: ${modelsDir}`);
if (exists(extensionsDir)) failures.push(`extensions dir still exists: ${extensionsDir}`);

if (failures.length) {
  failures.forEach((msg) => console.error(msg));
  process.exit(1);
}

console.log('Uninstall test passed');

