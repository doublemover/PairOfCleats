#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  ensureQueueDir,
  loadQueue,
  saveQueue
} from '../../../tools/service/queue.js';
import {
  buildDiagnosticsReport,
  renderDiagnosticsReportHuman
} from '../../../tools/reports/diagnostics-report.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'diagnostics-report-queue');
const repoRoot = path.join(tempRoot, 'repo');
const queueDir = path.join(tempRoot, 'queue');
const configPath = path.join(tempRoot, 'service.json');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await ensureQueueDir(queueDir);

await fsPromises.writeFile(configPath, JSON.stringify({
  queueDir,
  queue: {
    maxQueued: 1,
    maxRunning: 1,
    maxTotal: 2,
    resourceBudgetUnits: 2
  },
  repos: [
    { id: 'repo', path: repoRoot, syncPolicy: 'none' }
  ]
}, null, 2));

await enqueueJob(queueDir, {
  id: 'job-1',
  createdAt: '2026-03-19T00:00:00.000Z',
  repo: repoRoot,
  mode: 'code',
  stage: 'stage1',
  maxRetries: 2
}, null, 'index');

const runningJob = await claimNextJob(queueDir, 'index', { ownerId: 'worker-1' });
assert.equal(runningJob?.id, 'job-1', 'expected first job to claim');

await enqueueJob(queueDir, {
  id: 'job-2',
  createdAt: '2026-03-19T00:01:00.000Z',
  repo: repoRoot,
  mode: 'code',
  stage: 'stage2',
  maxRetries: 0
}, null, 'index');

await completeJob(queueDir, 'job-1', 'queued', {
  exitCode: 1,
  retry: true,
  attempts: 1
}, 'index', {
  ownerId: 'worker-1',
  expectedLeaseVersion: runningJob?.lease?.version
});

const queue = await loadQueue(queueDir, 'index');
const staleQueueEntry = queue.jobs.find((job) => job.id === 'job-2');
assert.ok(staleQueueEntry, 'expected second job in queue');
staleQueueEntry.status = 'running';
staleQueueEntry.nextEligibleAt = null;
staleQueueEntry.startedAt = '2026-03-18T23:58:00.000Z';
staleQueueEntry.lastHeartbeatAt = '2026-03-18T23:59:00.000Z';
staleQueueEntry.lease.owner = 'pid:999999';
staleQueueEntry.lease.version = 1;
staleQueueEntry.lease.acquiredAt = '2026-03-18T23:58:00.000Z';
staleQueueEntry.lease.renewedAt = '2026-03-18T23:59:00.000Z';
staleQueueEntry.lease.expiresAt = '2026-03-18T23:59:00.000Z';
await saveQueue(queueDir, queue, 'index');

const report = await buildDiagnosticsReport({
  reportKinds: 'queue-health,stale-jobs',
  configPath,
  queueName: 'index'
});

assert.equal(report.summary.status, 'error', 'expected stale running jobs to elevate report status');
assert.equal(report.reports.length, 2, 'expected queue and stale-job reports');

const queueHealth = report.reports.find((entry) => entry.kind === 'queue-health');
assert.ok(queueHealth, 'expected queue-health section');
assert.equal(queueHealth.reasonCodes.includes('QUEUE_HEALTH_SATURATED'), true, 'expected saturation reason');
assert.equal(queueHealth.reasonCodes.includes('QUEUE_HEALTH_RETRY_RATE_OVERLOADED'), true, 'expected retry-pressure reason');

const staleJobs = report.reports.find((entry) => entry.kind === 'stale-jobs');
assert.ok(staleJobs, 'expected stale-jobs section');
assert.equal(staleJobs.reasonCodes.includes('STALE_JOB_LEASE_EXPIRED'), true, 'expected stale lease reason');
assert.equal(staleJobs.details?.jobs?.[0]?.rootCauseCode, 'STALE_JOB_LEASE_EXPIRED', 'expected root-cause code');
assert.equal(Array.isArray(staleJobs.details?.jobs?.[0]?.remediation), true, 'expected remediation commands');

const rendered = renderDiagnosticsReportHuman(report);
assert.equal(rendered.includes('Queue Health [error]') || rendered.includes('Queue Health [warn]'), true, 'expected rendered queue section');
assert.equal(rendered.includes('Stale Job Causes [error]'), true, 'expected rendered stale-job section');
assert.equal(rendered.includes('job job-2: stale (STALE_JOB_LEASE_EXPIRED)'), true, 'expected rendered stale job summary');

console.log('diagnostics report queue test passed');
