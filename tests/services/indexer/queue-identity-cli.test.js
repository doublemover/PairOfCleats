#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import {
  isEmbeddingsQueueName,
  isMonitoredIndexQueueName,
  resolveServiceQueueName
} from '../../../tools/service/indexer-service/queue-identity.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'indexer-service-queue-identity');
const repoRoot = path.join(tempRoot, 'repo');
const queueDir = path.join(tempRoot, 'queue');
const configPath = path.join(tempRoot, 'service.json');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });

await fsPromises.writeFile(configPath, JSON.stringify({
  queueDir,
  queue: {
    maxRetries: 2,
    maxQueued: 20,
    maxRunning: 1,
    maxTotal: 21
  },
  worker: {
    concurrency: 1
  },
  embeddings: {
    queue: {
      maxRetries: 5,
      maxQueued: 3,
      maxRunning: 2,
      maxTotal: 5
    },
    worker: {
      concurrency: 2
    }
  },
  repos: [
    { id: 'repo', path: repoRoot, syncPolicy: 'none' }
  ]
}, null, 2));

const runCli = (...args) => spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'service', 'indexer-service.js'), ...args],
  { encoding: 'utf8' }
);

assert.equal(isEmbeddingsQueueName('embeddings-stage3'), true);
assert.equal(isEmbeddingsQueueName('index-stage2'), false);
assert.equal(isMonitoredIndexQueueName('index-stage2'), true);
assert.equal(isMonitoredIndexQueueName('embeddings-stage3'), false);
assert.equal(
  resolveServiceQueueName({ queueName: 'auto', reason: 'embeddings', stage: 'stage3', mode: 'code' }),
  'embeddings-stage3-code'
);

const autoStatus = runCli('status', '--config', configPath, '--queue', 'auto', '--reason', 'embeddings', '--stage', 'stage3', '--mode', 'code', '--json');
assert.equal(autoStatus.status, 0, autoStatus.stderr || autoStatus.stdout);
const autoStatusPayload = JSON.parse(autoStatus.stdout || '{}');
assert.equal(autoStatusPayload.name, 'embeddings-stage3-code');
assert.equal(autoStatusPayload.envelope?.queueClass, 'embeddings');
assert.equal(autoStatusPayload.envelope?.worker?.concurrency, 2);

const derivedIndexStatus = runCli('status', '--config', configPath, '--queue', 'index-stage2', '--json');
assert.equal(derivedIndexStatus.status, 0, derivedIndexStatus.stderr || derivedIndexStatus.stdout);
const derivedIndexPayload = JSON.parse(derivedIndexStatus.stdout || '{}');
assert.equal(derivedIndexPayload.name, 'index-stage2');
assert.equal(derivedIndexPayload.envelope?.queueClass, 'index');

const enqueue = runCli(
  'enqueue',
  '--config', configPath,
  '--queue', 'auto',
  '--reason', 'embeddings',
  '--stage', 'stage3',
  '--repo', repoRoot,
  '--mode', 'code',
  '--json'
);
assert.equal(enqueue.status, 0, enqueue.stderr || enqueue.stdout);
const enqueuePayload = JSON.parse(enqueue.stdout || '{}');
assert.equal(enqueuePayload.ok, true);

const embeddingsStatus = runCli('status', '--config', configPath, '--queue', 'embeddings-stage3-code', '--json');
assert.equal(embeddingsStatus.status, 0, embeddingsStatus.stderr || embeddingsStatus.stdout);
const embeddingsStatusPayload = JSON.parse(embeddingsStatus.stdout || '{}');
assert.equal(embeddingsStatusPayload.queue?.queued, 1, 'expected auto embeddings enqueue to land in embeddings-stage3-code');

const shutdown = runCli(
  'shutdown',
  '--config', configPath,
  '--queue', 'auto',
  '--reason', 'embeddings',
  '--stage', 'stage3',
  '--mode', 'code',
  '--shutdown-mode', 'stop-accepting',
  '--json'
);
assert.equal(shutdown.status, 0, shutdown.stderr || shutdown.stdout);

const blockedEnqueue = runCli(
  'enqueue',
  '--config', configPath,
  '--queue', 'auto',
  '--reason', 'embeddings',
  '--stage', 'stage3',
  '--repo', repoRoot,
  '--mode', 'code',
  '--json'
);
assert.notEqual(blockedEnqueue.status, 0, 'expected stop-accepting embeddings queue to block enqueue');
const blockedPayload = JSON.parse(blockedEnqueue.stdout || '{}');
assert.equal(blockedPayload.code, 'SERVICE_STOP_ACCEPTING');

const autoQueueStatus = runCli('status', '--config', configPath, '--queue', 'auto', '--json');
assert.equal(autoQueueStatus.status, 0, autoQueueStatus.stderr || autoQueueStatus.stdout);
const autoQueueStatusPayload = JSON.parse(autoQueueStatus.stdout || '{}');
assert.equal(autoQueueStatusPayload.queue?.queued, 0, 'expected no jobs to be written into raw auto queue state');

console.log('indexer service queue identity cli test passed');
