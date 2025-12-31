#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const cacheRoot = path.join(root, 'tests', '.cache', 'index-validate');
const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const validatorPath = path.join(root, 'tools', 'index-validate.js');
const buildPath = path.join(root, 'build_index.js');

const missingResult = spawnSync(
  process.execPath,
  [validatorPath, '--repo', fixtureRoot, '--json'],
  { env, encoding: 'utf8' }
);
if (missingResult.status === 0) {
  console.error('Expected index-validate to fail when indexes are missing.');
  process.exit(1);
}

const buildResult = spawnSync(
  process.execPath,
  [buildPath, '--stub-embeddings', '--repo', fixtureRoot],
  { env, encoding: 'utf8' }
);
if (buildResult.status !== 0) {
  console.error('Failed to build fixture index for index-validate test.');
  if (buildResult.stderr) console.error(buildResult.stderr.trim());
  process.exit(buildResult.status ?? 1);
}

const okResult = spawnSync(
  process.execPath,
  [validatorPath, '--repo', fixtureRoot, '--json'],
  { env, encoding: 'utf8' }
);
if (okResult.status !== 0) {
  console.error('Expected index-validate to pass after building index.');
  if (okResult.stderr) console.error(okResult.stderr.trim());
  process.exit(okResult.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(okResult.stdout);
} catch {
  console.error('index-validate did not return valid JSON.');
  process.exit(1);
}
if (!payload || payload.ok !== true) {
  console.error('index-validate JSON payload missing ok=true.');
  process.exit(1);
}

console.log('index-validate test passed');
