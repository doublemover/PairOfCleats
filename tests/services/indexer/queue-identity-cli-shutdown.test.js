#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createQueueIdentityCliFixture } from './queue-identity-cli-fixture.js';

const { repoRoot, configPath, runCli, parseCliJson } = await createQueueIdentityCliFixture({
  cacheName: 'indexer-service-queue-identity-shutdown'
});

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
const blockedPayload = parseCliJson(blockedEnqueue);
assert.equal(blockedPayload.code, 'SERVICE_STOP_ACCEPTING');

const autoQueueStatus = runCli('status', '--config', configPath, '--queue', 'auto', '--json');
assert.equal(autoQueueStatus.status, 0, autoQueueStatus.stderr || autoQueueStatus.stdout);
const autoQueueStatusPayload = parseCliJson(autoQueueStatus);
assert.equal(autoQueueStatusPayload.queue?.queued, 0, 'expected no jobs to be written into raw auto queue state');

console.log('indexer service queue identity shutdown cli test passed');
