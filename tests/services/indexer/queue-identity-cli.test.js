#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  assertQueueIdentityHelpers,
  createQueueIdentityCliFixture
} from './queue-identity-cli-fixture.js';

const { configPath, runCli, parseCliJson } = await createQueueIdentityCliFixture({
  cacheName: 'indexer-service-queue-identity-status'
});

assertQueueIdentityHelpers();

const autoStatus = runCli('status', '--config', configPath, '--queue', 'auto', '--reason', 'embeddings', '--stage', 'stage3', '--mode', 'code', '--json');
assert.equal(autoStatus.status, 0, autoStatus.stderr || autoStatus.stdout);
const autoStatusPayload = parseCliJson(autoStatus);
assert.equal(autoStatusPayload.name, 'embeddings-stage3-code');
assert.equal(autoStatusPayload.envelope?.queueClass, 'embeddings');
assert.equal(autoStatusPayload.envelope?.worker?.concurrency, 2);

const derivedIndexStatus = runCli('status', '--config', configPath, '--queue', 'index-stage2', '--json');
assert.equal(derivedIndexStatus.status, 0, derivedIndexStatus.stderr || derivedIndexStatus.stdout);
const derivedIndexPayload = parseCliJson(derivedIndexStatus);
assert.equal(derivedIndexPayload.name, 'index-stage2');
assert.equal(derivedIndexPayload.envelope?.queueClass, 'index');

console.log('indexer service queue identity status cli test passed');
