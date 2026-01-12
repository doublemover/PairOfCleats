#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'search-contract');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, 'README.md'),
  '# Sample\n\nalpha bravo\n'
);

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);

if (buildResult.status !== 0) {
  console.error('Failed: build index for search contract');
  process.exit(buildResult.status ?? 1);
}

const searchPath = path.join(root, 'search.js');
const result = spawnSync(
  process.execPath,
  [searchPath, 'alpha', '--mode', 'prose', '--json', '--backend', 'memory', '--no-ann', '--repo', repoRoot],
  { cwd: repoRoot, env, encoding: 'utf8' }
);

if (result.status !== 0) {
  console.error('Failed: search contract run');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

let payload = null;
try {
  payload = JSON.parse(result.stdout || '{}');
} catch {
  console.error('Failed: search contract returned invalid JSON');
  process.exit(1);
}

if (!payload || typeof payload !== 'object') {
  console.error('Failed: search contract payload missing');
  process.exit(1);
}

for (const key of ['backend', 'code', 'prose', 'records', 'stats']) {
  if (!(key in payload)) {
    console.error(`Failed: search contract missing ${key}`);
    process.exit(1);
  }
}

if (!Array.isArray(payload.prose) || payload.prose.length === 0) {
  console.error('Failed: search contract expected prose hits');
  process.exit(1);
}

const hit = payload.prose[0];
if (!hit || !hit.file) {
  console.error('Failed: search contract hit missing file');
  process.exit(1);
}
if (!Number.isFinite(hit.startLine)) {
  console.error('Failed: search contract hit missing startLine');
  process.exit(1);
}

console.log('search contract tests passed');
