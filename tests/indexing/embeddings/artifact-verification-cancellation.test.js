import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireEmbeddingArtifactLease, getEmbeddingArtifactLeaseMetrics } from '../../../src/shared/embedding-artifact-lease.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('artifact-verification-cancellation');
const weights = path.join(dir, 'fixture/model/onnx/model_quantized.onnx');
const tokenizer = path.join(dir, 'fixture/model/tokenizer.json');
await fs.mkdir(path.dirname(weights), { recursive: true }); await fs.writeFile(weights, 'controlled mutable weights'); await fs.writeFile(tokenizer, '{}');
const originalOpen = fs.open;
let release, entered;
const gate = new Promise(resolve => { release = resolve; });
const reading = new Promise(resolve => { entered = resolve; });
let closes = 0;
try {
  fs.open = async (file, ...args) => {
    const handle = await originalOpen(file, ...args);
    if (String(file) === weights) {
      const read = handle.read.bind(handle), close = handle.close.bind(handle);
      handle.read = async (...readArgs) => { entered(); await gate; return read(...readArgs); };
      handle.close = async () => { closes++; return close(); };
    }
    return handle;
  };
  const controller = new AbortController();
  const options = { provider: 'xenova', modelId: 'fixture/model', modelsDir: dir };
  const before = getEmbeddingArtifactLeaseMetrics();
  const cancelled = acquireEmbeddingArtifactLease(options, { signal: controller.signal });
  const sibling = acquireEmbeddingArtifactLease({ ...options, onnx: { intraOpNumThreads: 8 } });
  await reading; controller.abort();
  const error = await cancelled.then(() => assert.fail('cancelled acquisition must reject'), value => value);
  assert.equal(error.name, 'AbortError'); assert.equal(error.cacheOwnershipReleased(), false);
  assert.equal(error.artifactVerificationOwner.pending, true); assert.equal(closes, 0);
  release(); const lease = await sibling; await error.artifactVerificationOwner.drain();
  assert.equal(lease.artifact.status, 'verified'); assert.equal(error.cacheOwnershipReleased(), true);
  assert.equal(closes, 1); lease.release();
  const after = getEmbeddingArtifactLeaseMetrics();
  assert.equal(after.verifications - before.verifications, 1, 'resource settings cannot duplicate the same selected-byte verification');
  assert.equal(after.coalesced - before.coalesced, 1);
} finally { release(); fs.open = originalOpen; await fs.rm(dir, { recursive: true, force: true }); }
console.log('Shared artifact verification cancellation and exact closure coalescing controls authored; execution deferred.');
