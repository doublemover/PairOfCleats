import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveEmbeddingRuntime } from '../../../src/index/build/runtime/embeddings.js';
import { __setAdapterFactoryForTests } from '../../../src/shared/embedding-adapter.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-inline-provenance-'));
let creations = 0;
__setAdapterFactoryForTests(() => { creations += 1; throw new Error('model must remain uninitialized'); });
const resolve = (embeddings, envConfig = {}, argv = {}) => resolveEmbeddingRuntime({
  rootDir: root, userConfig: { models: { dir: path.join(root, 'models') } },
  indexingConfig: { embeddings }, envConfig, argv, cpuConcurrency: 1
});
const model = 'onnx-community/embeddinggemma-2-ONNX';
try {
  for (const embeddings of [
    { mode: 'off', provider: 'onnx', normalize: false, onnx: { modelPath: 'missing.onnx' } },
    { enabled: false, provider: 'onnx', normalize: false },
    { mode: 'service', provider: 'onnx', normalize: false }
  ]) {
    const runtime = await resolve(embeddings, {}, { model });
    assert.equal(runtime.embeddingEnabled, false);
    assert.notEqual(runtime.getEmbeddingObservation().state, 'ready');
    assert.equal(runtime.embeddingIdentity.modelArtifact, null);
  }
  const envOff = await resolve({ provider: 'onnx', normalize: false }, { embeddings: 'off' }, { model });
  assert.equal(envOff.embeddingEnabled, false);
  await assert.rejects(resolve({ mode: 'inline', provider: 'onnx' }, {}, { model }), /requires the xenova/);
  await assert.rejects(resolve({ mode: 'inline', provider: 'xenova', normalize: false }, {}, { model }), /requires normalization/);
  await assert.rejects(resolve({ mode: 'inline', provider: 'xenova' }, {}, { model: 'fixture/cold' }), { code: 'ERR_EMBEDDING_ARTIFACT_UNVERIFIED' });
  const modelRoot = path.join(root, 'models/fixture/verified');
  await fs.mkdir(path.join(modelRoot, 'onnx'), { recursive: true });
  await fs.writeFile(path.join(modelRoot, 'onnx/model_quantized.onnx'), 'recording weights');
  await fs.writeFile(path.join(modelRoot, 'tokenizer.json'), '{}');
  const known = await resolve({ mode: 'inline', provider: 'xenova' }, {}, { model: 'fixture/verified' });
  assert.equal(known.embeddingIdentity.modelArtifact.status, 'verified');
  assert.equal(known.getEmbeddingObservation().state, 'not-started');
  const stub = await resolve({ mode: 'stub' }, {}, { model: 'fixture/cold', dims: 8 });
  assert.equal(stub.embeddingIdentity.modelArtifact.status, 'stub');
  assert.equal(creations, 0);
} finally {
  __setAdapterFactoryForTests(null);
  await fs.rm(root, { recursive: true, force: true });
}
console.log('inactive and provenance runtime test passed');
