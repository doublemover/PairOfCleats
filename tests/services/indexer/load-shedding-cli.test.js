#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { saveQueue } from '../../../tools/service/queue.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'indexer-service-load-shedding');
const repoRoot = path.join(tempRoot, 'repo');
const queueDir = path.join(tempRoot, 'queue');
const configPath = path.join(tempRoot, 'service.json');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });

const config = {
  queueDir,
  queue: {
    maxQueued: 10,
    maxRunning: 10,
    maxTotal: 20,
    resourceBudgetUnits: 40,
    slo: {
      maxQueueAgeMs: {
        degraded: 1000,
        overloaded: 15000
      },
      maxRunLatencyMs: {
        degraded: 1000,
        overloaded: 15000
      },
      maxRetryRate: {
        degraded: 0.25,
        overloaded: 0.5
      },
      maxSaturationRatio: {
        degraded: 0.5,
        overloaded: 0.9
      },
      deferDelayMs: {
        degraded: 2000,
        overloaded: 12000
      }
    }
  },
  repos: [
    { id: 'repo', path: repoRoot, syncPolicy: 'none' }
  ]
};
await fs.writeFile(configPath, JSON.stringify(config, null, 2));

await saveQueue(queueDir, {
  jobs: [
    {
      id: 'existing-aged',
      status: 'queued',
      queueName: 'index',
      repo: repoRoot,
      mode: 'code',
      stage: 'stage1',
      createdAt: new Date(Date.now() - 2000).toISOString(),
      attempts: 0
    }
  ]
}, 'index');

const runCli = (...args) => spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'service', 'indexer-service.js'), ...args],
  { encoding: 'utf8' }
);

const enqueue = runCli('enqueue', '--config', configPath, '--repo', repoRoot, '--mode', 'both', '--stage', 'stage3', '--json');
assert.equal(enqueue.status, 0, 'expected degraded heavy enqueue to succeed with deferral');
const enqueuePayload = JSON.parse(enqueue.stdout || '{}');
assert.equal(enqueuePayload.ok, true, 'expected enqueue payload to be successful');
assert.equal(enqueuePayload.deferred, true, 'expected heavy work to be deferred');
assert.equal(enqueuePayload.backpressure?.action, 'defer', 'expected enqueue payload to expose defer action');
assert.equal(enqueuePayload.backpressure?.slo?.state, 'degraded', 'expected enqueue payload to expose degraded SLO state');

const status = runCli('status', '--config', configPath, '--json');
assert.equal(status.status, 0, 'expected status command to succeed');
const statusPayload = JSON.parse(status.stdout || '{}');
assert.equal(statusPayload.backpressure?.slo?.state === 'degraded' || statusPayload.backpressure?.slo?.state === 'overloaded', true, 'expected status to expose a non-healthy SLO state');
assert.equal(statusPayload.backpressure?.slo?.actions?.workerMode, 'priority-only', 'expected status to expose priority-only mode');

console.log('indexer service load shedding cli test passed');
