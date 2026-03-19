#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  claimNextJob,
  ensureQueueDir,
  enqueueJob,
  getQueuePaths,
  loadQueue,
  saveQuarantine,
  saveQueue
} from '../../../tools/service/queue.js';
import { getRepairAuditPath } from '../../../tools/service/repair.js';
import { getServiceShutdownPaths } from '../../../tools/service/shutdown-state.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'indexer-service-repair-cli');
const repoRoot = path.join(tempRoot, 'repo');
const queueDir = path.join(tempRoot, 'queue');
const configPath = path.join(tempRoot, 'service.json');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });
await ensureQueueDir(queueDir);
await fs.mkdir(path.join(queueDir, 'logs'), { recursive: true });
await fs.mkdir(path.join(queueDir, 'reports'), { recursive: true });

const config = {
  queueDir,
  repos: [
    { id: 'repo', path: repoRoot, syncPolicy: 'none' }
  ]
};
await fs.writeFile(configPath, JSON.stringify(config, null, 2));

await enqueueJob(queueDir, {
  id: 'job-running-stale',
  createdAt: new Date().toISOString(),
  repo: repoRoot,
  repoRoot,
  mode: 'code',
  stage: 'stage2'
}, null, 'index');
const claimed = await claimNextJob(queueDir, 'index', {
  ownerId: 'pid:999999',
  leaseMs: 5
});
const queuePayload = await loadQueue(queueDir, 'index');
const runningJob = queuePayload.jobs.find((entry) => entry.id === claimed.id);
const expiredAt = new Date(Date.now() - 60_000).toISOString();
runningJob.lastHeartbeatAt = expiredAt;
runningJob.lease.expiresAt = expiredAt;
await saveQueue(queueDir, queuePayload, 'index');

await enqueueJob(queueDir, {
  id: 'job-queued',
  createdAt: new Date().toISOString(),
  repo: repoRoot,
  repoRoot,
  mode: 'code',
  stage: 'stage1'
}, null, 'index');

await saveQuarantine(queueDir, {
  jobs: [
    {
      id: 'job-repair-retry',
      createdAt: new Date().toISOString(),
      status: 'failed',
      queueName: 'index',
      repo: repoRoot,
      repoRoot,
      mode: 'code',
      stage: 'stage3',
      attempts: 0,
      maxRetries: null,
      nextEligibleAt: null,
      lastHeartbeatAt: null,
      progress: {
        sequence: 1,
        updatedAt: new Date().toISOString(),
        kind: 'quarantine',
        note: 'repair-source'
      },
      lease: {
        owner: null,
        version: 0,
        expiresAt: null,
        acquiredAt: null,
        renewedAt: null,
        releasedAt: new Date().toISOString(),
        releasedReason: 'repair-source',
        lastOwner: null
      },
      transition: {
        sequence: 1,
        from: 'queued',
        to: 'failed',
        at: new Date().toISOString(),
        reason: 'repair-source'
      },
      logPath: path.join(queueDir, 'logs', 'job-repair-retry.log'),
      reportPath: path.join(queueDir, 'reports', 'job-repair-retry.json'),
      result: {
        error: 'repair source'
      },
      lastError: 'repair source',
      quarantine: {
        state: 'quarantined',
        quarantinedAt: new Date().toISOString(),
        reason: 'repair-source',
        sourceStatus: 'queued',
        sourceQueueName: 'index',
        releasedAt: null,
        releaseReason: null,
        retryJobId: null
      }
    }
  ]
}, 'index');

const orphanLogPath = path.join(queueDir, 'logs', 'orphan.log');
const orphanReportPath = path.join(queueDir, 'reports', 'orphan.json');
await fs.writeFile(orphanLogPath, 'orphan log');
await fs.writeFile(orphanReportPath, '{"orphan":true}');

const staleLockPayload = JSON.stringify({
  pid: 999999,
  startedAt: new Date(Date.now() - (31 * 60 * 1000)).toISOString(),
  scope: 'test-repair'
}, null, 2);
await fs.writeFile(getQueuePaths(queueDir, 'index').lockPath, staleLockPayload);
await fs.writeFile(getServiceShutdownPaths(queueDir, 'index').lockPath, staleLockPayload);

const runCli = (...args) => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'tools', 'service', 'indexer-service.js'), ...args],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || `indexer-service ${args[0]} failed`);
    process.exit(result.status ?? 1);
  }
  return JSON.parse(result.stdout || '{}');
};

