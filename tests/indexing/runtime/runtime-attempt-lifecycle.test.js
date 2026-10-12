#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBuildRuntime } from '../../../src/index/build/runtime/runtime.js';
import { teardownRuntime } from '../../../src/integrations/core/build-index/runtime.js';
import { refreshRuntimeReceipt } from '../../../src/index/build/runtime/receipt.js';
import { __setAdapterFactoryForTests } from '../../../src/shared/embedding-adapter.js';
import { resolveEmbeddingRuntime } from '../../../src/index/build/runtime/embeddings.js';
import { withTemporaryEnv, applyTestEnv } from '../../helpers/test-env.js';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-runtime-lifecycle-'));
try {
  const repo = path.join(dir, 'repo');
  await fs.mkdir(repo);
  await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify({
    quality: 'fast', threads: 1,
    indexing: { scm: { provider: 'none' }, workerPool: { enabled: false }, embeddings: { enabled: false, mode: 'off' }, platformPresets: { startupCalibration: false } },
    tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }
  }));
  const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(dir, 'cache'), embeddings: 'off' });
  await withTemporaryEnv(env, async () => {
    const runtime = await createBuildRuntime({ root: repo, argv: { stage: 'stage1', threads: 1 }, rawArgv: [] });
    try {
      const statePath = path.join(runtime.buildRoot, 'build_state.json');
      const state = JSON.parse(await fs.readFile(statePath));
      const record = state.runtime.attempts[0];
      assert.equal(record.lifecycle, 'running');
      assert.equal(record.inputs.configSources.files[0].source, 'repository');
      assert.equal(record.runtime.workers.tokenizationExecution, 'inline');
      assert.equal(record.embeddings.observation.state, 'not-started');
      await refreshRuntimeReceipt(runtime, { lifecycle: 'succeeded' });
      assert.equal(JSON.parse(await fs.readFile(statePath)).runtime.attempts[0].lifecycle, 'succeeded');
    } finally { await teardownRuntime(runtime); }
  });
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
  let provider = 'onnx';
  __setAdapterFactoryForTests(() => ({
    get provider() { return provider; }, embedderPromise: null,
    embedOne: async () => { provider = 'xenova'; return new Float32Array(8); },
    executionInfo: () => ({ loaded: true, fallback: { from: 'onnx', to: 'xenova', code: 'ERR_DLOPEN_FAILED' } })
  }));
  try {
    const failures = [];
    const fallback = await resolveEmbeddingRuntime({ rootDir: repo, userConfig: {}, indexingConfig: { embeddings: { provider: 'onnx', mode: 'inline' } }, envConfig: {}, argv: { dims: 8 }, cpuConcurrency: 1,
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
