#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'indexer-service-backpressure');
const repoRoot = path.join(tempRoot, 'repo');
const queueDir = path.join(tempRoot, 'queue');
const configPath = path.join(tempRoot, 'service.json');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });

const config = {
  queueDir,
  queue: {
    maxQueued: 1,
    maxRunning: 1,
    maxTotal: 1,
    resourceBudgetUnits: 2
  },
  repos: [
    { id: 'repo', path: repoRoot, syncPolicy: 'none' }
  ]
};
await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2));

const runCli = (...args) => spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'service', 'indexer-service.js'), ...args],
  { encoding: 'utf8' }
);

const first = runCli('enqueue', '--config', configPath, '--repo', repoRoot, '--mode', 'code', '--json');
assert.equal(first.status, 0, 'expected first enqueue to succeed');
const firstPayload = JSON.parse(first.stdout || '{}');
assert.equal(firstPayload.ok, true);

const second = runCli('enqueue', '--config', configPath, '--repo', repoRoot, '--mode', 'code', '--stage', 'stage2', '--json');
assert.equal(second.status, 1, 'expected overload enqueue to exit non-zero');
const secondPayload = JSON.parse(second.stdout || '{}');
assert.equal(secondPayload.ok, false, 'expected overload payload to be marked failed');
assert.equal(secondPayload.code, 'QUEUE_BACKPRESSURE_MAX_QUEUED', 'expected stable queue overload code');
assert.equal(secondPayload.backpressure?.state, 'saturated', 'expected overload payload to expose saturated backpressure state');
assert.equal(secondPayload.backpressure?.rejectReason, 'max_queued', 'expected explicit overload reason in payload');

const status = runCli('status', '--config', configPath, '--json');
assert.equal(status.status, 0, 'expected status command to succeed');
const statusPayload = JSON.parse(status.stdout || '{}');
assert.equal(statusPayload.backpressure?.state, 'saturated', 'expected status to surface queue backpressure state');
assert.equal(statusPayload.backpressure?.reasons.includes('max_queued'), true, 'expected status to expose queue saturation reasons');
assert.equal(typeof statusPayload.backpressure?.slo?.state, 'string', 'expected status to include queue SLO state');

console.log('indexer service backpressure cli test passed');
