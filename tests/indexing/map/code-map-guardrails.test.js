#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'code-map-guardrails');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });

const funcs = [];
for (let i = 0; i < 120; i += 1) {
  funcs.push(`export function fn${i}() { return ${i}; }`);
}
await fsPromises.writeFile(path.join(repoRoot, 'src', 'many.js'), funcs.join('\n'));

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off'
  }
});

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--scm-provider', 'none', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);

if (buildResult.status !== 0) {
  console.error('Failed: build index for guardrails test');
  process.exit(buildResult.status ?? 1);
}

const mapResult = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'reports/report-code-map.js'),
    '--format', 'json',
    '--repo', repoRoot,
    '--max-members-per-file', '5',
    '--max-files', '1',
    '--max-edges', '2'
  ],
  { cwd: repoRoot, env, encoding: 'utf8' }
);

if (mapResult.status !== 0) {
  console.error('Failed: guardrails map output');
  process.exit(mapResult.status ?? 1);
}

const payload = JSON.parse(mapResult.stdout || '{}');
const summary = payload.summary || {};
const dropped = summary.dropped || {};
if (!summary.truncated) {
  console.error('Failed: guardrails did not truncate');
  process.exit(1);
}
if (!dropped.members || dropped.members < 1) {
  console.error('Failed: guardrails did not drop members');
  process.exit(1);
}

console.log('code map guardrails tests passed');
