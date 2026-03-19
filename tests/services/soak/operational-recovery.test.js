#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { acquireIndexLock } from '../../../src/index/build/lock.js';
import { resolveIndexRef } from '../../../src/index/index-ref.js';
import { createPointerSnapshot } from '../../../src/index/snapshots/create.js';
import { loadChunkMeta } from '../../../src/shared/artifact-io.js';
import { replaceDir } from '../../../src/shared/json-stream/atomic.js';
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  ensureQueueDir,
  loadQueue,
  loadQuarantine,
  quarantineSummary,
  queueSummary,
  requeueStaleJobs,
  retryQuarantinedJob,
  saveQueue
} from '../../../tools/service/queue.js';
import { collectEmbeddingReplayState, repairEmbeddingReplayState } from '../../../tools/service/embedding-replay.js';
import { getRepoCacheRoot, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { createBaseIndex } from '../../indexing/validate/helpers.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'services-soak-operational-recovery');
const queueDir = path.join(tempRoot, 'queue');
const embeddingsRoot = path.join(tempRoot, 'embeddings');
const snapshotRoot = path.join(tempRoot, 'snapshots');
const testLogRoot = process.env.PAIROFCLEATS_TEST_LOG_DIR
  || process.env.npm_config_test_log_dir
  || '';

const writeArtifact = async (fileName, payload) => {
  if (!testLogRoot) return;
  const outPath = path.join(path.resolve(testLogRoot), fileName);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
};

const writeJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const runQueueWorkerSoak = async () => {
  await fs.rm(queueDir, { recursive: true, force: true });
  await ensureQueueDir(queueDir);

  const metrics = {
    completed: 0,
    staleRecoveries: 0,
    quarantinedRecoveries: 0,
    latencyMs: [],
    queueHealth: []
  };

  for (let cycle = 0; cycle < 8; cycle += 1) {
    const queueName = cycle % 2 === 0 ? 'index-soak' : 'index-soak-heavy';
    const createdAt = Date.now();
    const maxRetries = cycle % 3 === 0 ? 0 : 1;
    await enqueueJob(queueDir, {
      id: `job-${cycle}`,
      createdAt: new Date(createdAt).toISOString(),
      repo: `/tmp/queue-soak-${cycle}`,
      repoRoot: `/tmp/queue-soak-${cycle}`,
      mode: cycle % 2 === 0 ? 'code' : 'both',
      stage: cycle % 2 === 0 ? 'stage1' : 'stage2',
      buildId: `build-${cycle}`,
      maxRetries
    }, null, queueName, {
      forceDuplicate: true
    });

    const claimed = await claimNextJob(queueDir, queueName, {
      ownerId: `worker-${cycle}`,
      leaseMs: 5
    });
    assert.ok(claimed, `expected claimed job for cycle ${cycle}`);

    if (cycle % 3 === 0) {
      const queuePayload = await loadQueue(queueDir, queueName);
      const running = queuePayload.jobs.find((entry) => entry.id === claimed.id);
      const expiredAt = new Date(Date.now() - 1000).toISOString();
      running.lease.expiresAt = expiredAt;
      running.lastHeartbeatAt = expiredAt;
      await saveQueue(queueDir, queuePayload, queueName);
      const recovery = await requeueStaleJobs(queueDir, queueName, { maxRetries });
      metrics.staleRecoveries += recovery.retried + recovery.quarantined;
      if (recovery.quarantined > 0) {
        const retried = await retryQuarantinedJob(queueDir, claimed.id, queueName, {
          forceDuplicate: true
        });
        assert.ok(retried?.job, `expected quarantined retry recovery for cycle ${cycle}`);
        const recoveredClaim = await claimNextJob(queueDir, queueName, {
          ownerId: `worker-recovered-${cycle}`,
          leaseMs: 5000
        });
        await completeJob(queueDir, recoveredClaim.id, 'done', { exitCode: 0 }, queueName, {
          ownerId: `worker-recovered-${cycle}`,
          expectedLeaseVersion: recoveredClaim.lease?.version ?? null
        });
        metrics.quarantinedRecoveries += 1;
      } else {
        const recoveredClaim = await claimNextJob(queueDir, queueName, {
          ownerId: `worker-retry-${cycle}`,
          leaseMs: 5000
        });
        await completeJob(queueDir, recoveredClaim.id, 'done', { exitCode: 0 }, queueName, {
          ownerId: `worker-retry-${cycle}`,
          expectedLeaseVersion: recoveredClaim.lease?.version ?? null
        });
      }
    } else {
      await completeJob(queueDir, claimed.id, 'done', { exitCode: 0 }, queueName, {
        ownerId: `worker-${cycle}`,
        expectedLeaseVersion: claimed.lease?.version ?? null
      });
    }

    const summary = await queueSummary(queueDir, queueName);
    const quarantine = await quarantineSummary(queueDir, queueName);
    metrics.queueHealth.push({
      cycle,
      queueName,
      queued: summary.queued,
      running: summary.running,
      done: summary.done,
      failed: summary.failed,
      quarantined: quarantine.quarantined,
      retried: quarantine.retried
    });
    metrics.completed += 1;
    metrics.latencyMs.push(Date.now() - createdAt);
  }

  const finalQueues = await Promise.all([
    queueSummary(queueDir, 'index-soak'),
    queueSummary(queueDir, 'index-soak-heavy'),
    loadQuarantine(queueDir, 'index-soak'),
    loadQuarantine(queueDir, 'index-soak-heavy')
  ]);

  return {
    iterations: 8,
    completed: metrics.completed,
    staleRecoveries: metrics.staleRecoveries,
    quarantinedRecoveries: metrics.quarantinedRecoveries,
    latencyMs: metrics.latencyMs,
    latency: {
      max: Math.max(...metrics.latencyMs),
      min: Math.min(...metrics.latencyMs)
    },
    queueHealth: metrics.queueHealth,
    final: {
      index: finalQueues[0],
      heavy: finalQueues[1],
      indexQuarantine: finalQueues[2].jobs.length,
      heavyQuarantine: finalQueues[3].jobs.length
    }
  };
};

const runEmbeddingRecoverySoak = async () => {
  await fs.rm(embeddingsRoot, { recursive: true, force: true });
  const metrics = {
    repairedRuns: 0,
    idempotentRuns: 0,
    partialDurableRuns: 0
  };

  for (let cycle = 0; cycle < 4; cycle += 1) {
    const repoRoot = path.join(embeddingsRoot, `repo-${cycle}`);
    const buildRoot = path.join(repoRoot, 'builds', `build-${cycle}`);
    const indexDir = path.join(buildRoot, 'index-code');
    const backendStageDir = path.join(buildRoot, '.embeddings-backend-staging', 'index-code');
    const buildStatePath = path.join(buildRoot, 'build_state.json');
    const indexStatePath = path.join(indexDir, 'index_state.json');
    await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
    await fs.mkdir(backendStageDir, { recursive: true });
    await fs.writeFile(path.join(indexDir, 'dense_vectors_uint8.bin'), `vector-${cycle}`);
    await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify({ cycle }, null, 2));
    await writeJson(buildStatePath, {
      stage: 'stage3',
      updatedAt: new Date().toISOString(),
      phases: {
        stage3: {
          status: 'running'
        }
      },
      progress: {
        code: {
          completed: cycle + 1,
          total: 8
        }
      }
    });
    await writeJson(indexStatePath, {
      generatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      embeddings: {
        ready: false,
        pending: true,
        embeddingIdentityKey: `identity-${cycle}`
      }
    });

    const job = {
      id: `embedding-job-${cycle}`,
      repo: repoRoot,
      repoRoot,
      buildRoot,
      indexDir,
      mode: 'code',
      embeddingPayloadFormatVersion: 2
    };

    const before = await collectEmbeddingReplayState(job);
    assert.equal(before.partialDurableState, true, `expected partial durable embeddings state for cycle ${cycle}`);
    metrics.partialDurableRuns += 1;

    const repair = await repairEmbeddingReplayState(job);
    assert.equal(repair.repaired, true, `expected embeddings repair to take action for cycle ${cycle}`);
    metrics.repairedRuns += 1;

    const secondRepair = await repairEmbeddingReplayState(job);
    assert.equal(secondRepair.repaired, false, `expected second repair to be idempotent for cycle ${cycle}`);
    metrics.idempotentRuns += 1;
  }

  return {
    iterations: 4,
    repairedRuns: metrics.repairedRuns,
    idempotentRuns: metrics.idempotentRuns,
    partialDurableRuns: metrics.partialDurableRuns
  };
};

