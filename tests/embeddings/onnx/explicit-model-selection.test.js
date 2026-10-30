import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeOnnxConfig, resolveOnnxModelPath } from '../../../src/shared/onnx-embeddings/config.js';
import { resolveModelSetupReadiness } from '../../../tools/setup/model-readiness.js';
import { createOnnxEmbedder } from '../../../src/shared/onnx-embeddings.js';
import { InferenceSession } from 'onnxruntime-node';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-onnx-selection-'));
const modelsDir = path.join(root, 'models');
const cached = path.join(modelsDir, 'fixture/model/onnx/model.onnx');
const selected = path.join(root, 'selected/custom.onnx');
const createSession = InferenceSession.create; let sessionCalls = 0;
InferenceSession.create = async (...args) => { sessionCalls++; return createSession.apply(InferenceSession, args); };
try {
  fs.mkdirSync(path.dirname(cached), { recursive: true });
  fs.mkdirSync(path.dirname(selected), { recursive: true });
  fs.writeFileSync(cached, 'cached graph');
  const options = { rootDir: root, modelsDir, modelId: 'fixture/model' };
  assert.equal(resolveOnnxModelPath(options), cached);
  for (const modelPath of ['selected/missing.onnx', path.join(root, 'absolute-missing.onnx')]) {
    assert.throws(() => resolveOnnxModelPath({ ...options, modelPath }), error =>
      error.code === 'ERR_EMBEDDING_MODEL_PATH' && error.message.includes(path.resolve(root, modelPath)));
    assert.throws(() => createOnnxEmbedder({ ...options, onnxConfig: { modelPath }, dims: 2 }),
      { code: 'ERR_EMBEDDING_MODEL_PATH' }, 'actual runtime selection rejects before lazy session or tokenizer admission');
    assert.equal(sessionCalls, 0);
  }
  fs.mkdirSync(selected);
  fs.writeFileSync(path.join(selected, 'model.onnx'), 'nested cached graph must not replace selected graph');
  assert.throws(() => resolveOnnxModelPath({ ...options, modelPath: selected }), { code: 'ERR_EMBEDDING_MODEL_PATH' });
  assert.throws(() => createOnnxEmbedder({ ...options, onnxConfig: { modelPath: selected }, dims: 2 }), { code: 'ERR_EMBEDDING_MODEL_PATH' });
  for (const modelPath of [true, 12, {}, '   ']) {
    assert.throws(() => resolveOnnxModelPath({ ...options, modelPath }), { code: 'ERR_EMBEDDING_MODEL_PATH' });
    assert.throws(() => normalizeOnnxConfig({ modelPath }), { code: 'ERR_EMBEDDING_MODEL_PATH' });
  }
  fs.rmSync(selected, { recursive: true });
  fs.writeFileSync(selected, '');
  assert.throws(() => resolveOnnxModelPath({ ...options, modelPath: selected }), { code: 'ERR_EMBEDDING_MODEL_PATH' });
  assert.throws(() => createOnnxEmbedder({ ...options, onnxConfig: { modelPath: selected }, dims: 2 }), { code: 'ERR_EMBEDDING_MODEL_PATH' });
  fs.writeFileSync(selected, 'selected graph');
  assert.equal(resolveOnnxModelPath({ ...options, modelPath: 'selected/custom.onnx' }), selected);
  const unused = createOnnxEmbedder({ ...options, onnxConfig: { modelPath: 'selected/custom.onnx' }, dims: 2 });
  assert.equal(sessionCalls, 0, 'a valid selected graph retains lazy admission'); await unused.dispose();
  const originalAccess = fs.accessSync;
  fs.accessSync = file => {
    if (file === selected) throw Object.assign(new Error('controlled read denial'), { code: 'EACCES' });
    return originalAccess(file);
  };
  try {
    assert.throws(() => resolveOnnxModelPath({ ...options, modelPath: selected }), error =>
      error.code === 'ERR_EMBEDDING_MODEL_PATH' && error.cause.code === 'EACCES');
    assert.throws(() => createOnnxEmbedder({ ...options, onnxConfig: { modelPath: selected }, dims: 2 }), error =>
      error.code === 'ERR_EMBEDDING_MODEL_PATH' && error.cause.code === 'EACCES');
  } finally { fs.accessSync = originalAccess; }
  const readiness = resolveModelSetupReadiness({ root, modelConfig: { id: 'fixture/model', dir: modelsDir },
    embeddingsConfig: { provider: 'onnx', onnx: { modelPath: 'selected/missing.onnx' } } });
  assert.equal(readiness.present, false);
  assert.equal(readiness.modelPath, null);
  assert.match(readiness.reason, /selected.*missing\.onnx/i);
  assert.equal(sessionCalls, 0);
} finally { InferenceSession.create = createSession; fs.rmSync(root, { recursive: true, force: true }); }
console.log('explicit ONNX model selection test passed');
