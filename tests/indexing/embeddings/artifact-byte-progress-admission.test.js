import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveEmbeddingArtifactIdentityAsync, getEmbeddingArtifactLeaseMetrics } from '../../../src/shared/embedding-artifact-lease.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('artifact-byte-progress-admission');
const weights = path.join(dir, 'fixture/model/onnx/model_quantized.onnx'), tokenizer = path.join(dir, 'fixture/model/tokenizer.json');
await fs.mkdir(path.dirname(weights), { recursive: true }); await fs.writeFile(weights, 'bounded selected bytes'); await fs.writeFile(tokenizer, '{}');
const options = { provider: 'xenova', modelId: 'fixture/model', modelsDir: dir }, originalOpen = fs.open;
try {
  for (const progress of [-1, 0.5, NaN, 1_048_577]) {
    let closes = 0, reads = 0;
    fs.open = async (file, ...args) => {
      const handle = await originalOpen(file, ...args);
      if (String(file) === weights) {
        const close = handle.close.bind(handle); handle.close = async () => { closes++; return close(); };
        handle.read = async () => { reads++; return { bytesRead: progress }; };
      }
      return handle;
    };
    await assert.rejects(resolveEmbeddingArtifactIdentityAsync(options), { code: 'ERR_EMBEDDING_ARTIFACT_CHANGED' });
    assert.equal(reads, 1); assert.equal(closes, 1);
  }
  let reads = 0;
  fs.open = async (file, ...args) => {
    const handle = await originalOpen(file, ...args);
    if (String(file) === weights) {
      const stat = handle.stat.bind(handle); handle.stat = async (...statArgs) => ({ ...await stat(...statArgs), size: 64n * 1024n ** 3n + 1n });
      handle.read = async () => { reads++; throw new Error('over-limit bytes must never be read'); };
    }
    return handle;
  };
  await assert.rejects(resolveEmbeddingArtifactIdentityAsync(options), { code: 'ERR_EMBEDDING_ARTIFACT_LIMIT' }); assert.equal(reads, 0);
  fs.open = originalOpen;
  await fs.rm(tokenizer);
  const before = getEmbeddingArtifactLeaseMetrics();
  const unknown = await resolveEmbeddingArtifactIdentityAsync({ ...options, provider: 'onnx', onnx: { modelPath: weights } });
  assert.equal(unknown.status, 'unknown'); assert.equal(unknown.reuse, 'refuse');
  assert.equal(getEmbeddingArtifactLeaseMetrics().bytesHashed, before.bytesHashed, 'missing provenance cannot justify a full graph read or reusable digest');
} finally { fs.open = originalOpen; await fs.rm(dir, { recursive: true, force: true }); }
console.log('Artifact read progress, byte limits, original descriptor closure and unknown-provenance work controls authored; execution deferred.');
