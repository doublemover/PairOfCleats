import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { createOnnxEmbedder } from '../../../src/shared/onnx-embeddings.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

// Actual provider and deferred adapter with inert dependency modules. Unrun.
const { dir } = await prepareIsolatedTestCacheDir('onnx-actual-adapter-cleanup-owner');
const cleanup = Object.freeze(Object.assign(new Error('controlled frozen native release failure'), { code: 'EIO' }));
let refuse = true, releases = 0, tokenizerReleases = 0, creates = 0;
const session = { inputNames: [], release: async () => { releases++; if (refuse) throw cleanup; } };
const tokenizer = Object.assign(() => ({ input_ids: [[]], attention_mask: [[]] }), {
  dispose: async () => { tokenizerReleases++; }
});
globalThis.__onnxCleanupOwnerFixture = { env: {}, AutoTokenizer: { from_pretrained: async () => tokenizer },
  InferenceSession: { create: async () => { creates++; return session; } }, Tensor: class {} };
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (['onnxruntime-node', '@huggingface/transformers'].includes(specifier)) {
      return { url: `cleanup-owner:${specifier}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('cleanup-owner:')) return { format: 'module', shortCircuit: true,
      source: 'export const { env, AutoTokenizer, InferenceSession, Tensor } = globalThis.__onnxCleanupOwnerFixture;' };
    return next(url, context);
  }
});
let adapter, pending, startupAdapter, startupPending;
try {
  const modelPath = path.join(dir, 'model.onnx'), modelId = 'controlled-local-tokenizer';
  await fs.writeFile(modelPath, 'inert graph bytes; never native');
  await fs.mkdir(path.join(dir, modelId));
  await fs.writeFile(path.join(dir, modelId, 'tokenizer.json'), '{}');
  adapter = createOnnxEmbedder({ rootDir: dir, modelsDir: dir, modelId, onnxConfig: { modelPath } });
  const loaded = await adapter.embedderPromise;
  assert.equal(loaded.session, session);
  session.release = () => { assert.fail('cleanup uses the captured native method'); };
  pending = await adapter.dispose().then(() => assert.fail('failed native release must reject disposal'), error => error);
  assert.equal(pending.cause, cleanup); assert.equal(pending.message, cleanup.message);
  assert.equal(pending.cacheOwnershipPending, true); assert.equal(pending.onnxResourceOwner, loaded.resourceOwner);
  assert.equal(pending.onnxSessionOwner.session, session);
  assert.equal(cleanup.cacheOwnershipPending, undefined);
  assert.equal(releases, 1); assert.equal(tokenizerReleases, 1);
  refuse = false;
  await pending.onnxResourceOwner.release();
  assert.equal(pending.cacheOwnershipReleased(), true); assert.equal(pending.cacheOwnershipPending, false);
  assert.equal(releases, 2); assert.equal(tokenizerReleases, 1); assert.equal(creates, 1);
  await assert.rejects(adapter.getEmbeddings(['after disposal']), /disposed/);

  const startupPrimary = Object.freeze(Object.assign(new Error('frozen native initialization failure'), { code: 'EINIT' }));
  let refuseTokenizer = true;
  const startupTokenizer = Object.assign(() => ({}), { dispose: async () => {
    if (refuseTokenizer) throw cleanup;
  } });
  globalThis.__onnxCleanupOwnerFixture.AutoTokenizer.from_pretrained = async () => startupTokenizer;
  globalThis.__onnxCleanupOwnerFixture.InferenceSession.create = async () => { throw startupPrimary; };
  const startupPath = path.join(dir, 'startup-failure.onnx');
  await fs.writeFile(startupPath, 'different inert graph');
  startupAdapter = createOnnxEmbedder({ rootDir: dir, modelsDir: dir, modelId, onnxConfig: { modelPath: startupPath } });
  startupPending = await startupAdapter.embedderPromise.then(() => assert.fail('startup must reject'), error => error);
  assert.equal(startupPending.cause, startupPrimary); assert.ok(startupPending.errors.includes(cleanup));
  assert.equal(startupPending.onnxSessionOwner.tokenizer, startupTokenizer);
  await assert.rejects(startupAdapter.dispose(), error => error === startupPending,
    'actual deferred startup disposal preserves the exact initialization cleanup capability');
  refuseTokenizer = false;
  await startupPending.onnxResourceOwner.release();
  assert.equal(startupPending.cacheOwnershipReleased(), true);
} finally {
  refuse = false;
  await pending?.onnxResourceOwner?.release();
  await startupPending?.onnxResourceOwner?.release();
  await adapter?.dispose().catch(() => {});
  await startupAdapter?.dispose().catch(() => {});
  hooks.deregister(); delete globalThis.__onnxCleanupOwnerFixture;
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Actual ONNX deferred adapter retains exact frozen native cleanup ownership');
