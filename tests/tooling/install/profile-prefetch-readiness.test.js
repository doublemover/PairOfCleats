import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prefetchEmbeddingModel } from '../../../src/shared/embedding-model-prefetch.js';
import { resolveEmbeddingAcquisitionRoot } from '../../../src/shared/embedding-model-loading.js';
import { resolveEmbeddingModelProfile } from '../../../src/shared/embedding-model-profile.js';
import { EMBEDDING_ACQUISITION_RECEIPT } from '../../../src/shared/embedding-acquisition-receipt.js';
import { resolveModelSetupReadiness } from '../../../tools/setup/model-readiness.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { getEmbeddingArtifactLeaseMetrics, resolveEmbeddingArtifactIdentityAsync } from '../../../src/shared/embedding-artifact-lease.js';

// Recording loaders with real bounded local assets; no model inference/network.
const { dir } = await prepareIsolatedTestCacheDir('profile-prefetch-readiness');
const modelId = 'onnx-community/embeddinggemma-2-ONNX';
const field = (number, data) => { const bytes = Buffer.from(data); return Buffer.concat([Buffer.from([number * 8 + 2, bytes.length]), bytes]); };
const entry = (key, value) => field(13, Buffer.concat([field(1, key), field(2, value)]));
const graph = field(7, field(5, Buffer.concat([entry('location', 'nested/weights.custom'), entry('length', '4'), Buffer.from([112, 1])])));
const cases = [{}, { dtype: 'q4' }, { dtype: 'q8' }, { dtype: 'q4', revision: 'a'.repeat(40) }];
try {
  for (const options of cases) {
    const profile = resolveEmbeddingModelProfile(modelId, options), calls = [];
    const selectedRoot = resolveEmbeddingAcquisitionRoot(modelId, dir, profile);
    const graphPath = `onnx/selected-${profile.dtype}.onnx`;
    let modelCloses = 0, tokenizerCloses = 0, abortAtRegistry = false;
    const controller = new AbortController();
    const mod = { env: { version: '4.3.1' }, EmbeddingGemma2Model: class {},
      AutoConfig: { from_pretrained: async (id, settings) => {
        calls.push(['config', id, settings]); return { model_type: 'embedding_gemma2', vision_config: {}, audio_config: {} };
      } },
      AutoTokenizer: { from_pretrained: async (id, settings) => {
        calls.push(['tokenizer', id, settings]); return { dispose: () => { tokenizerCloses++; } };
      } },
      AutoModel: { from_pretrained: async (id, settings) => {
        calls.push(['model', id, settings]);
        for (const [file, bytes] of [['config.json', '{}'], ['tokenizer.json', '{}'], ['tokenizer_config.json', '{}'],
          [graphPath, graph], ['onnx/nested/weights.custom', Buffer.alloc(4)]]) {
          const target = path.join(selectedRoot, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes);
        }
        return { dispose: () => { modelCloses++; } };
      } }, ModelRegistry: { get_model_files: async (id, settings) => {
        calls.push(['registry', id, settings]); if (abortAtRegistry) controller.abort(); return ['config.json', graphPath];
      } }, pipeline: () => assert.fail('qualified profile cannot use generic pipeline') };
    const result = await prefetchEmbeddingModel(mod, { modelId, modelsDir: dir, modelProfile: profile });
    assert.equal(result.plan.dtype, profile.dtype); assert.equal(result.plan.revision, profile.revision);
    assert(calls.slice(0, 3).every(call => call[2].revision === profile.revision));
    assert.equal(calls[2][2].dtype, profile.dtype); assert.equal(calls[3][2].config.vision_config, null);
    assert.equal(calls[3][2].config.audio_config, null);
    assert(result.receipt.files.includes('onnx/nested/weights.custom'), 'graph declarations extend the exact selected export closure');
    assert.equal(modelCloses, 1); assert.equal(tokenizerCloses, 1);
    const readiness = settings => resolveModelSetupReadiness({ root: dir, modelConfig: { id: modelId, dir }, embeddingsConfig: { embeddinggemma2: settings } });
    assert.equal(readiness(options).present, true);
    assert.equal(readiness({ ...options, dtype: profile.dtype === 'q4' ? 'q8' : 'q4' }).present, false);
    assert.equal(readiness({ ...options, revision: 'b'.repeat(40) }).present, false);
    assert.equal(calls.length, 4, 'readiness performs no loader/inference work');
    await fs.writeFile(path.join(selectedRoot, 'onnx/unused-sibling.onnx'), Buffer.alloc(4096));
    const artifact = await resolveEmbeddingArtifactIdentityAsync({ modelId, modelsDir: dir, modelProfile: profile, provider: 'xenova' });
    assert.equal(artifact.status, 'verified'); assert.equal(artifact.revision, profile.revision);
    assert(!artifact.inventory.some(row => row.path.includes('unused-sibling')), 'runtime hashes exactly the selected text closure');
    const beforeVerification = getEmbeddingArtifactLeaseMetrics();
    await resolveEmbeddingArtifactIdentityAsync({ modelId, modelsDir: dir, modelProfile: profile, provider: 'xenova' });
    const afterVerification = getEmbeddingArtifactLeaseMetrics();
    assert.equal(afterVerification.bytesHashed - beforeVerification.bytesHashed,
      artifact.inventory.reduce((sum, row) => sum + row.bytes, 0));
    const sidecarPath = path.join(selectedRoot, 'onnx/nested/weights.custom'), sidecarStat = await fs.stat(sidecarPath);
    await fs.writeFile(sidecarPath, Buffer.alloc(4, 1)); await fs.utimes(sidecarPath, sidecarStat.atime, sidecarStat.mtime);
    await assert.rejects(resolveEmbeddingArtifactIdentityAsync({ modelId, modelsDir: dir, modelProfile: profile, provider: 'xenova' }),
      { code: 'ERR_ONNX_ARTIFACT_INTEGRITY' }, 'same-size preserved-mtime changes cannot reuse a receipt digest');
    await fs.writeFile(sidecarPath, Buffer.alloc(4));
    const receiptPath = path.join(selectedRoot, EMBEDDING_ACQUISITION_RECEIPT), before = await fs.readFile(receiptPath);
    await fs.writeFile(path.join(selectedRoot, graphPath), Buffer.from([0x3a]));
    assert.equal(readiness(options).present, false, 'truncated selected graph invalidates presence evidence');
    abortAtRegistry = true;
    await assert.rejects(prefetchEmbeddingModel(mod, { modelId, modelsDir: dir, modelProfile: profile, signal: controller.signal }), { name: 'AbortError' });
    assert.deepEqual(await fs.readFile(receiptPath), before, 'cancelled acquisition cannot replace the previously closed receipt');
    assert.equal(modelCloses, 2); assert.equal(tokenizerCloses, 2);
    const receipt = JSON.parse(before); receipt.inventory[0].sha256 = 'f'.repeat(64);
    await fs.writeFile(receiptPath, JSON.stringify(receipt));
    assert.equal(readiness(options).present, false, 'modified identity metadata fails receipt admission');
  }
  const failure = Object.freeze(new Error('frozen selected profile registry failure'));
  const profile = resolveEmbeddingModelProfile(modelId);
  let closes = 0;
  const mod = { env: { version: '4.3.1' }, EmbeddingGemma2Model: class {},
    AutoConfig: { from_pretrained: async () => ({ model_type: 'embedding_gemma2' }) },
    AutoTokenizer: { from_pretrained: async () => ({ dispose() { closes++; } }) },
    AutoModel: { from_pretrained: async () => ({ dispose() { closes++; } }) },
    ModelRegistry: { get_model_files: async () => { throw failure; } } };
  await assert.rejects(prefetchEmbeddingModel(mod, { modelId, modelsDir: dir, modelProfile: profile }), error => error === failure);
  assert.equal(closes, 2);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Profile prefetch, exact selected closure, cancellation and readiness controls authored; execution deferred.');
