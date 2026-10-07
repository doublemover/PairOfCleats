#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  claimNextJob,
  ensureQueueDir,
  enqueueJob,
  quarantineJob
} from '../../../tools/service/queue.js';
import { createIndexerServiceCliFixture } from './indexer-service-cli-fixture.js';

const { repoRoot, queueDir, configPath, runCliJson } = await createIndexerServiceCliFixture({
  cacheName: 'indexer-service-quarantine-cli'
});
await ensureQueueDir(queueDir);

await enqueueJob(queueDir, {
  id: 'job-cli-poison',
  createdAt: new Date().toISOString(),
  repo: repoRoot,
  repoRoot,
  mode: 'code',
  reason: 'test',
  stage: 'stage1'
}, null, 'index');
const claimed = await claimNextJob(queueDir, 'index', { ownerId: 'worker-cli' });
await quarantineJob(queueDir, claimed.id, 'cli-poison', 'index', {
  ownerId: 'worker-cli',
  expectedLeaseVersion: claimed.lease?.version ?? null,
  sourceStatus: 'running',
  result: {
    exitCode: 1,
    error: 'cli poison'
  }
});

const quarantineList = runCliJson('quarantine', '--config', configPath, '--json');
assert.equal(quarantineList.ok, true);
assert.equal(quarantineList.summary?.quarantined, 1);
assert.equal(quarantineList.jobs?.[0]?.id, 'job-cli-poison');

const quarantineInspect = runCliJson('quarantine', '--config', configPath, '--job', 'job-cli-poison', '--json');
assert.equal(quarantineInspect.job?.quarantine?.reason, 'cli-poison');

const retryPayload = runCliJson('retry-quarantined', '--config', configPath, '--job', 'job-cli-poison', '--json');
assert.equal(retryPayload.ok, true);
assert.equal(retryPayload.retriedFromId, 'job-cli-poison');
assert.notEqual(retryPayload.job?.id, 'job-cli-poison');

const statusPayload = runCliJson('status', '--config', configPath, '--json');
assert.equal(statusPayload.queue?.queued, 1);
assert.equal(statusPayload.quarantine?.retried, 1);

const purgePayload = runCliJson('purge-quarantined', '--config', configPath, '--job', 'job-cli-poison', '--json');
assert.equal(purgePayload.ok, true);
assert.equal(purgePayload.removed, 1);

const finalQuarantineList = runCliJson('quarantine', '--config', configPath, '--json');
assert.equal(finalQuarantineList.summary?.total, 0);

console.log('indexer service quarantine cli test passed');
