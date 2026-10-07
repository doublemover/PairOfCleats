#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  claimNextJob,
  completeJob,
  ensureQueueDir,
  enqueueJob,
  loadQueue,
  quarantineJob
} from '../../../tools/service/queue.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'service-queue-delivery-contract-report');
const queueDir = path.join(tempRoot, 'queue');

await fs.rm(tempRoot, { recursive: true, force: true });
await ensureQueueDir(queueDir);

await enqueueJob(queueDir, {
  id: 'job-report-complete',
  createdAt: new Date().toISOString(),
  repo: '/tmp/repo-report-complete',
  repoRoot: '/tmp/repo-report-complete',
  mode: 'code',
  stage: 'stage1',
  reason: 'report-contract'
}, null, 'index');

const completed = await claimNextJob(queueDir, 'index', {
  ownerId: 'worker-report',
  leaseMs: 5000
});
await completeJob(queueDir, completed.id, 'done', {
  exitCode: 0,
  signal: null,
  executionMode: 'subprocess',
  executionClass: 'subprocess-isolated'
}, 'index', {
  ownerId: 'worker-report',
  expectedLeaseVersion: completed.lease?.version ?? null
});

const completedQueue = await loadQueue(queueDir, 'index');
const completedJob = completedQueue.jobs.find((entry) => entry.id === 'job-report-complete');
const completedReport = JSON.parse(await fs.readFile(completedJob.reportPath, 'utf8'));
assert.equal(completedReport.deliveryContract?.semantics, 'at-least-once');
assert.equal(completedReport.deliveryContract?.idempotencyKey, completedJob.idempotencyKey);
assert.equal(completedReport.deliveryContract?.sideEffectFences?.reportWrite, 'atomic-report-path');

await enqueueJob(queueDir, {
  id: 'job-report-quarantine',
  createdAt: new Date().toISOString(),
  repo: '/tmp/repo-report-quarantine',
  repoRoot: '/tmp/repo-report-quarantine',
  mode: 'code',
  stage: 'stage2',
  reason: 'report-contract'
}, null, 'index');

const quarantined = await claimNextJob(queueDir, 'index', {
  ownerId: 'worker-report',
  leaseMs: 5000
});
await quarantineJob(queueDir, quarantined.id, 'report-contract-quarantine', 'index', {
  ownerId: 'worker-report',
  expectedLeaseVersion: quarantined.lease?.version ?? null,
  result: { error: 'report-contract-quarantine' }
});

const quarantinedReportPath = path.join(queueDir, 'reports', `${quarantined.id}.json`);
const quarantinedReport = JSON.parse(await fs.readFile(quarantinedReportPath, 'utf8'));
assert.equal(quarantinedReport.deliveryContract?.semantics, 'at-least-once');
assert.equal(quarantinedReport.deliveryContract?.sideEffectFences?.quarantineStore, 'replace-by-job-id');

console.log('service queue delivery contract report test passed');
