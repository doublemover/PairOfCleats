#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createIndexerServiceCliFixture } from './indexer-service-cli-fixture.js';

const { repoRoot, configPath, runCli, parseCliJson } = await createIndexerServiceCliFixture({
  cacheName: 'indexer-service-backpressure',
  config: {
    queue: {
      maxQueued: 1,
      maxRunning: 1,
      maxTotal: 1,
      resourceBudgetUnits: 2
    }
  }
});

const first = runCli('enqueue', '--config', configPath, '--repo', repoRoot, '--mode', 'code', '--json');
assert.equal(first.status, 0, 'expected first enqueue to succeed');
const firstPayload = parseCliJson(first);
assert.equal(firstPayload.ok, true);

const second = runCli('enqueue', '--config', configPath, '--repo', repoRoot, '--mode', 'code', '--stage', 'stage2', '--json');
assert.equal(second.status, 1, 'expected overload enqueue to exit non-zero');
const secondPayload = parseCliJson(second);
assert.equal(secondPayload.ok, false, 'expected overload payload to be marked failed');
assert.equal(secondPayload.code, 'QUEUE_BACKPRESSURE_MAX_QUEUED', 'expected stable queue overload code');
assert.equal(secondPayload.backpressure?.state, 'saturated', 'expected overload payload to expose saturated backpressure state');
assert.equal(secondPayload.backpressure?.rejectReason, 'max_queued', 'expected explicit overload reason in payload');

const status = runCli('status', '--config', configPath, '--json');
assert.equal(status.status, 0, 'expected status command to succeed');
const statusPayload = parseCliJson(status);
assert.equal(statusPayload.backpressure?.state, 'saturated', 'expected status to surface queue backpressure state');
assert.equal(statusPayload.backpressure?.reasons.includes('max_queued'), true, 'expected status to expose queue saturation reasons');
assert.equal(typeof statusPayload.backpressure?.slo?.state, 'string', 'expected status to include queue SLO state');

console.log('indexer service backpressure cli test passed');
