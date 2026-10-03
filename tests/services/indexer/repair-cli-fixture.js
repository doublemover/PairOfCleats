import fs from 'node:fs/promises';
import path from 'node:path';

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
import { createIndexerServiceCliFixture } from './indexer-service-cli-fixture.js';

export const createRepairCliFixture = async ({ cacheName }) => {
  const fixture = await createIndexerServiceCliFixture({ cacheName });
  const { repoRoot, queueDir } = fixture;

  await ensureQueueDir(queueDir);
  await fs.mkdir(path.join(queueDir, 'logs'), { recursive: true });
  await fs.mkdir(path.join(queueDir, 'reports'), { recursive: true });

  const enqueueIndexJob = async ({
    id,
    stage = 'stage1'
  }) => {
    await enqueueJob(queueDir, {
      id,
      createdAt: new Date().toISOString(),
      repo: repoRoot,
      repoRoot,
      mode: 'code',
      stage
    }, null, 'index');
  };

  const seedStaleRunningJob = async () => {
    await enqueueIndexJob({ id: 'job-running-stale', stage: 'stage2' });
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
  };

  const seedQueuedJob = async () => {
    await enqueueIndexJob({ id: 'job-queued', stage: 'stage1' });
  };

  const seedRetryJob = async () => {
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
  };

  const seedOrphanArtifacts = async () => {
    const orphanLogPath = path.join(queueDir, 'logs', 'orphan.log');
    const orphanReportPath = path.join(queueDir, 'reports', 'orphan.json');
    await fs.writeFile(orphanLogPath, 'orphan log');
    await fs.writeFile(orphanReportPath, '{"orphan":true}');
    return {
      orphanLogPath,
      orphanReportPath
    };
  };

  const seedStaleLocks = async () => {
    const staleLockPayload = JSON.stringify({
      pid: 999999,
      startedAt: new Date(Date.now() - (31 * 60 * 1000)).toISOString(),
      scope: 'test-repair'
    }, null, 2);
    await fs.writeFile(getQueuePaths(queueDir, 'index').lockPath, staleLockPayload);
    await fs.writeFile(getServiceShutdownPaths(queueDir, 'index').lockPath, staleLockPayload);
  };

  const readAuditLines = async () => {
    const auditPath = getRepairAuditPath(queueDir, 'index');
    return (await fs.readFile(auditPath, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
  };

  return {
    ...fixture,
    seedQueuedJob,
    seedStaleRunningJob,
    seedRetryJob,
    seedOrphanArtifacts,
    seedStaleLocks,
    readAuditLines
  };
};
