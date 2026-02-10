#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();

const runJsonBench = (scriptPath, args) => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, scriptPath), ...args, '--json'],
    { cwd: root, env: process.env, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    console.error(result.stdout || '');
    console.error(result.stderr || '');
    process.exit(result.status ?? 1);
  }
  const raw = String(result.stdout || '').trim();
  if (!raw) {
    console.error(result.stderr || '');
    throw new Error(`No JSON output from ${scriptPath}`);
  }
  return JSON.parse(raw);
};

const parallel = runJsonBench('tools/bench/vfs/parallel-manifest-build.js', [
  '--segments',
  '500',
  '--segment-bytes',
  '64',
  '--concurrency',
  '1,2,4',
  '--samples',
  '2'
]);

assert.equal(parallel.segments, 500);
assert.ok(Array.isArray(parallel.scenarios) && parallel.scenarios.length === 3, 'expected 3 concurrency scenarios');
for (const scenario of parallel.scenarios) {
  assert.equal(scenario.rows, 500, 'expected manifest rows to match segments');
  assert.ok(Number.isFinite(scenario.rowsPerSec) && scenario.rowsPerSec > 0, 'expected rowsPerSec');
  assert.ok(scenario.stats && Number.isFinite(scenario.stats.p50), 'expected timing stats');
}

const merge = runJsonBench('tools/bench/vfs/merge-runs-heap.js', [
  '--runs',
  '10,200',
  '--run-size',
  '500',
  '--samples',
  '1'
]);

assert.ok(Array.isArray(merge.scenarios) && merge.scenarios.length >= 2, 'expected merge scenarios');
for (const scenario of merge.scenarios) {
  assert.equal(scenario.linear.checksum, scenario.heap.checksum, 'expected heap and linear merges to match');
  assert.ok(Number.isFinite(scenario.linear.itemsPerSec), 'expected linear itemsPerSec');
  assert.ok(Number.isFinite(scenario.heap.itemsPerSec), 'expected heap itemsPerSec');
  if (scenario.runs >= 200) {
    assert.ok(
      scenario.heap.itemsPerSec >= scenario.linear.itemsPerSec,
      'expected heap merge to dominate linear merge at high run counts'
    );
  }
}

const vfsidx = runJsonBench('tools/bench/vfs/vfsidx-lookup.js', [
  '--rows',
  '5000',
  '--lookups',
  '5000',
  '--samples',
  '5',
  '--seed',
  '1'
]);

assert.ok(vfsidx.bench?.indexedLookup?.opsPerSec > 0, 'expected indexed opsPerSec');
assert.ok(vfsidx.bench?.fullScan?.opsPerSec > 0, 'expected scan opsPerSec');
assert.ok(
  vfsidx.bench.indexedLookup.opsPerSec >= vfsidx.bench.fullScan.opsPerSec * 2,
  'expected indexed lookup to significantly outperform full scan'
);

const routing = runJsonBench('tools/bench/vfs/hash-routing-lookup.js', [
  '--docs',
  '5000',
  '--lookups',
  '5000',
  '--samples',
  '5',
  '--seed',
  '1',
  '--missing-doc-hash-rate',
  '0'
]);

assert.equal(routing.fallbacks?.missingDocHash, 0, 'expected no docHash fallbacks');
assert.equal(routing.validation?.mismatches, 0, 'expected hash routing resolution to match spec');
assert.ok(routing.bench?.hashLookup?.opsPerSec > 0, 'expected hash routing lookup opsPerSec');

const bloom = runJsonBench('tools/bench/vfs/bloom-negative-lookup.js', [
  '--keys',
  '5000',
  '--lookups',
  '20000',
  '--bits',
  '200000',
  '--hashes',
  '3',
  '--samples',
  '5',
  '--seed',
  '1'
]);

assert.ok(Number.isFinite(bloom.falsePositiveRate), 'expected bloom falsePositiveRate');
assert.ok(bloom.falsePositiveRate >= 0 && bloom.falsePositiveRate <= 1, 'expected bloom falsePositiveRate in range');
assert.ok(bloom.falsePositiveRate < 0.02, 'expected bloom falsePositiveRate to remain low');

console.log('VFS bench contract test passed');

