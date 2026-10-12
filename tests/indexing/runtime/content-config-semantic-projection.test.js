#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildContentConfigHash, projectSemanticEnvironment } from '../../../src/index/build/runtime/hash.js';
import { buildStageOverrides } from '../../../src/index/build/runtime/stage.js';

const base = { indexing: { maxFileBytes: 2048, embeddings: { model: 'fixture-model' } } };
const env = { embeddings: 'stub', embeddingsSampleSeed: 'fixed' };
const expected = buildContentConfigHash(base, env);
for (const unrelated of [
  { apiToken: 'synthetic-A' }, { apiToken: 'synthetic-B' }, { logLevel: 'debug', logFormat: 'json' },
  { threads: 8, schedulerMemoryTokens: 3, workerPoolHeapTargetMb: 128 },
  { stage: 'stage1' }, { stage: 'stage2' }, { cacheRoot: '/different-cache', toolingLogDir: '/logs' }
]) assert.equal(buildContentConfigHash(base, { ...env, ...unrelated }), expected);
assert.equal(Object.hasOwn(projectSemanticEnvironment({ ...env, apiToken: 'synthetic' }), 'apiToken'), false);
assert.notEqual(buildContentConfigHash(base, { ...env, embeddingsSampleSeed: 'other' }), expected);
assert.notEqual(buildContentConfigHash({ indexing: { maxFileBytes: 4096 } }, env), expected);
assert.equal(buildContentConfigHash({ ...base, threads: 8, runtime: { scheduler: { cpuTokens: 8 } },
  indexing: { ...base.indexing, memory: { reserveRssMb: 64 }, embeddingBatchSize: 64,
    embeddings: { ...base.indexing.embeddings, fileParallelism: 8, maxBatchTokens: 4096 } } }, env), expected);
// Stage selection enters semantic identity only through its resolved analysis settings.
const stage1 = { indexing: buildStageOverrides({}, 'stage1') };
const stage2 = { indexing: buildStageOverrides({}, 'stage2') };
assert.notEqual(buildContentConfigHash(stage1, {}), buildContentConfigHash(stage2, {}));
assert.equal(buildContentConfigHash(stage1, { stage: 'stage1' }), buildContentConfigHash(stage1, {}));
console.log('Explicit versioned content projection excludes credentials, logs, resources and raw stage selection.');
