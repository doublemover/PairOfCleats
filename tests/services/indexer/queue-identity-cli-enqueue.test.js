#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createQueueIdentityCliFixture } from './queue-identity-cli-fixture.js';

const { repoRoot, configPath, runCli, parseCliJson } = await createQueueIdentityCliFixture({
  cacheName: 'indexer-service-queue-identity-enqueue'
});

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
const enqueuePayload = parseCliJson(enqueue);
assert.equal(enqueuePayload.ok, true);

const embeddingsStatus = runCli('status', '--config', configPath, '--queue', 'embeddings-stage3-code', '--json');
assert.equal(embeddingsStatus.status, 0, embeddingsStatus.stderr || embeddingsStatus.stdout);
const embeddingsStatusPayload = parseCliJson(embeddingsStatus);
assert.equal(embeddingsStatusPayload.queue?.queued, 1, 'expected auto embeddings enqueue to land in embeddings-stage3-code');

console.log('indexer service queue identity enqueue cli test passed');
