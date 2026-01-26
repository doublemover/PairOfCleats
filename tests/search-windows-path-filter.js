#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'windows-path-filter');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src', 'nested'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'nested', 'util.js'),
  'export function winPathFilter() { return "windows path filter"; }\n'
);

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub',
  PAIROFCLEATS_WORKER_POOL: 'off'
};

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  console.error('Failed: build_index');
  process.exit(buildResult.status ?? 1);
}

function runSearch(extraArgs) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'search.js'),
      'windows path filter',
      '--json',
      '--mode',
      'code',
      '--no-ann',
      '--repo',
      repoRoot,
      ...extraArgs
    ],
    { encoding: 'utf8', env }
  );
  if (result.status !== 0) {
    console.error('Search failed.');
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  try {
    return JSON.parse(result.stdout || '{}');
  } catch {
    console.error('Search output was not valid JSON.');
    process.exit(1);
  }
}

const filePayload = runSearch(['--file', 'src\\nested\\util.js']);
if (!Array.isArray(filePayload.code) || filePayload.code.length === 0) {
  console.error('Expected results for Windows-style --file filter.');
  process.exit(1);
}

const pathPayload = runSearch(['--path', 'src\\nested']);
if (!Array.isArray(pathPayload.code) || pathPayload.code.length === 0) {
  console.error('Expected results for Windows-style --path filter.');
  process.exit(1);
}

console.log('windows path filter test passed');

