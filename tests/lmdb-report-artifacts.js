#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, 'tests', '.cache', 'lmdb-report-artifacts');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

const run = (args, label, options = {}) => {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env,
    ...options
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result;
};

run(
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  'build index',
  { stdio: 'inherit' }
);

run(
  [path.join(root, 'tools', 'build-lmdb-index.js'), '--mode', 'all', '--repo', repoRoot],
  'build lmdb index',
  { stdio: 'inherit' }
);

const report = run(
  [path.join(root, 'tools', 'report-artifacts.js'), '--json', '--repo', repoRoot],
  'report artifacts',
  { encoding: 'utf8' }
);

let payload = null;
try {
  payload = JSON.parse(report.stdout || '{}');
} catch {
  console.error('Failed to parse report-artifacts JSON output.');
  process.exit(1);
}

const lmdbThroughput = payload?.throughput?.lmdb;
if (!lmdbThroughput?.code || !Number.isFinite(lmdbThroughput.code.chunksPerSec)) {
  console.error('LMDB code throughput missing or invalid in report-artifacts.');
  process.exit(1);
}
if (!lmdbThroughput?.prose || !Number.isFinite(lmdbThroughput.prose.chunksPerSec)) {
  console.error('LMDB prose throughput missing or invalid in report-artifacts.');
  process.exit(1);
}
if (payload?.corruption?.lmdb?.ok !== true) {
  console.error('LMDB corruption report expected ok=true.');
  process.exit(1);
}

console.log('lmdb report artifacts test passed');
