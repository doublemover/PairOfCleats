#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { runServiceIndexerJson } from '../../helpers/service-indexer-json-fixture.js';

ensureTestingEnv(process.env);

const statusPayload = await runServiceIndexerJson({
  testCacheDir: 'service-indexer-json-flags-status',
  subcommand: 'status'
});
assert.equal(statusPayload?.ok, true, 'expected status payload to report ok=true');
assert.equal(typeof statusPayload?.queue?.total, 'number', 'expected queue.total in status payload');

const smokePayload = await runServiceIndexerJson({
  testCacheDir: 'service-indexer-json-flags-smoke',
  subcommand: 'smoke'
});
assert.equal(smokePayload?.ok, true, 'expected smoke payload to report ok=true');
assert.equal(typeof smokePayload?.canonicalCommand, 'string', 'expected canonicalCommand in smoke payload');
assert.equal(typeof smokePayload?.queueSummary?.total, 'number', 'expected queueSummary.total in smoke payload');
assert.equal(Array.isArray(smokePayload?.requiredEnv), true, 'expected requiredEnv array in smoke payload');

console.log('service indexer --json flags test passed');
