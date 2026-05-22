#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createRepairCliFixture } from './repair-cli-fixture.js';

const {
  configPath,
  runCliJson,
  seedRetryJob,
  readAuditLines
} = await createRepairCliFixture({
  cacheName: 'indexer-service-repair-cli-retry'
});

await seedRetryJob();

const retryDryRun = runCliJson('retry', '--config', configPath, '--job', 'job-repair-retry', '--dry-run', '--json');
assert.equal(retryDryRun.ok, true);
assert.equal(retryDryRun.dryRun, true);

const retryActual = runCliJson('retry', '--config', configPath, '--job', 'job-repair-retry', '--json');
assert.equal(retryActual.ok, true);
assert.notEqual(retryActual.job?.id, 'job-repair-retry');

const inspectRetriedPayload = runCliJson('inspect', '--config', configPath, '--job', retryActual.job.id, '--json');
assert.equal(Array.isArray(inspectRetriedPayload.duplicateGroups), true, 'expected inspect to surface duplicate job groups');
assert.equal(inspectRetriedPayload.duplicateGroups.length >= 1, true, 'expected retried job to remain inspectable as a duplicate group');
assert.equal(inspectRetriedPayload.deliveryContract?.semantics, 'at-least-once');
assert.equal(
  inspectRetriedPayload.deliveryContract?.sideEffectFences?.duplicateSuppression,
  'idempotency-key-active-scan',
  'expected inspect to expose duplicate-suppression fence'
);

const auditLines = await readAuditLines();
assert.equal(auditLines.length >= 1, true, 'expected retry mutation to append an audit entry');

console.log('indexer service repair cli retry test passed');
