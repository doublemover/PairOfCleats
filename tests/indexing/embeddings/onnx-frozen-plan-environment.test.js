#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { Tensor } from 'onnxruntime-common';
import { createEmbeddingExecutionPlan, attachEmbeddingExecutionPlan } from '../../../src/shared/embedding-execution-plan.js';
import { getEmbeddingAdapter } from '../../../src/shared/embedding-adapter.js';
import { parseBuildEmbeddingsArgs } from '../../../tools/build/embeddings/cli.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const { dir } = await prepareIsolatedTestCacheDir('onnx-frozen-plan-environment');
const modelPath = path.join(dir, 'model.onnx');
await fs.writeFile(modelPath, 'mock weights; no native session');
let observedOptions;
globalThis.__onnxPlanFixture = { Tensor, env: {}, AutoTokenizer: { from_pretrained: async () => texts => ({
  input_ids: texts.map(() => [101]), attention_mask: texts.map(() => [1])
}) }, InferenceSession: { create: async (_filename, options) => {
  observedOptions = options;
  return { inputNames: ['input_ids', 'attention_mask'], release: async () => {},
    run: async () => ({ sentence_embedding: new Tensor('float32', new Float32Array([1, 2]), [1, 2]) }) };
} } };
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (['onnxruntime-node', '@huggingface/transformers'].includes(specifier)) return { url: `plan-fixture:${specifier}`, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('plan-fixture:')) return { format: 'module', shortCircuit: true,
      source: 'export const { Tensor, env, AutoTokenizer, InferenceSession } = globalThis.__onnxPlanFixture;' };
    return next(url, context);
  }
});
try {
  const rawEnv = { PAIROFCLEATS_ONNX_CPU_EP_TUNING: '1', PAIROFCLEATS_ONNX_TOKENIZATION_CACHE: '0',
    PAIROFCLEATS_ONNX_TOKENIZATION_CACHE_MAX: '17', PAIROFCLEATS_ONNX_PREWARM_TOKENIZER: '1',
    PAIROFCLEATS_ONNX_PREWARM_MODEL: '0', PAIROFCLEATS_ONNX_PREWARM_TEXTS: 'private submission text' };
  await withTemporaryEnv({ PAIROFCLEATS_ONNX_CPU_EP_TUNING: '0' }, async () => {
    const plan = createEmbeddingExecutionPlan({ root: dir, indexRoot: dir, modes: ['code'], rawEnv,
      userConfig: { indexing: { embeddings: { provider: 'onnx', onnx: { modelPath } } } } });
    assert.equal(plan.version, 2);
    assert.equal(plan.embeddings.onnx.cpuExecutionProviderTuning, true, 'supplied rawEnv wins over the parent ambient environment');
    assert.equal(JSON.stringify(plan).includes('private submission text'), false);
    const executionEnv = attachEmbeddingExecutionPlan({ ...process.env, PAIROFCLEATS_ONNX_CPU_EP_TUNING: '0',
      PAIROFCLEATS_ONNX_TOKENIZATION_CACHE: '1', PAIROFCLEATS_ONNX_TOKENIZATION_CACHE_MAX: '1',
      PAIROFCLEATS_ONNX_PREWARM_TOKENIZER: '0', PAIROFCLEATS_ONNX_PREWARM_MODEL: '1' }, plan);
    await withTemporaryEnv(executionEnv, async () => {
      const parsed = parseBuildEmbeddingsArgs(['--repo', dir, '--index-root', dir, '--mode', 'code', '--progress', 'off']);
      assert.equal(parsed.embeddingOnnx.cpuExecutionProviderTuning, true);
      assert.equal(parsed.embeddingOnnx.tokenizationCacheEnabled, false);
      assert.equal(parsed.embeddingOnnx.tokenizationCacheMaxEntries, 17);
      assert.equal(parsed.embeddingOnnx.prewarmTokenizer, true);
      assert.equal(parsed.embeddingOnnx.prewarmModel, false);
      const adapter = getEmbeddingAdapter({ provider: parsed.embeddingProvider, modelId: parsed.modelId,
        modelsDir: parsed.modelsDir, rootDir: dir, onnxConfig: parsed.embeddingOnnx, normalize: true });
      try {
        await adapter.embed(['example']);
        assert.equal(observedOptions.intraOpNumThreads, 1);
        assert.equal(observedOptions.interOpNumThreads, 1);
        assert.equal(observedOptions.enableCpuMemArena, false);
        assert.equal(observedOptions.executionMode, 'sequential');
      } finally { await adapter.dispose(); }
    });
  });
} finally {
  hooks.deregister(); delete globalThis.__onnxPlanFixture;
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Actual plan/parser/adapter/session consumes one frozen ONNX configuration independent of ambient drift.');
