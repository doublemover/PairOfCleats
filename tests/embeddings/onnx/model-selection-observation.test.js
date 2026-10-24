import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveOnnxModelPath, statSize } from '../../../src/shared/onnx-embeddings/config.js';
import { readOnnxInstallationReceipt, onnxSelectionPath, ONNX_INSTALLATION_RECEIPT } from '../../../src/shared/onnx-installation.js';
import { planEmbeddingArtifactInventory } from '../../../src/shared/embedding-artifact-identity.js';
import { EMBEDDING_ACQUISITION_RECEIPT } from '../../../src/shared/embedding-acquisition-receipt.js';
import { resolveEmbeddingModelProfile } from '../../../src/shared/embedding-model-profile.js';
import { resolveModelSetupReadiness } from '../../../tools/setup/model-readiness.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('onnx-model-selection-observation');
const modelId = 'fixture/model', root = path.join(dir, modelId), first = path.join(root, 'onnx/model.onnx'), second = path.join(root, 'onnx/model_quantized.onnx');
fs.mkdirSync(path.dirname(first), { recursive: true }); fs.writeFileSync(first, 'first graph'); fs.writeFileSync(second, 'second graph');
fs.writeFileSync(path.join(root, 'tokenizer.json'), '{}'); fs.writeFileSync(path.join(root, 'tokenizer_config.json'), '{}');
const originals = Object.fromEntries(['statSync', 'accessSync', 'lstatSync', 'openSync'].map(name => [name, fs[name]]));
const options = { modelsDir: dir, modelId, rootDir: dir };
const fault = () => {
  let settled = false, substitute = false;
  const original = new Error('controlled callback-only pending model path observation');
  Object.defineProperties(original, { code: { value: 'ENOENT' }, cacheOwnershipPending: { value: false },
    cacheOwnershipReleased: { get() { return substitute ? () => true : function () { assert.equal(this, original); return settled; }; } } });
  Object.freeze(original);
  return { original, substitute: () => { substitute = true; }, settle: () => { settled = true; } };
};
const assertRetained = (invoke, control) => {
  let captured;
  assert.throws(invoke, error => { captured = error; return true; });
  assert.equal(typeof captured.cacheOwnershipReleased, 'function');
  assert.equal(captured.cacheOwnershipReleased(), false); control.substitute();
  assert.equal(captured.cacheOwnershipReleased(), false, 'later replacement observation cannot authorize fallback');
  control.settle(); assert.equal(captured.cacheOwnershipReleased(), true);
};
try {
  for (const [method, selected, invoke] of [
    ['statSync', first, () => resolveOnnxModelPath(options)],
    ['statSync', first, () => resolveOnnxModelPath({ ...options, modelPath: root })],
    ['accessSync', first, () => resolveOnnxModelPath({ ...options, modelPath: first })],
    ['lstatSync', onnxSelectionPath(first), () => resolveOnnxModelPath(options)],
    ['statSync', first, () => statSize(first)],
    ['accessSync', first, () => resolveModelSetupReadiness({ root: dir, modelConfig: { id: modelId, dir }, embeddingsConfig: { provider: 'onnx' } })]
  ]) {
    const control = fault(); let alternateReads = 0;
    fs.statSync = (file, ...args) => { if (String(file) === second) alternateReads++; return originals.statSync(file, ...args); };
    const original = fs[method];
    fs[method] = (file, ...args) => { if (String(file) === selected) throw control.original; return original(file, ...args); };
    assertRetained(invoke, control); assert.equal(alternateReads, 0, 'pending candidate cannot authorize a later graph');
    Object.assign(fs, originals);
  }
  const receipt = path.join(path.dirname(first), ONNX_INSTALLATION_RECEIPT); fs.writeFileSync(receipt, '{}');
  const receiptFault = fault(); fs.openSync = (file, ...args) => {
    if (String(file) === receipt) throw receiptFault.original;
    return originals.openSync(file, ...args);
  };
  assertRetained(() => readOnnxInstallationReceipt(path.dirname(first)), receiptFault); Object.assign(fs, originals);
  fs.rmSync(receipt);

  const profileId = 'onnx-community/embeddinggemma-2-ONNX', profile = resolveEmbeddingModelProfile(profileId);
  const profileRoot = path.join(dir, profileId, profile.revision), profileReceipt = path.join(profileRoot, EMBEDDING_ACQUISITION_RECEIPT);
  fs.mkdirSync(profileRoot, { recursive: true }); fs.writeFileSync(profileReceipt, '{}');
  const profileFault = fault(); fs.openSync = (file, ...args) => {
    if (String(file) === profileReceipt) throw profileFault.original;
    return originals.openSync(file, ...args);
  };
  assertRetained(() => planEmbeddingArtifactInventory({ provider: 'xenova', modelId: profileId, modelsDir: dir, modelProfile: profile }), profileFault);
  Object.assign(fs, originals);

  fs.statSync = (file, ...args) => {
    if (String(file) === first) throw Object.assign(new Error('settled missing candidate'), { code: 'ENOENT', cacheOwnershipReleased: () => true });
    return originals.statSync(file, ...args);
  };
  assert.equal(resolveOnnxModelPath(options), second, 'confirmed missing first candidate keeps ordinary fallback'); Object.assign(fs, originals);
  fs.rmSync(first); assert.equal(resolveOnnxModelPath(options), second);
} finally { Object.assign(fs, originals); fs.rmSync(dir, { recursive: true, force: true }); }
console.log('Canonical model selection, readiness, size and receipt callback-only ownership controls authored; execution deferred.');
