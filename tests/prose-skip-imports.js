#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const cacheRoot = path.join(root, '.testCache', 'prose-skip-imports');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const result = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--mode', 'prose', '--repo', fixtureRoot],
  { cwd: fixtureRoot, env, encoding: 'utf8' }
);

if (result.status !== 0) {
  console.error('Failed: build_index prose mode');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

const stderr = result.stderr || '';
if (stderr.includes('Scanning for imports')) {
  console.error('Prose mode should skip import scanning, but imports log was present.');
  process.exit(1);
}

console.log('Prose import scan skip test passed');

