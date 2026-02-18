#!/usr/bin/env node
import { applyTestEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runSearchCli } from '../../src/retrieval/cli.js';
import { createPointerSnapshot } from '../../src/index/snapshots/create.js';
import { loadUserConfig } from '../../tools/shared/dict-utils.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'snapshot-query-service');
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });
await fs.cp(fixtureRoot, repoRoot, { recursive: true });

process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';
process.env.PAIROFCLEATS_WORKER_POOL = 'off';
process.env.PAIROFCLEATS_TEST_CONFIG = JSON.stringify({
  indexing: {
    embeddings: {
      enabled: false,
      mode: 'off',
      lancedb: { enabled: false },
      hnsw: { enabled: false }
    }
  }
});

const runBuild = () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'build_index.js'),
      '--repo',
      repoRoot,
      '--mode',
      'code',
      '--stub-embeddings',
      '--no-sqlite',
      '--progress',
      'off'
    ],
    {
      cwd: repoRoot,
      env: process.env,
      encoding: 'utf8'
    }
  );
  if (result.status !== 0) {
    throw new Error(`build_index failed: ${result.stderr || result.stdout || 'unknown error'}`);
  }
};

const markerPath = path.join(repoRoot, 'src', 'phase14-snapshot-query.js');
await fs.mkdir(path.dirname(markerPath), { recursive: true });
await fs.writeFile(markerPath, 'export const phase14_marker = "phase14alpha";\n', 'utf8');

runBuild();

const userConfig = loadUserConfig(repoRoot);

const snapshotA = 'snap-20260212000000-snapqa';
await createPointerSnapshot({
  repoRoot,
  userConfig,
  modes: ['code'],
  snapshotId: snapshotA
});

await fs.writeFile(markerPath, 'export const phase14_marker = "phase14beta";\n', 'utf8');
runBuild();

const snapshotB = 'snap-20260212000000-snapqb';
await createPointerSnapshot({
  repoRoot,
  userConfig,
  modes: ['code'],
  snapshotId: snapshotB
});

const searchA = await runSearchCli([
  '--repo',
  repoRoot,
  '--mode',
  'code',
  '--backend',
  'memory',
  '--top',
  '50',
  '--json',
  '--compact',
  '--snapshot',
  snapshotA,
  '--',
  'phase14alpha'
], {
  emitOutput: false,
  exitOnError: false
});

assert.equal(searchA.asOf?.ref, `snap:${snapshotA}`, 'snapshot alias should normalize to as-of snap:<id>');
assert.ok(
  Array.isArray(searchA.code)
  && searchA.code.some((hit) => String(hit.file || '').includes('phase14-snapshot-query.js')),
  'snapshot A query should find the alpha marker'
);
const snapshotAHit = searchA.code.find((hit) => String(hit.file || '').includes('phase14-snapshot-query.js'));

const searchB = await runSearchCli([
  '--repo',
  repoRoot,
  '--mode',
  'code',
  '--backend',
  'memory',
  '--top',
  '50',
  '--json',
  '--compact',
  '--snapshot',
  snapshotB,
  '--',
  'phase14alpha'
], {
  emitOutput: false,
  exitOnError: false
});

const snapshotBHit = Array.isArray(searchB.code)
  ? searchB.code.find((hit) => String(hit.file || '').includes('phase14-snapshot-query.js'))
  : null;
assert.ok(snapshotBHit, 'snapshot B query should still resolve marker file in its own snapshot state');
assert.notEqual(
  snapshotAHit?.end ?? null,
  snapshotBHit?.end ?? null,
  'snapshot A and B should yield different chunk bounds for the same query'
);

const latest = await runSearchCli([
  '--repo',
  repoRoot,
  '--mode',
  'code',
  '--backend',
  'memory',
  '--top',
  '50',
  '--json',
  '--compact',
  '--',
  'phase14beta'
], {
  emitOutput: false,
  exitOnError: false
});

assert.equal(latest.asOf?.ref, 'latest', 'latest should remain the default as-of ref');
const latestHit = Array.isArray(latest.code)
  ? latest.code.find((hit) => String(hit.file || '').includes('phase14-snapshot-query.js'))
  : null;
assert.ok(
  Array.isArray(latest.code)
  && latest.code.some((hit) => String(hit.file || '').includes('phase14-snapshot-query.js')),
  'latest query should resolve to current build without snapshot flag'
);
assert.equal(latestHit?.end ?? null, snapshotBHit?.end ?? null, 'latest should match snapshot B (current build)');

console.log('snapshot query service test passed');
