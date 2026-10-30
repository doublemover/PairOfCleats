import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EMBEDDING_GEMMA2_RUNTIME, resolveEmbeddingModelProfile } from '../../src/shared/embedding-model-profile.js';
import { EMBEDDING_ACQUISITION_RECEIPT, loadEmbeddingModelComponents, resolveEmbeddingAcquisitionPlan, resolveEmbeddingAcquisitionRoot } from '../../src/shared/embedding-model-loading.js';
import { resolveModelSetupReadiness } from '../../tools/setup/model-readiness.js';
import { publishEmbeddingAcquisitionReceipt } from '../../src/shared/embedding-acquisition-receipt.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-acquisition-plan-'));
const modelId = 'onnx-community/embeddinggemma-2-ONNX';
try {
  const packageManifest = JSON.parse(await fs.readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(EMBEDDING_GEMMA2_RUNTIME, `transformers.js@${packageManifest.dependencies['@huggingface/transformers']}`,
    'the authoritative exact model runtime must match the locked public dependency');
  let generic;
  await loadEmbeddingModelComponents({ pipeline: async (...args) => { generic = args; return {}; } }, { modelId: 'fixture/generic' });
  assert.deepEqual(generic, ['feature-extraction', 'fixture/generic', { dtype: 'q8' }]);
  const sessionOptions = { intraOpNumThreads: 1, interOpNumThreads: 1, enableCpuMemArena: false };
  const genericLoad = loadEmbeddingModelComponents({ pipeline: async (...args) => { generic = args; return {}; } },
    { modelId: 'fixture/generic', modelsDir: root, localFilesOnly: true, sessionOptions });
  sessionOptions.intraOpNumThreads = 8;
  await genericLoad;
  assert.deepEqual(generic, ['feature-extraction', 'fixture/generic', { dtype: 'q8', cache_dir: root,
    local_files_only: true, session_options: { intraOpNumThreads: 1, interOpNumThreads: 1, enableCpuMemArena: false } }],
  'generic pipelines must receive the captured native session policy, independently of caller mutation');
  for (const options of [{}, { dtype: 'q4' }, { dtype: 'q8' }, { revision: 'a'.repeat(40) }]) {
    const profile = resolveEmbeddingModelProfile(modelId, options);
    assert.equal(profile.runtime, EMBEDDING_GEMMA2_RUNTIME);
    const calls = [];
    const mod = {
      env: { version: '4.3.2' }, EmbeddingGemma2Model: class {},
      AutoConfig: { from_pretrained: async (...args) => { calls.push(['config', ...args]); return { model_type: 'embedding_gemma2', vision_config: {}, audio_config: {} }; } },
      AutoTokenizer: { from_pretrained: async (...args) => { calls.push(['tokenizer', ...args]); return {}; } },
      AutoModel: { from_pretrained: async (...args) => { calls.push(['model', ...args]); return {}; } }
    };
    for (const version of ['4.3.1', '4.3.3', undefined]) {
      await assert.rejects(loadEmbeddingModelComponents({ ...mod, env: { version } },
        { modelId, modelsDir: root, modelProfile: profile }), /requires its qualified Transformers.js runtime/);
      assert.equal(calls.length, 0, 'unknown or different runtimes cannot begin component acquisition');
    }
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
      await fs.writeFile(path.join(selectedRoot, file), file.endsWith('.onnx') ? Buffer.from([0x3a, 0]) : 'recording asset');
    }
    const receiptPath = path.join(selectedRoot, EMBEDDING_ACQUISITION_RECEIPT);
    const receipt = await publishEmbeddingAcquisitionReceipt({ root: selectedRoot, plan: loaded.plan, files });
    const readiness = embeddingsConfig => resolveModelSetupReadiness({ root, modelConfig: { id: modelId, dir: root }, embeddingsConfig });
    assert.equal(readiness({ embeddinggemma2: options }).present, true);
    await fs.writeFile(receiptPath, JSON.stringify({ ...receipt, plan: { ...loaded.plan, runtime: 'transformers.js@4.3.1' } }));
    assert.equal(readiness({ embeddinggemma2: options }).present, false, 'the former exact runtime receipt cannot authorize current assets');
    await fs.writeFile(receiptPath, JSON.stringify({ ...receipt, plan: { ...loaded.plan, dtype: 'wrong' } }));
    assert.equal(readiness({ embeddinggemma2: options }).present, false, 'wrong precision receipt is not selected readiness');
    await fs.writeFile(receiptPath, JSON.stringify({ ...receipt, plan: { ...loaded.plan, revision: 'b'.repeat(40) } }));
    assert.equal(readiness({ embeddinggemma2: options }).present, false, 'wrong revision receipt is not selected readiness');
    await fs.writeFile(receiptPath, JSON.stringify(receipt));
    await fs.rm(path.join(selectedRoot, files.at(-1)));
    assert.equal(readiness({ embeddinggemma2: options }).present, false, 'missing external weights cannot count as staged');
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('embedding acquisition plan test passed');
