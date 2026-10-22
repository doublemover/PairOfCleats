import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveEmbeddingModelProfile } from '../../src/shared/embedding-model-profile.js';
import { EMBEDDING_ACQUISITION_RECEIPT, loadEmbeddingModelComponents, resolveEmbeddingAcquisitionPlan, resolveEmbeddingAcquisitionRoot } from '../../src/shared/embedding-model-loading.js';
import { resolveModelSetupReadiness } from '../../tools/setup/model-readiness.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-acquisition-plan-'));
const modelId = 'onnx-community/embeddinggemma-2-ONNX';
try {
  let generic;
  await loadEmbeddingModelComponents({ pipeline: async (...args) => { generic = args; return {}; } }, { modelId: 'fixture/generic' });
  assert.deepEqual(generic, ['feature-extraction', 'fixture/generic', { dtype: 'q8' }]);
  for (const options of [{}, { dtype: 'q4' }, { dtype: 'q8' }, { revision: 'a'.repeat(40) }]) {
    const profile = resolveEmbeddingModelProfile(modelId, options);
    const calls = [];
    const mod = {
      env: { version: '4.3.1' }, EmbeddingGemma2Model: class {},
      AutoConfig: { from_pretrained: async (...args) => { calls.push(['config', ...args]); return { model_type: 'embedding_gemma2', vision_config: {}, audio_config: {} }; } },
      AutoTokenizer: { from_pretrained: async (...args) => { calls.push(['tokenizer', ...args]); return {}; } },
      AutoModel: { from_pretrained: async (...args) => { calls.push(['model', ...args]); return {}; } }
    };
    const loaded = await loadEmbeddingModelComponents(mod, { modelId, modelsDir: root, modelProfile: profile });
    assert.deepEqual(loaded.plan, resolveEmbeddingAcquisitionPlan(modelId, profile));
    for (const call of calls) assert.equal(call[2].revision, profile.revision);
    assert.equal(calls[2][2].dtype, profile.dtype);
    assert.equal(calls[2][2].config.vision_config, null);
    assert.equal(calls[2][2].config.audio_config, null);
    const selectedRoot = resolveEmbeddingAcquisitionRoot(modelId, root, profile);
    const files = ['config.json', 'tokenizer.json', 'tokenizer_config.json', `onnx/selected-${profile.dtype}.onnx`, `onnx/selected-${profile.dtype}.onnx_data`];
    for (const file of files) {
      await fs.mkdir(path.dirname(path.join(selectedRoot, file)), { recursive: true });
      await fs.writeFile(path.join(selectedRoot, file), 'recording asset');
    }
    const receiptPath = path.join(selectedRoot, EMBEDDING_ACQUISITION_RECEIPT);
    await fs.writeFile(receiptPath, JSON.stringify({ plan: loaded.plan, files }));
    const readiness = embeddingsConfig => resolveModelSetupReadiness({ root, modelConfig: { id: modelId, dir: root }, embeddingsConfig });
    assert.equal(readiness({ embeddinggemma2: options }).present, true);
    await fs.writeFile(receiptPath, JSON.stringify({ plan: { ...loaded.plan, dtype: 'wrong' }, files }));
    assert.equal(readiness({ embeddinggemma2: options }).present, false, 'wrong precision receipt is not selected readiness');
    await fs.writeFile(receiptPath, JSON.stringify({ plan: { ...loaded.plan, revision: 'b'.repeat(40) }, files }));
    assert.equal(readiness({ embeddinggemma2: options }).present, false, 'wrong revision receipt is not selected readiness');
    await fs.writeFile(receiptPath, JSON.stringify({ plan: loaded.plan, files }));
    await fs.rm(path.join(selectedRoot, files.at(-1)));
    assert.equal(readiness({ embeddinggemma2: options }).present, false, 'missing external weights cannot count as staged');
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('embedding acquisition plan test passed');
