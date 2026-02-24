#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runEmbeddingsStage } from '../../../src/integrations/core/build-index/stages.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-stage3-service-queue-status-'));
const repoRoot = path.join(tempRoot, 'repo');
const queueDir = path.join(tempRoot, 'queue');
const cacheRoot = path.join(tempRoot, 'cache');
await fs.mkdir(repoRoot, { recursive: true });
await fs.mkdir(cacheRoot, { recursive: true });

const result = await runEmbeddingsStage({
  root: repoRoot,
  argv: {},
  embedModes: ['code', 'prose'],
  embeddingRuntime: {
    embeddingEnabled: true,
    embeddingService: true,
    queueDir,
    queueMaxQueued: 0,
    useStubEmbeddings: false
  },
  userConfig: {},
  indexRoot: repoRoot,
  includeEmbeddings: false,
  overallProgressRef: { current: null },
  log: () => {},
  abortSignal: null,
  repoCacheRoot: cacheRoot,
  runtimeEnv: process.env,
  recordIndexMetric: () => {},
  buildEmbeddingsPath: path.join(process.cwd(), 'bin', 'pairofcleats.js')
});

assert.equal(result.stage, 'stage3', 'expected stage3 result');
assert.equal(result.embeddings.queued, false, 'expected queued=false when all enqueues fail');
assert.equal(result.embeddings.skipped, true, 'expected skipped=true when all enqueues fail');
assert.deepEqual(result.embeddings.jobs, [], 'expected no queued jobs when queue rejects all modes');

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('stage3 service queue status test passed');
