import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { FeatureExtractionPipeline, env } from '@huggingface/transformers';
import { resolveEmbeddingAcquisitionPlan, assertEmbeddingAcquisitionExport } from '../../src/shared/embedding-acquisition-plan.js';
import { loadEmbeddingModelComponents, resolveEmbeddingAcquisitionRoot } from '../../src/shared/embedding-model-loading.js';
import { prefetchEmbeddingModel } from '../../src/shared/embedding-model-prefetch.js';
import { EMBEDDING_ACQUISITION_RECEIPT, readEmbeddingAcquisitionReceipt } from '../../src/shared/embedding-acquisition-receipt.js';
import { planEmbeddingArtifactInventory } from '../../src/shared/embedding-artifact-identity.js';
import { buildEmbeddingIdentity, buildEmbeddingIdentityKey } from '../../src/shared/embedding-identity.js';
import { embeddingBindingMismatches } from '../../src/shared/embedding-generation.js';
import { resolveEmbeddingModelProfile } from '../../src/shared/embedding-model-profile.js';
import { resolveModelSetupReadiness } from '../../tools/setup/model-readiness.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('instruct-e5-acquisition');
const modelId = 'intfloat/multilingual-e5-large-instruct';
const revision = 'c9e87c786ffac96aeaeb42863276930883923ecb';
// Independently transcribed upstream LFS metadata. These are metadata controls,
// not substitute bytes or a claim that the actual 2.24 GB model was qualified.
const official = [
  { path: 'onnx/model.onnx', bytes: 686499, sha256: 'e3aeea5355352d826bd952a9a96fab206c6c72d1a429c8773c9da5ac16e44af5' },
  { path: 'onnx/model.onnx_data', bytes: 2235367440, sha256: '4c13ca44e40a7ee86b461398cdee003d656e39f3fa87e1b3152fbada3e61b506' }
];
const plan = resolveEmbeddingAcquisitionPlan(modelId);
const selectedRoot = path.join(dir, 'intfloat', 'multilingual-e5-large-instruct', revision);
const environment = { ...env };
const config = Object.freeze({ model_type: 'xlm-roberta', hidden_size: 1024,
  'transformers.js_config': Object.freeze({ dtype: 'q8', unrelated: 'preserved' }) });
