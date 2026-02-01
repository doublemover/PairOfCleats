#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'code-map-determinism');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'one.js'),
  'export function alpha() { return 1; }\n'
);
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'two.js'),
  'import { alpha } from "./one.js";\nexport function beta() { return alpha(); }\n'
);

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);

if (buildResult.status !== 0) {
  console.error('Failed: build index for determinism test');
  process.exit(buildResult.status ?? 1);
}

const runMap = () => spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'report-code-map.js'), '--format', 'json', '--repo', repoRoot],
  { cwd: repoRoot, env, encoding: 'utf8' }
);

const first = runMap();
const second = runMap();

if (first.status !== 0 || second.status !== 0) {
  console.error('Failed: map generator runs');
  process.exit(1);
}

const strip = (payload) => {
  const clone = JSON.parse(JSON.stringify(payload));
  clone.generatedAt = null;
  if (clone.summary) clone.summary.generatedAt = null;
  return clone;
};

const firstPayload = strip(JSON.parse(first.stdout || '{}'));
const secondPayload = strip(JSON.parse(second.stdout || '{}'));

if (JSON.stringify(firstPayload) !== JSON.stringify(secondPayload)) {
  console.error('Failed: map output not deterministic');
  process.exit(1);
}

console.log('code map determinism tests passed');

