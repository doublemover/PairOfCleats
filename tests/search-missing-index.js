#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from './helpers/stdio.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'search-missing-index');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const result = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), 'alpha', '--mode', 'code', '--no-ann', '--repo', repoRoot],
  { encoding: 'utf8', env }
);

if (result.status === 0) {
  console.error('Expected search to fail when index is missing.');
  console.error('stdout:', result.stdout || '<empty>');
  console.error('stderr:', result.stderr || '<empty>');
  process.exit(1);
}

const output = getCombinedOutput(result);
if (!output.includes('build-index')) {
  console.error('Expected missing index message to include build-index hint.');
  console.error('exit status:', result.status);
  console.error('stdout:', result.stdout || '<empty>');
  console.error('stderr:', result.stderr || '<empty>');
  console.error('combined output:', output || '<empty>');
  process.exit(1);
}

console.log('missing index test passed');