const makeModule = ({ abortAt = null, controller = null, failModel = null, registry = null, authorConfig = config } = {}) => {
  const calls = [], closed = [];
  const step = name => { if (name === abortAt) controller.abort(new Error(`cancelled at ${name}`)); };
  const tokenizer = Object.assign(() => ({}), { dispose() { assert.equal(this, tokenizer); closed.push('tokenizer'); } });
  const model = Object.assign(async () => ({}), { config, dispose() { assert.equal(this, model); closed.push('model'); } });
  const mod = { env: { version: '4.3.2' }, FeatureExtractionPipeline,
    AutoConfig: { from_pretrained: async (id, options) => { calls.push(['config', id, options]); step('config'); return authorConfig; } },
    AutoTokenizer: { from_pretrained: async (id, options) => { calls.push(['tokenizer', id, options]); step('tokenizer'); return tokenizer; } },
    AutoModel: { from_pretrained: async (id, options) => {
      calls.push(['model', id, options]);
      assert.equal(options.dtype, 'fp32'); assert.equal(options.device, 'cpu');
      assert.equal(options.use_external_data_format, true, 'locked upstream awaits the declared external data before native session creation');
      assert.equal(options.config['transformers.js_config'].use_external_data_format, true);
      step('model'); if (failModel) throw failModel; return model;
    } },
    ModelRegistry: { get_model_files: async (id, options) => {
      calls.push(['registry', id, options]); step('registry');
      if (registry) return registry(id, options);
      return ['config.json', 'onnx/model.onnx', 'onnx/model.onnx_data'];
    } }, pipeline: () => assert.fail('finite export must not fall back through the factory') };
  return { mod, calls, closed, tokenizer, model };
};
const metadataReceipt = (inventory, selectedPlan = plan) => {
  const ordered = inventory.toSorted((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { version: 1, plan: selectedPlan, files: ordered.map(row => row.path), inventory: ordered,
    digest: createHash('sha256').update(stableStringify({ plan: selectedPlan, inventory: ordered })).digest('hex') };
};
const readiness = () => resolveModelSetupReadiness({ root: dir, modelConfig: { id: modelId, dir }, embeddingsConfig: {} });
try {
  assert.deepEqual(plan, { version: 1, modelId, runtime: 'transformers.js@4.3.2', revision,
    dtype: 'fp32', textOnly: false, useExternalDataFormat: true, exportFiles: official });
  assert.equal(resolveEmbeddingModelProfile(modelId), null, 'E5 is not an EG2 prepared profile');
  assert.equal(resolveEmbeddingAcquisitionRoot(modelId, dir), selectedRoot);
  for (const id of ['Xenova/all-MiniLM-L12-v2', 'Xenova/multilingual-e5-large', 'Xenova/bge-m3']) {
    assert.deepEqual(resolveEmbeddingAcquisitionPlan(id), { version: 1, modelId: id, runtime: null, revision: null, dtype: 'q8', textOnly: false });
  }
  const eg2 = resolveEmbeddingModelProfile('onnx-community/embeddinggemma-2-ONNX');
  assert.equal(resolveEmbeddingAcquisitionPlan('onnx-community/embeddinggemma-2-ONNX', eg2).revision, eg2.revision);
  assert.equal(resolveEmbeddingAcquisitionPlan('onnx-community/embeddinggemma-2-ONNX', eg2).dtype, 'fp32');

  const positive = makeModule(), sessions = { intraOpNumThreads: 1, enableCpuMemArena: false };
  const loading = loadEmbeddingModelComponents(positive.mod, { modelId, modelsDir: dir, localFilesOnly: true, sessionOptions: sessions });
  sessions.intraOpNumThreads = 9;
  const acquired = await loading;
  assert.deepEqual(positive.calls.map(row => row[0]), ['config', 'tokenizer', 'model']);
  for (const [, id, options] of positive.calls) {
    assert.equal(id, modelId); assert.equal(options.revision, revision);
    assert.equal(options.cache_dir, dir); assert.equal(options.local_files_only, true);
  }
  assert.equal(acquired.pipeline.model, positive.model); assert.equal(acquired.pipeline.tokenizer, positive.tokenizer);
  assert.equal(acquired.config['transformers.js_config'].unrelated, 'preserved');
  assert.equal(config['transformers.js_config'].use_external_data_format, undefined, 'original shared config is not mutated');
  assert.deepEqual(positive.calls[2][2].session_options, { intraOpNumThreads: 1, enableCpuMemArena: false });
  positive.model.dispose = () => assert.fail('retain original component disposer');
  await acquired.pipeline.dispose(); assert.deepEqual(positive.closed, ['model', 'tokenizer']);

  for (const version of ['4.3.1', '4.3.3', undefined]) {
    const bad = makeModule(); bad.mod.env.version = version;
    await assert.rejects(loadEmbeddingModelComponents(bad.mod, { modelId, modelsDir: dir }), /qualified Transformers.js runtime/);
    assert.equal(bad.calls.length, 0);
  }
  for (const component of ['AutoTokenizer', 'AutoModel', 'FeatureExtractionPipeline']) {
    const bad = makeModule(); delete bad.mod[component];
    await assert.rejects(loadEmbeddingModelComponents(bad.mod, { modelId, modelsDir: dir }), /require AutoTokenizer/);
    assert.equal(bad.calls.length, 0, 'incomplete runtime exports reject before config acquisition');
  }
  const noRegistry = makeModule(); delete noRegistry.mod.ModelRegistry;
  await assert.rejects(prefetchEmbeddingModel(noRegistry.mod, { modelId, modelsDir: dir }), /requires the model file registry/);
  assert.equal(noRegistry.calls.length, 0, 'missing publication capability cannot initiate expensive native acquisition');
  for (const authorConfig of [{ model_type: 'bert', hidden_size: 1024 }, { model_type: 'xlm-roberta', hidden_size: 768 }]) {
    const bad = makeModule({ authorConfig });
    await assert.rejects(loadEmbeddingModelComponents(bad.mod, { modelId, modelsDir: dir }), /unexpected model configuration/);
    assert.deepEqual(bad.calls.map(row => row[0]), ['config']);
  }
  const missingData = Object.assign(new Error('missing original external data'), { code: 'ENOENT' });
  const missing = makeModule({ failModel: missingData });
  await assert.rejects(loadEmbeddingModelComponents(missing.mod, { modelId, modelsDir: dir, localFilesOnly: true }), error => error === missingData);
  assert.deepEqual(missing.closed, ['tokenizer']); assert.equal(missing.calls.filter(row => row[0] === 'model').length, 1, 'no alternative graph, namespace or precision retry');

  for (const abortAt of ['config', 'tokenizer', 'model', 'registry']) {
    const controller = new AbortController(), cancelled = makeModule({ controller, abortAt });
    await assert.rejects(prefetchEmbeddingModel(cancelled.mod, { modelId, modelsDir: dir, signal: controller.signal }), { name: 'AbortError' });
    assert.deepEqual(cancelled.closed, abortAt === 'config' ? [] : abortAt === 'tokenizer' ? ['tokenizer'] : ['model', 'tokenizer']);
    if (abortAt !== 'registry') assert(!cancelled.calls.some(row => row[0] === 'registry'));
  }

  await fs.mkdir(selectedRoot, { recursive: true });
  const tokenizers = [];
  for (const file of ['config.json', 'tokenizer.json', 'tokenizer_config.json']) {
    const bytes = Buffer.from('{}'); await fs.writeFile(path.join(selectedRoot, file), bytes);
    tokenizers.push({ path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const receiptPath = path.join(selectedRoot, EMBEDDING_ACQUISITION_RECEIPT);
  const writeMetadata = async (inventory, recipe = plan) => fs.writeFile(receiptPath, JSON.stringify(metadataReceipt(inventory, recipe)));
  const inventory = [...tokenizers, ...official];
  assert.doesNotThrow(() => assertEmbeddingAcquisitionExport(plan, inventory));
  await writeMetadata(inventory);
  assert.deepEqual(readEmbeddingAcquisitionReceipt(selectedRoot, plan).plan, plan);
  assert.equal(readiness().present, false, 'metadata alone cannot stand in for absent actual graph/external bytes');
  const selected = planEmbeddingArtifactInventory({ provider: 'xenova', modelId, modelsDir: dir });
  assert.equal(selected.revision, revision);
  assert(selected.files.every(row => row.filePath.startsWith(selectedRoot + path.sep)));
  assert.deepEqual(selected.files.filter(row => row.rel.startsWith('onnx/')).map(row => row.rel), official.map(row => row.path));
  for (const invalidInventory of [inventory.filter(row => row.path !== 'onnx/model.onnx_data'),
    inventory.map(row => row.path === 'onnx/model.onnx' ? { ...row, sha256: 'f'.repeat(64) } : row),
    [...inventory, { path: 'onnx/model_quantized.onnx', bytes: 2, sha256: 'a'.repeat(64) }]]) {
    await writeMetadata(invalidInventory);
    assert.throws(() => readEmbeddingAcquisitionReceipt(selectedRoot, plan), { code: 'ERR_EMBEDDING_ACQUISITION' },
      'internally consistent receipt digests cannot authorize a different qualified closure');
  }
  await writeMetadata(inventory, { version: 1, modelId, runtime: null, revision: null, dtype: 'q8', textOnly: false });
  assert.throws(() => readEmbeddingAcquisitionReceipt(selectedRoot, plan), { code: 'ERR_EMBEDDING_ACQUISITION' });
  await fs.rm(receiptPath);
  const legacy = path.join(dir, modelId, 'onnx'); await fs.mkdir(legacy, { recursive: true });
  await fs.writeFile(path.join(legacy, 'model_quantized.onnx'), Buffer.from([0x3a, 0]));
  assert.equal(readiness().present, false, 'legacy q8 or unpinned files cannot replace the selected receipt');

  const wrongRegistry = makeModule({ registry: () => ['config.json', 'onnx/model_quantized.onnx'] });
  await assert.rejects(prefetchEmbeddingModel(wrongRegistry.mod, { modelId, modelsDir: dir }), /registry disagrees/);
  assert.equal(wrongRegistry.calls[3][2].config['transformers.js_config'].use_external_data_format, true);
  assert.equal(wrongRegistry.calls[3][2].dtype, 'fp32'); assert.equal(wrongRegistry.calls[3][2].device, 'cpu');
  assert.deepEqual(wrongRegistry.closed, ['model', 'tokenizer']);
  const registryFailure = Object.freeze(new Error('original registry failure'));
  const failed = makeModule({ registry: () => { throw registryFailure; } });
  await assert.rejects(prefetchEmbeddingModel(failed.mod, { modelId, modelsDir: dir }), error => error === registryFailure);
  assert.deepEqual(failed.closed, ['model', 'tokenizer']);

  // A complete but substituted graph/data pair must not publish a new receipt.
  // These tiny protobuf bytes describe one four-byte external tensor; they are
  // intentionally unrelated to the author's graph, not a miniature real model.
  const field = (number, bytes) => { const value = Buffer.from(bytes); return Buffer.concat([Buffer.from([number * 8 + 2, value.length]), value]); };
  const entry = (key, value) => field(13, Buffer.concat([field(1, key), field(2, value)]));
  const substituted = field(7, field(5, Buffer.concat([entry('location', 'model.onnx_data'), entry('length', '4'), Buffer.from([112, 1])])));
  await fs.mkdir(path.join(selectedRoot, 'onnx'), { recursive: true });
  await fs.writeFile(path.join(selectedRoot, 'onnx/model.onnx'), substituted);
  await fs.writeFile(path.join(selectedRoot, 'onnx/model.onnx_data'), Buffer.alloc(4));
  await writeMetadata(inventory); const priorReceipt = await fs.readFile(receiptPath);
  const substitute = makeModule(), originalOpen = fs.open;
  try {
    fs.open = async (file, ...args) => {
      if (String(file).startsWith(path.join(selectedRoot, 'onnx') + path.sep)) {
        assert.deepEqual(substitute.closed, ['model', 'tokenizer'], 'original temporary resources close before closure verification');
      }
      return originalOpen(file, ...args);
    };
    await assert.rejects(prefetchEmbeddingModel(substitute.mod, { modelId, modelsDir: dir }), { code: 'ERR_EMBEDDING_ACQUISITION' });
  } finally { fs.open = originalOpen; }
  assert.deepEqual(await fs.readFile(receiptPath), priorReceipt, 'substituted bytes cannot replace the original receipt');
  assert.equal(readiness().present, false, 'selected graph/data byte lengths still fail presence admission');

  // Relocated ONNX graphs use the same pinned tokenizer root, while explicit
  // graph bytes keep their independent installation identity.
  const relocated = path.join(dir, 'relocated/model.onnx');
  await fs.mkdir(path.dirname(relocated), { recursive: true }); await fs.writeFile(relocated, Buffer.from([0x3a, 0]));
  const direct = planEmbeddingArtifactInventory({ provider: 'onnx', modelId, modelsDir: dir,
    rootDir: dir, onnx: { modelPath: relocated } });
  assert(direct.hasWeights && direct.hasTokenizer);
  assert(direct.files.filter(row => row.rel.startsWith('tokenizer/')).every(row => row.filePath.startsWith(selectedRoot + path.sep)));

  const current = buildEmbeddingIdentity({ modelId, provider: 'xenova', dims: 1024 });
  const prior = structuredClone(current); delete prior.acquisition;
  assert.notEqual(buildEmbeddingIdentityKey(current), buildEmbeddingIdentityKey(prior));
  assert(embeddingBindingMismatches({ embeddingIdentity: prior }, { embeddingIdentity: current }).includes('acquisition'));
  assert.equal(current.inputFormatting.queryPrefix,
    'Instruct: Given a code search query, retrieve relevant source code or documentation passages that answer the query\nQuery: ');
  assert.equal(current.inputFormatting.passagePrefix, null); assert.equal(current.pooling, 'mean');
  assert.equal(buildEmbeddingIdentity({ modelId: 'Xenova/multilingual-e5-large', provider: 'xenova' }).acquisition, undefined);
  const onnx = buildEmbeddingIdentity({ modelId, provider: 'onnx' });
  assert.deepEqual(onnx.tokenizerAcquisition, { modelId, revision });
  assert.equal(onnx.acquisition, undefined, 'explicit ONNX weights retain their independently verified installation authority');
  assert.deepEqual({ ...env }, environment);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Instruction E5 pinned acquisition and metadata controls passed; no real-model numerical acceptance implied.');
