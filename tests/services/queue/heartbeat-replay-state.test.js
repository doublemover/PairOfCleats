#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  claimNextJob,
  enqueueJob,
  ensureQueueDir,
  loadQueue,
  touchJobHeartbeat
} from '../../../tools/service/queue.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'service-queue-heartbeat-replay-state');
const queueDir = path.join(tempRoot, 'queue');

await fs.rm(tempRoot, { recursive: true, force: true });
await ensureQueueDir(queueDir);

await enqueueJob(queueDir, {
  id: 'embed-job-1',
  createdAt: new Date().toISOString(),
  repo: '/tmp/embed-repo',
  repoRoot: '/tmp/embed-repo',
  buildRoot: '/tmp/embed-repo/builds/build-1',
  indexDir: '/tmp/embed-repo/builds/build-1/index-code',
  mode: 'code',
  reason: 'test',
  stage: 'stage3'
}, null, 'embeddings');

const claimed = await claimNextJob(queueDir, 'embeddings', {
  ownerId: 'worker-replay',
  leaseMs: 5000
});

await touchJobHeartbeat(queueDir, claimed.id, 'embeddings', {
  ownerId: 'worker-replay',
  expectedLeaseVersion: claimed.lease?.version ?? null,
  replayState: {
    version: 1,
    mode: 'code',
    partialDurableState: true,
    backendStage: {
      path: '/tmp/embed-repo/builds/build-1/.embeddings-backend-staging/index-code',
      exists: true
    }
  },
  progress: {
    kind: 'renewal',
    note: 'replay-snapshot'
  }
});

const queue = await loadQueue(queueDir, 'embeddings');
const runningJob = queue.jobs.find((job) => job.id === claimed.id);
assert.equal(runningJob?.replayState?.version, 1);
assert.equal(runningJob?.replayState?.partialDurableState, true);
assert.equal(runningJob?.replayState?.backendStage?.exists, true);
assert.ok(runningJob?.replayState?.updatedAt, 'expected heartbeat persistence to timestamp replay state');

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('service queue heartbeat replay-state test passed');
