#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getEmbeddingAdapter, disposeEmbeddingAdapterCaches,
  __setTransformersModuleLoaderForTests } from '../../../src/shared/embedding-adapter.js';
import { resolveEmbeddingArtifactIdentity } from '../../../src/shared/embedding-artifact-identity.js';
import { getQueryEmbedding } from '../../../src/retrieval/embedding.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('query-warm-cache-lifetime');
const modelId = 'fixture/warm', modelsDir = path.join(dir, 'models');
const root = path.join(modelsDir, modelId);
await fs.mkdir(path.join(root, 'onnx'), { recursive: true });
await fs.writeFile(path.join(root, 'onnx/model_quantized.onnx'), 'controlled weights');
await fs.writeFile(path.join(root, 'tokenizer.json'), '{}');
let creates = 0, releases = 0, entered, releaseRun;
const started = new Promise(resolve => { entered = resolve; });
const held = new Promise(resolve => { releaseRun = resolve; });
__setTransformersModuleLoaderForTests(async () => ({ env: {}, pipeline: async () => {
  creates++;
  let disposed = false;
  const pipeline = async texts => {
    assert.equal(disposed, false);
    if (texts.includes('fail')) throw new Error('controlled inference rejection');
    if (texts.includes('held')) { entered(); await held; }
    assert.equal(disposed, false);
    return texts.map(() => Float32Array.from([1, 2, 3]));
  };
  pipeline.dispose = async () => { assert.equal(disposed, false); disposed = true; releases++; };
  return pipeline;
} }));
const options = { provider: 'xenova', modelId, modelsDir, rootDir: dir };
const query = text => getQueryEmbedding({ ...options, text, dims: 3, modelDir: modelsDir });
const tick = () => new Promise(resolve => setImmediate(resolve));
const realNow = Date.now;
try {
  for (const text of ['first', 'second', 'third']) assert.deepEqual(await query(text), Float32Array.from([1, 2, 3]));
  assert.equal(creates, 1, 'distinct sequential queries retain their warm provider');
  assert.equal(releases, 0, 'returning the query lease does not return cache ownership');

  Date.now = () => realNow() + 16 * 60 * 1000;
  await query('after expiry');
  Date.now = realNow;
  await tick();
  assert.equal(creates, 2, 'expired cache ownership cannot serve a new query');
  assert.equal(releases, 1);

  await fs.writeFile(path.join(root, 'tokenizer.json'), '{"changed":true}');
  await query('new tokenizer');
  assert.equal(creates, 3, 'changed artifact identity selects a new warm entry');
  await disposeEmbeddingAdapterCaches();
  assert.equal(releases, creates);

  // Active leases survive cache retirement; shutdown joins their eventual drain.
  const sibling = getEmbeddingAdapter({ ...options, retainInCache: true });
  const pending = sibling.embed(['held']);
  await started;
  const disposingLease = sibling.dispose();
  let shutdownDone = false;
  const shutdown = disposeEmbeddingAdapterCaches().then(() => { shutdownDone = true; });
  let secondShutdownDone = false;
  const secondShutdown = disposeEmbeddingAdapterCaches().then(() => { secondShutdownDone = true; });
  await tick();
  assert.equal(shutdownDone, false);
  assert.equal(secondShutdownDone, false, 'repeated shutdown joins already-retiring owners');
  assert.equal(releases, creates - 1);
  releaseRun();
  await pending; await disposingLease; await shutdown; await secondShutdown;
  assert.equal(releases, creates);

  // Bounded LRU retains at most 64 adapters; distinct consumer workspaces share
  // the same raw pipeline and keep the same valid output dimensions.
  const artifact = resolveEmbeddingArtifactIdentity(options);
  const first = getEmbeddingAdapter({ ...options, modelArtifact: artifact, dims: 3, retainInCache: true });
  await first.embed(['one']);
  await first.dispose();
  const oldestPipelineCreates = creates;
  for (let consumer = 1; consumer <= 65; consumer++) {
    const rootDir = path.join(dir, `consumer-${consumer}`);
    await fs.mkdir(rootDir);
    const lease = getEmbeddingAdapter({ ...options, rootDir, modelArtifact: artifact, dims: 3, retainInCache: true });
    await lease.embed(['another']);
    await lease.dispose();
  }
  await tick();
  assert.equal(creates, oldestPipelineCreates, 'LRU eviction does not dispose a pipeline owned by siblings');
  await disposeEmbeddingAdapterCaches();
  assert.equal(releases, creates);

  // Distinct native cache keys also obey the adapter bound, not merely the
  // smaller pipeline lookup map (whose active leases may outlive eviction).
  for (let threads = 1; threads <= 65; threads++) {
    const lease = getEmbeddingAdapter({ ...options, modelArtifact: artifact,
      sessionOptions: { intraOpNumThreads: threads }, retainInCache: true });
    await lease.embed(['bounded native entry']);
    await lease.dispose();
  }
  await tick();
  assert.equal(creates - releases, 64, 'the bounded cache owns at most 64 idle native adapters');
  await disposeEmbeddingAdapterCaches();
  assert.equal(releases, creates);

  // Idle TTL cleanup needs no subsequent request and does not keep Node alive.
  const originalSetTimeout = globalThis.setTimeout;
  let expire, retentionTimer, idle;
  try {
    globalThis.setTimeout = (callback, delay, ...args) => {
      const timer = originalSetTimeout(callback, delay, ...args);
      if (delay === 15 * 60 * 1000) { expire = callback; retentionTimer = timer; }
      return timer;
    };
    idle = getEmbeddingAdapter({ ...options, retainInCache: true });
    await idle.embed(['idle']);
    await idle.dispose();
  } finally { globalThis.setTimeout = originalSetTimeout; }
  assert.ok(retentionTimer, 'the actual deferred acquisition establishes the idle retention timer');
  assert.equal(retentionTimer.hasRef(), false);
  expire();
  await tick();
  assert.equal(releases, creates);

  await query('healthy');
  assert.equal(await query('fail'), null);
  assert.equal(releases, creates, 'failed warm providers surrender cache ownership');
  const beforeRecovery = creates;
  await query('recovered');
  assert.equal(creates, beforeRecovery + 1);
  await disposeEmbeddingAdapterCaches();

  // Unknown authorities must not acquire a reusable cache owner.
  await fs.rm(path.join(root, 'tokenizer.json'));
  await query('unknown one');
  await query('unknown two');
  assert.equal(releases, creates, 'unknown query attempts release all native ownership');
} finally {
  Date.now = realNow;
  releaseRun();
  await disposeEmbeddingAdapterCaches();
  __setTransformersModuleLoaderForTests(null);
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Sequential query warmth, TTL/LRU retirement, identity changes, unknown isolation and joined shutdown pass.');
