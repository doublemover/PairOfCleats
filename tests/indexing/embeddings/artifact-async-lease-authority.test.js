import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { acquireEmbeddingArtifactLease, resolveEmbeddingArtifactIdentityAsync, getEmbeddingArtifactLeaseMetrics } from '../../../src/shared/embedding-artifact-lease.js';
import { resolveEmbeddingArtifactIdentity } from '../../../src/shared/embedding-artifact-identity.js';
import { getEmbeddingAdapter, __setAdapterFactoryForTests, disposeEmbeddingAdapterCaches } from '../../../src/shared/embedding-adapter.js';
import { createDeferredEmbeddingAdapter } from '../../../src/shared/embedding-deferred-adapter.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('artifact-async-lease-authority');
const modelRoot = path.join(dir, 'owner', 'model'), weights = path.join(modelRoot, 'onnx', 'model_quantized.onnx'), tokenizer = path.join(modelRoot, 'tokenizer.json');
const options = { provider: 'xenova', modelId: 'owner/model', modelsDir: dir };
await fs.mkdir(path.dirname(weights), { recursive: true });
await fs.writeFile(weights, 'weight-bytes-version-a'); await fs.writeFile(tokenizer, '{"version":"one"}');
try {
  const before = getEmbeddingArtifactLeaseMetrics();
  const leases = await Promise.all([acquireEmbeddingArtifactLease(options), acquireEmbeddingArtifactLease(options), acquireEmbeddingArtifactLease(options)]);
  const after = getEmbeddingArtifactLeaseMetrics();
  assert.equal(after.verifications - before.verifications, 1);
  assert.equal(after.coalesced - before.coalesced, 2);
  assert.equal(after.bytesHashed - before.bytesHashed, (await fs.stat(weights)).size + (await fs.stat(tokenizer)).size);
  assert.deepEqual(leases[0].artifact, resolveEmbeddingArtifactIdentity(options), 'async acquisition preserves canonical artifact digest meaning');
  assert.ok(Object.isFrozen(leases[0].artifact.inventory));
  const originalDigest = leases[0].artifact.digest, originalStat = await fs.stat(weights);
  await fs.writeFile(weights, 'weight-bytes-version-b'); await fs.utimes(weights, originalStat.atime, originalStat.mtime);
  assert.notEqual((await resolveEmbeddingArtifactIdentityAsync(options)).digest, originalDigest, 'same-size preserved-mtime edits are hashed, not stat-cached');
  await assert.rejects(leases[1].verifyLoaded(), error => error.code === 'ERR_EMBEDDING_ARTIFACT_INCOMPATIBLE');
  leases.forEach(lease => lease.release());
  await assert.rejects(leases[0].verifyLoaded(), /released/);
  const tokenizerBefore = (await resolveEmbeddingArtifactIdentityAsync(options)).digest;
  await fs.writeFile(tokenizer, '{"version":"two"}');
  assert.notEqual((await resolveEmbeddingArtifactIdentityAsync(options)).digest, tokenizerBefore);
  const unknown = await Promise.all([acquireEmbeddingArtifactLease({ ...options, modelId: 'missing' }), acquireEmbeddingArtifactLease({ ...options, modelId: 'missing' })]);
  assert.ok(unknown.every(lease => lease.artifact.status === 'unknown' && lease.artifact.reuse === 'refuse'));
  assert.notEqual(unknown[0].artifact.attempt, unknown[1].artifact.attempt); unknown.forEach(lease => lease.release());

  const originalOpen = fs.open; let closes = 0;
  try {
    fs.open = async function (filename, ...args) {
      const handle = await originalOpen.call(this, filename, ...args);
      if (String(filename) === weights) {
        handle.read = async () => { throw new Error('injected verification read failure'); };
        const close = handle.close.bind(handle); handle.close = async () => { closes++; return close(); };
      }
      return handle;
    };
    await assert.rejects(resolveEmbeddingArtifactIdentityAsync(options), /verification read failure/);
  } finally { fs.open = originalOpen; }
  assert.equal(closes, 1); assert.equal(getEmbeddingArtifactLeaseMetrics().active, 0);

  let factories = 0, disposed = 0;
  __setAdapterFactoryForTests(config => {
    factories++;
    return { provider: 'xenova', embedOne: async () => Float32Array.of(1, 2),
      executionInfo: () => ({ provider: 'xenova', requestedProvider: 'xenova', loaded: true, modelArtifact: config.modelArtifact }),
      dispose: async () => { disposed++; } };
  });
  const adapters = [];
  try {
    const originalReadSync = fsSync.readSync;
    try {
      fsSync.readSync = () => { throw new Error('synchronous model byte reads are forbidden in runtime acquisition'); };
      const first = getEmbeddingAdapter({ ...options, retainInCache: true }), second = getEmbeddingAdapter({ ...options, retainInCache: true });
      adapters.push(first, second);
      assert.equal(factories, 0, 'synchronous API construction does not hash or acquire the provider');
      await Promise.all([first.embedOne('first'), second.embedOne('second')]);
      assert.equal(factories, 1, 'equal verified identities share the existing adapter cache');
      const warm = getEmbeddingAdapter({ ...options, retainInCache: true }); adapters.push(warm);
      const warmBefore = getEmbeddingArtifactLeaseMetrics().bytesHashed;
      await warm.embedOne('warm');
      assert.ok(getEmbeddingArtifactLeaseMetrics().bytesHashed > warmBefore, 'mutable warm acquisition revalidates bytes');
      const oldDigest = warm.executionInfo().modelArtifact.digest, stat = await fs.stat(weights);
      await fs.writeFile(weights, 'weight-bytes-version-c'); await fs.utimes(weights, stat.atime, stat.mtime);
      const replaced = getEmbeddingAdapter({ ...options, retainInCache: true }); adapters.push(replaced);
      await replaced.embedOne('replaced');
      assert.notEqual(replaced.executionInfo().modelArtifact.digest, oldDigest); assert.equal(factories, 2);
    } finally { fsSync.readSync = originalReadSync; }
  } finally {
    await Promise.all(adapters.map(adapter => adapter.dispose()));
    await disposeEmbeddingAdapterCaches(); __setAdapterFactoryForTests(null);
  }
  assert.equal(disposed, 2);

  let releaseAcquire; const acquireGate = new Promise(resolve => { releaseAcquire = resolve; });
  let released = 0, invoked = 0;
  const deferred = createDeferredEmbeddingAdapter({ provider: 'inert', methods: ['embedOne'], acquire: async () => {
    await acquireGate; return { embedOne: async () => { invoked++; }, dispose: async () => { released++; } };
  } });
  const work = deferred.embedOne('pending'), rejected = assert.rejects(work, error => error.code === 'ERR_EMBEDDING_RUNTIME_CLOSED');
  let finished = false; const closing = deferred.dispose().then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(finished, false);
  releaseAcquire(); await rejected; await closing;
  assert.equal(invoked, 0); assert.equal(released, 1);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Bounded async artifact leases coalesce live verification without stat-only reuse or detached adapter acquisition.');
