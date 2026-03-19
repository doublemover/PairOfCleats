#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { collectEmbeddingReplayState, repairEmbeddingReplayState } from '../../../tools/service/embedding-replay.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'service-indexer-embedding-replay-contract');
const repoRoot = path.join(tempRoot, 'repo');
const buildRoot = path.join(repoRoot, 'builds', 'build-1');
const indexDir = path.join(buildRoot, 'index-code');
const backendStageDir = path.join(buildRoot, '.embeddings-backend-staging', 'index-code');
const buildStatePath = path.join(buildRoot, 'build_state.json');
const indexStatePath = path.join(indexDir, 'index_state.json');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
await fs.mkdir(backendStageDir, { recursive: true });

await fs.writeFile(path.join(indexDir, 'dense_vectors_uint8.bin'), 'vector-bytes');
await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify({ ok: true }, null, 2));
await fs.writeFile(buildStatePath, JSON.stringify({
  stage: 'stage3',
  updatedAt: '2026-03-18T00:00:00.000Z',
  phases: {
    stage3: {
      status: 'running'
    }
  },
  progress: {
    code: {
      completed: 12,
      total: 48
    }
  }
}, null, 2));
await fs.writeFile(indexStatePath, JSON.stringify({
  generatedAt: '2026-03-18T00:00:00.000Z',
  updatedAt: '2026-03-18T00:00:00.000Z',
  embeddings: {
    ready: false,
    pending: true,
    embeddingIdentityKey: 'identity-1'
  }
}, null, 2));

const job = {
  id: 'embedding-job-1',
  repo: repoRoot,
  repoRoot,
  buildRoot,
  indexDir,
  mode: 'code',
  embeddingPayloadFormatVersion: 2
};

const before = await collectEmbeddingReplayState(job);
assert.equal(before.jobId, 'embedding-job-1');
assert.equal(before.partialDurableState, true, 'expected pending embeddings state to be treated as partial durable state');
assert.equal(before.backendStage.exists, true, 'expected stale backend stage directory to be detected');
assert.equal(before.artifacts.presentCount >= 2, true, 'expected embedding artifacts to be summarized');
assert.equal(before.buildState?.stage, 'stage3');
assert.equal(before.buildState?.progress?.completed, 12);

const repair = await repairEmbeddingReplayState(job);
assert.equal(repair.repaired, true, 'expected repair to take action');
assert.equal(repair.actions.some((entry) => entry.type === 'remove-backend-stage-dir'), true);
assert.equal(repair.actions.some((entry) => entry.type === 'reset-pending-index-state'), true);

const after = await collectEmbeddingReplayState(job);
assert.equal(after.backendStage.exists, false, 'expected repair to remove stale backend stage directory');
assert.equal(after.embeddings.pending, false, 'expected repair to clear stale pending bit');
assert.equal(after.embeddings.ready, false, 'expected repair to keep embeddings unready after interrupted run');
assert.equal(after.embeddings.replay?.repairedBy, 'service-indexer');
assert.equal(Array.isArray(after.embeddings.replay?.actions), true);

const repairedState = JSON.parse(await fs.readFile(indexStatePath, 'utf8'));
assert.equal(repairedState.embeddings.pending, false);
assert.equal(repairedState.embeddings.ready, false);
assert.equal(repairedState.embeddings.replay.partialDurableState, true);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('indexer service embedding replay contract test passed');