const inspectPayload = runCli('inspect', '--config', configPath, '--json');
assert.equal(inspectPayload.ok, true);
assert.equal(inspectPayload.heartbeat?.stale >= 1, true, 'expected inspect to surface stale running jobs');
assert.equal(inspectPayload.orphans?.logs.includes(path.resolve(orphanLogPath)), true, 'expected inspect to report orphan logs');
assert.equal(inspectPayload.orphans?.reports.includes(path.resolve(orphanReportPath)), true, 'expected inspect to report orphan reports');
assert.equal(inspectPayload.locks.every((entry) => entry.safeToUnlock === true), true, 'expected inspect to classify stale locks as safe to unlock');

const heartbeatPayload = runCli('heartbeat-status', '--config', configPath, '--json');
assert.equal(heartbeatPayload.summary?.stale, 1, 'expected heartbeat status to classify stale running job');
assert.equal(heartbeatPayload.jobs?.[0]?.status, 'stale');

const quarantineDryRun = runCli('quarantine-job', '--config', configPath, '--job', 'job-queued', '--reason', 'manual-quarantine', '--dry-run', '--json');
assert.equal(quarantineDryRun.ok, true);
assert.equal(quarantineDryRun.dryRun, true);
assert.equal((await loadQueue(queueDir, 'index')).jobs.some((entry) => entry.id === 'job-queued'), true, 'expected dry-run quarantine to leave queue untouched');

const quarantineActual = runCli('quarantine-job', '--config', configPath, '--job', 'job-queued', '--reason', 'manual-quarantine', '--json');
assert.equal(quarantineActual.ok, true);
assert.equal(quarantineActual.job?.quarantine?.reason, 'manual-quarantine');

const retryDryRun = runCli('retry', '--config', configPath, '--job', 'job-repair-retry', '--dry-run', '--json');
assert.equal(retryDryRun.ok, true);
assert.equal(retryDryRun.dryRun, true);

const retryActual = runCli('retry', '--config', configPath, '--job', 'job-repair-retry', '--json');
assert.equal(retryActual.ok, true);
assert.notEqual(retryActual.job?.id, 'job-repair-retry');

const purgeDryRun = runCli('purge', '--config', configPath, '--job', 'job-repair-retry', '--dry-run', '--json');
assert.equal(purgeDryRun.ok, true);
assert.equal(purgeDryRun.dryRun, true);

const purgeActual = runCli('purge', '--config', configPath, '--job', 'job-repair-retry', '--json');
assert.equal(purgeActual.ok, true);
assert.equal(purgeActual.removed, 1);

const unlockDryRun = runCli('unlock', '--config', configPath, '--lock', 'all', '--dry-run', '--json');
assert.equal(unlockDryRun.ok, true);
assert.equal(unlockDryRun.results.every((entry) => entry.removed === false), true, 'expected dry-run unlock to avoid deleting lock files');

const unlockActual = runCli('unlock', '--config', configPath, '--lock', 'all', '--json');
assert.equal(unlockActual.ok, true);
assert.equal(unlockActual.results.filter((entry) => entry.removed).length >= 1, true, 'expected unlock to remove at least one stale lock file');
assert.equal(await fs.stat(getQueuePaths(queueDir, 'index').lockPath).then(() => true).catch(() => false), false, 'expected queue lock file to be absent after unlock');
assert.equal(await fs.stat(getServiceShutdownPaths(queueDir, 'index').lockPath).then(() => true).catch(() => false), false, 'expected shutdown lock file to be absent after unlock');

const cleanupDryRun = runCli('cleanup-orphans', '--config', configPath, '--dry-run', '--json');
assert.equal(cleanupDryRun.ok, true);
assert.equal(cleanupDryRun.orphans?.logs.includes(path.resolve(orphanLogPath)), true, 'expected dry-run cleanup to preserve orphan reporting');

const cleanupActual = runCli('cleanup-orphans', '--config', configPath, '--json');
assert.equal(cleanupActual.ok, true);
assert.equal(cleanupActual.removed?.logs.includes(path.resolve(orphanLogPath)), true, 'expected cleanup to remove orphan log');
assert.equal(cleanupActual.removed?.reports.includes(path.resolve(orphanReportPath)), true, 'expected cleanup to remove orphan report');

const auditPath = getRepairAuditPath(queueDir, 'index');
const auditLines = (await fs.readFile(auditPath, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
assert.equal(auditLines.length >= 5, true, 'expected repair mutations to append audit entries');

console.log('indexer service repair cli test passed');
