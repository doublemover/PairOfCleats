#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'tool-root');
const repoRoot = path.join(tempRoot, 'repo');
const outsideRoot = path.join(tempRoot, 'outside');
const cacheRoot = path.join(tempRoot, 'cache');
const srcDir = path.join(repoRoot, 'src');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(srcDir, { recursive: true });
await fsPromises.mkdir(outsideRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(
  path.join(srcDir, 'index.js'),
  'export function greet(name) {\n  return `hi ${name}`;\n}\n',
  'utf8'
);

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: outsideRoot, env, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  console.error('Failed: build_index from outside repo root');
  process.exit(buildResult.status ?? 1);
}

const searchResult = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), 'greet', '--json', '--no-ann', '--repo', repoRoot],
  { cwd: outsideRoot, env, encoding: 'utf8' }
);
if (searchResult.status !== 0) {
  console.error('Failed: search from outside repo root');
  console.error(searchResult.stderr || searchResult.stdout || '');
  process.exit(searchResult.status ?? 1);
}

let payload = null;
try {
  payload = JSON.parse(searchResult.stdout || '{}');
} catch {
  console.error('Failed: search output was not JSON');
  process.exit(1);
}

const hits = payload.code || [];
if (!hits.length) {
  console.error('Failed: search returned no results');
  process.exit(1);
}

console.log('Tool root outside-repo test passed');
