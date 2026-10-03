#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createIndexerServiceCliFixture } from './indexer-service-cli-fixture.js';

const { repoRoot, configPath, runCli, parseCliJson } = await createIndexerServiceCliFixture({
  cacheName: 'indexer-service-shutdown-cli'
});

const shutdown = runCli('shutdown', '--config', configPath, '--shutdown-mode', 'stop-accepting', '--json');
assert.equal(shutdown.status, 0, shutdown.stderr || shutdown.stdout);
const shutdownPayload = parseCliJson(shutdown);
assert.equal(shutdownPayload.shutdown?.mode, 'stop-accepting');
assert.equal(shutdownPayload.shutdown?.accepting, false);

const statusBlocked = runCli('status', '--config', configPath, '--json');
assert.equal(statusBlocked.status, 0, statusBlocked.stderr || statusBlocked.stdout);
const statusPayload = parseCliJson(statusBlocked);
assert.equal(statusPayload.shutdown?.mode, 'stop-accepting');
assert.equal(statusPayload.shutdown?.accepting, false);

const blockedEnqueue = runCli('enqueue', '--config', configPath, '--repo', repoRoot, '--mode', 'code', '--json');
assert.notEqual(blockedEnqueue.status, 0, 'enqueue should fail while stop-accepting is active');
const blockedPayload = parseCliJson(blockedEnqueue);
assert.equal(blockedPayload.code, 'SERVICE_STOP_ACCEPTING');
assert.equal(blockedPayload.shutdown?.mode, 'stop-accepting');

const resumed = runCli('resume', '--config', configPath, '--json');
assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
const resumedPayload = parseCliJson(resumed);
assert.equal(resumedPayload.shutdown?.mode, 'running');
assert.equal(resumedPayload.shutdown?.accepting, true);

const enqueue = runCli('enqueue', '--config', configPath, '--repo', repoRoot, '--mode', 'code', '--json');
assert.equal(enqueue.status, 0, enqueue.stderr || enqueue.stdout);
const enqueuePayload = parseCliJson(enqueue);
assert.equal(enqueuePayload.ok, true);

console.log('indexer service shutdown cli test passed');
