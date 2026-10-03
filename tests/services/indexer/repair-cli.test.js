#!/usr/bin/env node
import assert from 'node:assert/strict';

import { loadQueue } from '../../../tools/service/queue.js';
import { createRepairCliFixture } from './repair-cli-fixture.js';

const {
  queueDir,
  configPath,
  runCliJson,
  seedQueuedJob,
  readAuditLines
} = await createRepairCliFixture({
  cacheName: 'indexer-service-repair-cli-quarantine'
});

await seedQueuedJob();

const quarantineDryRun = runCliJson('quarantine-job', '--config', configPath, '--job', 'job-queued', '--reason', 'manual-quarantine', '--dry-run', '--json');
assert.equal(quarantineDryRun.ok, true);
assert.equal(quarantineDryRun.dryRun, true);
assert.equal((await loadQueue(queueDir, 'index')).jobs.some((entry) => entry.id === 'job-queued'), true, 'expected dry-run quarantine to leave queue untouched');

const quarantineActual = runCliJson('quarantine-job', '--config', configPath, '--job', 'job-queued', '--reason', 'manual-quarantine', '--json');
assert.equal(quarantineActual.ok, true);
assert.equal(quarantineActual.job?.quarantine?.reason, 'manual-quarantine');

const auditLines = await readAuditLines();
assert.equal(auditLines.length >= 1, true, 'expected quarantine mutation to append an audit entry');

console.log('indexer service repair cli quarantine test passed');
