#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { normalizeWorkerPoolConfig } from '../../../src/index/build/workers/config.js';

assert.equal(normalizeWorkerPoolConfig({}).processFallback, false, 'inline fallback remains the safe default');
const control = spawnSync(process.execPath, ['--max-old-space-size=128', '--max-semi-space-size=8', '-e',
  'console.log(require("node:v8").getHeapStatistics().heap_size_limit)'], { encoding: 'utf8', timeout: 5000, env: { ...process.env, NODE_OPTIONS: '' } });
assert.equal(control.status, 0, control.stderr);
const controlHeap = Number(control.stdout.trim());
for (const [flags, nodeOptions] of [[['--max-old-space-size=16384'], ''], [[], '--max-old-space-size=16384']]) {
  const result = spawnSync(process.execPath, [...flags, path.resolve('tests/indexing/workers/process-backend-heap-parity-child.js')],
    { encoding: 'utf8', timeout: 10000, env: { ...process.env, NODE_OPTIONS: nodeOptions } });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(receipt.observations.length, 2);
  for (const observed of receipt.observations) assert.equal(observed.heapSizeLimitBytes, controlHeap,
    'independent child startup matches a separately launched 128-MiB-old-space control');
  assert.ok(receipt.process.peakChildren <= 2);
}
console.log('CLI/NODE_OPTIONS large parent heaps retain bounded independent process execution with exact task parity.');
