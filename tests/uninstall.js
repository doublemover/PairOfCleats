#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const baseDir = path.join(root, 'tests', '.cache', 'uninstall');
const cacheRoot = path.join(baseDir, 'cache');
const dictDir = path.join(baseDir, 'dicts');
const modelsDir = path.join(baseDir, 'models');
const extensionsDir = path.join(baseDir, 'extensions');

await fsPromises.rm(baseDir, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.mkdir(dictDir, { recursive: true });
await fsPromises.mkdir(modelsDir, { recursive: true });
await fsPromises.mkdir(extensionsDir, { recursive: true });

await fsPromises.writeFile(path.join(cacheRoot, 'marker.txt'), 'cache');
await fsPromises.writeFile(path.join(dictDir, 'dict.txt'), 'dict');
await fsPromises.writeFile(path.join(modelsDir, 'model.bin'), 'model');
await fsPromises.writeFile(path.join(extensionsDir, 'vec0.dll'), 'ext');

const env = {
  ...process.env,
  PAIROFCLEATS_HOME: baseDir,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_DICT_DIR: dictDir,
  PAIROFCLEATS_MODELS_DIR: modelsDir,
  PAIROFCLEATS_EXTENSIONS_DIR: extensionsDir
};

const result = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'uninstall.js'), '--yes'],
  { env, stdio: 'inherit' }
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