const seedSnapshotBuildRoot = async ({
  repoCacheRoot,
  buildId,
  token,
  end
}) => {
  const buildRoot = path.join(repoCacheRoot, 'builds', buildId);
  await fs.mkdir(buildRoot, { recursive: true });
  const { indexDir } = await createBaseIndex({
    rootDir: buildRoot,
    chunkMeta: [
      {
        id: 0,
        file: 'src/soak-snapshot.js',
        start: 0,
        end,
        text: `export const soak_marker = "${token}";`
      }
    ],
    fileMeta: [
      {
        id: 0,
        file: 'src/soak-snapshot.js',
        ext: '.js'
      }
    ],
    tokenPostings: {
      vocab: [token],
      postings: [
        [[0, 1]]
      ],
      docLengths: [1],
      avgDocLen: 1,
      totalDocs: 1
    }
  });
  await replaceDir(indexDir, path.join(buildRoot, 'index-code'));
  await writeJson(path.join(buildRoot, 'build_state.json'), {
    schemaVersion: 1,
    buildId,
    configHash: `cfg-${buildId}`,
    tool: { version: '1.0.0' },
    validation: { ok: true, issueCount: 0, warningCount: 0, issues: [] }
  });
};

const runSnapshotRecoverySoak = async () => {
  await fs.rm(snapshotRoot, { recursive: true, force: true });
  const repoRoot = path.join(snapshotRoot, 'repo');
  const cacheRoot = path.join(snapshotRoot, 'cache');
  await fs.mkdir(repoRoot, { recursive: true });

  applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    testConfig: {
      indexing: {
        embeddings: {
          enabled: false,
          mode: 'off',
          lancedb: { enabled: false },
          hnsw: { enabled: false }
        }
      }
    },
    extraEnv: { PAIROFCLEATS_WORKER_POOL: 'off' }
  });

  const markerPath = path.join(repoRoot, 'src', 'soak-snapshot.js');
  await fs.mkdir(path.dirname(markerPath), { recursive: true });
  await fs.writeFile(markerPath, 'export const soak_marker = "alpha";\n', 'utf8');

  const userConfig = loadUserConfig(repoRoot);
  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });

  const tokens = ['alpha', 'beta', 'gamma'];
  const snapshotChecks = [];

  for (let cycle = 0; cycle < tokens.length; cycle += 1) {
    const token = tokens[cycle];
    const buildId = `build-${token}`;
    await seedSnapshotBuildRoot({
      repoCacheRoot,
      buildId,
      token,
      end: 30 + cycle
    });
    await writeJson(path.join(repoCacheRoot, 'builds', 'current.json'), {
      buildId,
      buildRoot: `builds/${buildId}`,
      buildRoots: {
        code: `builds/${buildId}`
      }
    });
    const snapshotId = `snap-${token}`;
    await createPointerSnapshot({
      repoRoot,
      userConfig,
      modes: ['code'],
      snapshotId
    });

    const activeBuildLock = await acquireIndexLock({
      repoCacheRoot,
      waitMs: 0,
      metadata: {
        owner: 'build-index',
        operation: `stage4-promote-${token}`
      }
    });
    assert.ok(activeBuildLock, `expected index lock during snapshot cycle ${token}`);

    const resolved = resolveIndexRef({
      ref: `snap:${snapshotId}`,
      repoRoot,
      userConfig: loadUserConfig(repoRoot),
      requestedModes: ['code'],
      preferFrozen: true,
      allowMissingModes: false
    });
    const chunkMeta = await loadChunkMeta(resolved.indexDirByMode.code, { strict: false });
    snapshotChecks.push({
      snapshotId,
      token,
      canonical: resolved.canonical,
      end: chunkMeta[0]?.end ?? null
    });
    await activeBuildLock.release();
  }

  const latest = resolveIndexRef({
    ref: 'latest',
    repoRoot,
    userConfig: loadUserConfig(repoRoot),
    requestedModes: ['code'],
    preferFrozen: true,
    allowMissingModes: false
  });
  const latestChunkMeta = await loadChunkMeta(latest.indexDirByMode.code, { strict: false });

  return {
    iterations: tokens.length,
    snapshots: snapshotChecks,
    latest: {
      canonical: latest.canonical,
      end: latestChunkMeta[0]?.end ?? null
    }
  };
};

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const queue = await runQueueWorkerSoak();
const embeddings = await runEmbeddingRecoverySoak();
const snapshots = await runSnapshotRecoverySoak();

const passConditions = [
  {
    name: 'queue finished without active work',
    pass: queue.final.index.queued === 0
      && queue.final.index.running === 0
      && queue.final.heavy.queued === 0
      && queue.final.heavy.running === 0
  },
  {
    name: 'queue exercised stale recovery paths',
    pass: queue.staleRecoveries >= 2 && queue.quarantinedRecoveries >= 1
  },
  {
    name: 'embedding replay repair stayed idempotent',
    pass: embeddings.repairedRuns === embeddings.iterations && embeddings.idempotentRuns === embeddings.iterations
  },
  {
    name: 'snapshot reads remained stable across lock-protected cycles',
    pass: snapshots.snapshots.length === snapshots.iterations
      && snapshots.snapshots.every((entry, index) => entry.end === 30 + index)
      && snapshots.latest.end === 32
  }
];

const artifact = {
  generatedAt: new Date().toISOString(),
  suite: 'services-soak-operational-recovery',
  queue,
  embeddings,
  snapshots,
  passConditions
};

await writeArtifact('services-soak-operational-recovery.json', artifact);

assert.equal(passConditions.every((entry) => entry.pass), true, 'expected all soak pass conditions to hold');

console.log('services soak operational recovery test passed');
