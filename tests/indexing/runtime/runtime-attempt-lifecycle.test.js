#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBuildRuntime } from '../../../src/index/build/runtime/runtime.js';
import { teardownRuntime } from '../../../src/integrations/core/build-index/runtime.js';
import { initBuildState } from '../../../src/index/build/build-state.js';
import { initializeRuntimeReceipt, refreshRuntimeReceipt } from '../../../src/index/build/runtime/receipt.js';
import { __setAdapterFactoryForTests } from '../../../src/shared/embedding-adapter.js';
import { resolveEmbeddingRuntime } from '../../../src/index/build/runtime/embeddings.js';
import { withTemporaryEnv, applyTestEnv } from '../../helpers/test-env.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-runtime-lifecycle-'));
try {
  const repo = path.join(dir, 'repo');
  await fs.mkdir(repo);
  await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify({
    quality: 'fast', threads: 1,
    indexing: { scm: { provider: 'none' }, workerPool: { enabled: false }, embeddings: { enabled: false, mode: 'off' }, platformPresets: { startupCalibration: false } },
    tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }
  }));
  const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(dir, 'cache'), embeddings: 'off',
    extraEnv: { PAIROFCLEATS_HOME: path.join(dir, 'home') } });
  await withTemporaryEnv(env, async () => {
    const runtime = await createBuildRuntime({ root: repo, argv: { stage: 'stage1', threads: 1 }, rawArgv: [] });
    const coordinationRoot = path.join(dir, 'home', 'state', 'storage-access');
    assert.equal((await inspectStorageAccess(path.join(dir, 'cache'), { coordinationRoot })).protected, true,
      'runtime initialization retains category ownership before any indexing lock exists');
    try {
      const statePath = path.join(runtime.buildRoot, 'build_state.json');
      const state = JSON.parse(await fs.readFile(statePath));
      const record = state.runtime.attempts[0];
      assert.equal(record.lifecycle, 'running');
      assert.equal(record.inputs.configSources.files[0].source, 'repository');
      assert.equal(record.runtime.workers.tokenizationExecution, 'not-yet-observed',
        'initialization alone cannot claim an observed tokenization route');
      assert.equal(record.embeddings.observation.state, 'not-started');
      await refreshRuntimeReceipt(runtime, { lifecycle: 'succeeded' });
      assert.equal(JSON.parse(await fs.readFile(statePath)).runtime.attempts[0].lifecycle, 'succeeded');
    } finally { await teardownRuntime(runtime); }
    assert.equal((await inspectStorageAccess(path.join(dir, 'cache'), { coordinationRoot })).protected, false);
  });
  const pinnedRoot = path.join(dir, 'pinned');
  await initBuildState({ buildRoot: pinnedRoot, buildId: 'persisted-generation', repoRoot: repo, modes: ['code'], stage: 'stage2' });
  const pinnedPath = path.join(pinnedRoot, 'build_state.json');
  const previous = JSON.parse(await fs.readFile(pinnedPath));
  previous.createdAt = '2020-01-01T00:00:00.000Z';
  previous.finishedAt = '2020-01-02T00:00:00.000Z';
  previous.phases = { validation: { status: 'done', startedAt: previous.createdAt, finishedAt: previous.finishedAt } };
  previous.producerExtension = { checkpoint: 'retained', promotion: 'retained' };
  await fs.writeFile(pinnedPath, JSON.stringify(previous));
  const checkpointPath = path.join(pinnedRoot, 'build_state.stage-checkpoints.json');
  await fs.writeFile(checkpointPath, '{"prior":"checkpoint"}');
  const initialized = await initializeRuntimeReceipt({ buildRoot: pinnedRoot, buildId: previous.buildId, root: repo, stage: 'stage4' });
  const preserved = JSON.parse(await fs.readFile(pinnedPath));
  for (const key of ['createdAt', 'finishedAt', 'phases', 'modes', 'producerExtension']) assert.deepEqual(preserved[key], previous[key]);
  assert.equal(preserved.runtime.attempts[0].attemptId, initialized.attemptId);
  assert.equal(await fs.readFile(checkpointPath, 'utf8'), '{"prior":"checkpoint"}');
  for (const patch of [{ schemaVersion: 999 }, { artifactSurfaceVersion: 'unknown' }, { buildId: 7 }, { runtime: { schemaVersion: 1, attempts: [null] } }]) {
    const corrupt = JSON.stringify({ ...previous, ...patch });
    await fs.writeFile(pinnedPath, corrupt);
    await assert.rejects(initializeRuntimeReceipt({ buildRoot: pinnedRoot, buildId: previous.buildId, root: repo, stage: 'stage4' }), { code: 'ERR_RUNTIME_RECEIPT_CONTRACT' });
    assert.equal(await fs.readFile(pinnedPath, 'utf8'), corrupt);
  }
  const transitions = [];
  const embedding = await resolveEmbeddingRuntime({ rootDir: repo, userConfig: {}, indexingConfig: { embeddings: { mode: 'stub' } }, envConfig: {}, argv: { dims: 8 }, cpuConcurrency: 1,
    onEmbeddingObservation: async (record) => transitions.push(structuredClone(record)) });
  assert.equal(embedding.getEmbeddingObservation().state, 'not-started');
  await embedding.getChunkEmbeddings([]);
  assert.equal(transitions.length, 0);
  const result = await embedding.getChunkEmbedding('tiny stub');
  assert.equal(result.length, 8);
  assert.deepEqual(transitions.map((entry) => entry.observation.state), ['loading', 'ready']);
  assert.equal(transitions[1].observation.method, 'stub-vector-returned');
  assert.equal(transitions[1].observation.device, null);
  const failing = await resolveEmbeddingRuntime({ rootDir: repo, userConfig: {}, indexingConfig: { embeddings: { mode: 'stub' } }, envConfig: {}, argv: { dims: 8 }, cpuConcurrency: 1,
    onEmbeddingObservation: async ({ observation }) => { if (observation.state === 'ready') throw Object.assign(new Error('cannot persist ready'), { code: 'ENOSPC' }); } });
  await assert.rejects(failing.getChunkEmbedding('blocked result'), { code: 'ENOSPC' });
  assert.equal(failing.getEmbeddingObservation().state, 'failed');
  let observedDims = 7;
  const modelRoot = path.join(dir, 'models/fixture/recording');
  await fs.mkdir(path.join(modelRoot, 'onnx'), { recursive: true });
  await fs.writeFile(path.join(modelRoot, 'onnx/model_quantized.onnx'), 'recording graph bytes');
  await fs.writeFile(path.join(modelRoot, 'tokenizer.json'), '{}');
  const recordingConfig = { models: { id: 'fixture/recording', dir: path.join(dir, 'models') } };
  __setAdapterFactoryForTests(() => ({ provider: 'xenova', embedOne: async () => new Float32Array(observedDims), embedderPromise: null }));
  try {
    const unknownDims = await resolveEmbeddingRuntime({ rootDir: repo, userConfig: recordingConfig, indexingConfig: { embeddings: { provider: 'xenova', mode: 'inline' } }, envConfig: {}, argv: {}, cpuConcurrency: 1 });
    const selectedKey = unknownDims.embeddingIdentityKey;
    assert.equal(unknownDims.embeddingIdentity.dims, null);
    assert.equal((await unknownDims.getChunkEmbedding('undeclared dimensions')).length, 7);
    assert.equal(unknownDims.getEmbeddingObservation().dims, 7);
    assert.equal(unknownDims.embeddingIdentity.dims, null);
    assert.equal(unknownDims.embeddingIdentityKey, selectedKey, 'first inference must not retrofit a preselected inline cache key');
    observedDims = 6;
    await assert.rejects(unknownDims.getChunkEmbedding('changed dimensions'), { code: 'ERR_EMBEDDING_DIMS_MISMATCH' });
    assert.equal(unknownDims.embeddingIdentityKey, selectedKey);
  } finally { __setAdapterFactoryForTests(null); }
  let provider = 'onnx';
  __setAdapterFactoryForTests(() => ({
    get provider() { return provider; }, embedderPromise: null,
    embedOne: async () => { provider = 'xenova'; return new Float32Array(8); },
    executionInfo: () => ({ loaded: true, fallback: { from: 'onnx', to: 'xenova', code: 'ERR_DLOPEN_FAILED' } })
  }));
  try {
    const failures = [];
    const fallback = await resolveEmbeddingRuntime({ rootDir: repo, userConfig: recordingConfig, indexingConfig: { embeddings: { provider: 'onnx', mode: 'inline' } }, envConfig: {}, argv: { dims: 8 }, cpuConcurrency: 1,
      onEmbeddingObservation: async (record) => failures.push(structuredClone(record)) });
    const signatureIdentityBeforeInference = fallback.embeddingIdentityKey;
    let published = 0;
    await assert.rejects((async () => { await fallback.getChunkEmbedding('native fallback'); published += 1; })(), { code: 'ERR_EMBEDDING_PROVIDER_CHANGED' });
    assert.equal(published, 0, 'inline fallback must never pass its publication boundary');
    assert.equal(failures.at(-1).observation.provider, 'xenova');
    assert.equal(failures.at(-1).observation.requestedProvider, 'onnx');
    assert.equal(failures.at(-1).observation.state, 'failed');
    assert.notEqual(fallback.embeddingIdentityKey, signatureIdentityBeforeInference, 'actual identity is recorded, but never repairs earlier reuse by assertion');
  } finally { __setAdapterFactoryForTests(null); }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('runtime attempt initialization and provider transition test passed');
