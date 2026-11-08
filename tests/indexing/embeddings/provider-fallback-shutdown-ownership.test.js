import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { createEmbeddingProviderAdapter } from '../../../src/shared/embedding-provider-adapters.js';
import { normalizeEmbeddingProvider } from '../../../src/shared/onnx-embeddings/config.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('provider-fallback-shutdown-ownership');
const modelPath = path.join(dir, 'selected.onnx'), modelId = 'fixture/fallback';
const primary = Object.freeze(Object.assign(new Error('controlled native run unavailable'), { code: 'ERR_DLOPEN_FAILED' }));
const nativeCleanup = Object.freeze(new Error('controlled native session release failure'));
const fallbackCleanup = Object.freeze(new Error('controlled fallback pipeline release failure'));
const adapters = [], controls = [];
let selected;
globalThis.__fallbackShutdownOwnership = {
  Tensor: class { constructor(type, data, dims) { Object.assign(this, { type, data, dims }); } dispose() {} },
  AutoTokenizer: { from_pretrained: async () => texts => ({ input_ids: texts.map(() => [1]), attention_mask: texts.map(() => [1]) }) },
  InferenceSession: { create: async () => {
    const control = selected;
    return { inputNames: ['input_ids', 'attention_mask'], run: async () => { control.nativeRuns++; throw primary; },
      release() { control.nativeCloses++; if (control.nativeCloses === 1) throw nativeCleanup; } };
  } }
};
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (['onnxruntime-node', '@huggingface/transformers'].includes(specifier)) return { url: `fallback-shutdown:${specifier}`, shortCircuit: true };
  return next(specifier, context);
}, load(url, context, next) {
  if (url.startsWith('fallback-shutdown:')) return { format: 'module', shortCircuit: true,
    source: 'export const { Tensor, AutoTokenizer, InferenceSession } = globalThis.__fallbackShutdownOwnership;' };
  return next(url, context);
} });
const contains = (error, target, seen = new Set()) => {
  if (error === target) return true;
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error); return contains(error.cause, target, seen) || Array.isArray(error.errors) && error.errors.some(value => contains(value, target, seen));
};
try {
  await fs.writeFile(modelPath, 'inert selected native graph'); await fs.mkdir(path.join(dir, modelId), { recursive: true });
  await fs.writeFile(path.join(dir, modelId, 'tokenizer.json'), '{}');
  for (const failFallback of [false, true]) {
    let entered, release;
    const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const control = { nativeRuns: 0, nativeCloses: 0, fallbackCloses: 0, release }; controls.push(control); selected = control;
    const adapter = createEmbeddingProviderAdapter({ provider: 'onnx', modelId, modelsDir: dir, rootDir: dir,
      onnxConfig: { modelPath }, normalizeEmbeddingProvider,
      modelArtifact: { status: 'unknown', reuse: 'refuse', digest: null, revision: null, attempt: String(failFallback) },
      loadPipeline: async () => Object.assign(async texts => { assert.deepEqual(texts, ['selected original text']); entered(); await gate; return [[3, 4]]; }, {
        dispose() { control.fallbackCloses++; if (failFallback && control.fallbackCloses === 1) throw fallbackCleanup; }
      }) }); adapters.push(adapter);
    const texts = ['selected original text'], accepted = adapter.embed(texts); texts[0] = 'later caller mutation';
    await started; assert.equal(adapter.provider, 'xenova');
    await adapter.prewarm({ tokenizer: true, model: false });
    assert.equal(control.nativeRuns, 1, 'active fallback prewarm cannot retry the retired native execution path');
    const close = adapter.dispose(); close.catch(() => {}); await new Promise(resolve => setImmediate(resolve));
    assert.equal(control.nativeCloses, 0); assert.equal(control.fallbackCloses, 0, 'accepted fallback inference retains both children during shutdown');
    await assert.rejects(adapter.embed(['after shutdown']), /disposed/);
    release(); assert.deepEqual((await accepted).map(row => Array.from(row)), [[3, 4]]);
    const failure = await close.then(() => assert.fail('native cleanup must reject'), error => error);
    assert(contains(failure, nativeCleanup)); assert.equal(control.nativeCloses, 1); assert.equal(control.fallbackCloses, 1);
    if (failFallback) assert(contains(failure, fallbackCleanup));
    await adapter.dispose(); assert.equal(control.nativeCloses, 2); assert.equal(control.fallbackCloses, failFallback ? 2 : 1);
  }
} finally {
  for (const control of controls) control.release();
  await Promise.allSettled(adapters.map(adapter => adapter.dispose())); hooks.deregister(); delete globalThis.__fallbackShutdownOwnership;
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Actual ONNX fallback accepted-work drain, independent child cleanup, exact retries and closed admission authored; execution deferred.');
