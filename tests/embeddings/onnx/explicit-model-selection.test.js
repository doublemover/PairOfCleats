import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeOnnxConfig, resolveOnnxModelPath } from '../../../src/shared/onnx-embeddings/config.js';
import { resolveModelSetupReadiness } from '../../../tools/setup/model-readiness.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-onnx-selection-'));
const modelsDir = path.join(root, 'models');
const cached = path.join(modelsDir, 'fixture/model/onnx/model.onnx');
const selected = path.join(root, 'selected/custom.onnx');
try {
  fs.mkdirSync(path.dirname(cached), { recursive: true });
  fs.mkdirSync(path.dirname(selected), { recursive: true });
  fs.writeFileSync(cached, 'cached graph');
  const options = { rootDir: root, modelsDir, modelId: 'fixture/model' };
  assert.equal(resolveOnnxModelPath(options), cached);
  for (const modelPath of ['selected/missing.onnx', path.join(root, 'absolute-missing.onnx')]) {
    assert.throws(() => resolveOnnxModelPath({ ...options, modelPath }), error =>
      error.code === 'ERR_EMBEDDING_MODEL_PATH' && error.message.includes(path.resolve(root, modelPath)));
  }
  fs.mkdirSync(selected);
  fs.writeFileSync(path.join(selected, 'model.onnx'), 'nested cached graph must not replace selected graph');
  assert.throws(() => resolveOnnxModelPath({ ...options, modelPath: selected }), { code: 'ERR_EMBEDDING_MODEL_PATH' });
  for (const modelPath of [true, 12, {}, '   ']) {
    assert.throws(() => resolveOnnxModelPath({ ...options, modelPath }), { code: 'ERR_EMBEDDING_MODEL_PATH' });
    assert.throws(() => normalizeOnnxConfig({ modelPath }), { code: 'ERR_EMBEDDING_MODEL_PATH' });
  }
  fs.rmSync(selected, { recursive: true });
  fs.writeFileSync(selected, '');
  assert.throws(() => resolveOnnxModelPath({ ...options, modelPath: selected }), { code: 'ERR_EMBEDDING_MODEL_PATH' });
  fs.writeFileSync(selected, 'selected graph');
  assert.equal(resolveOnnxModelPath({ ...options, modelPath: 'selected/custom.onnx' }), selected);
  const originalAccess = fs.accessSync;
  fs.accessSync = file => {
    if (file === selected) throw Object.assign(new Error('controlled read denial'), { code: 'EACCES' });
    return originalAccess(file);
  };
  try {
    assert.throws(() => resolveOnnxModelPath({ ...options, modelPath: selected }), error =>
      error.code === 'ERR_EMBEDDING_MODEL_PATH' && error.cause.code === 'EACCES');
  } finally { fs.accessSync = originalAccess; }
  const readiness = resolveModelSetupReadiness({ root, modelConfig: { id: 'fixture/model', dir: modelsDir },
    embeddingsConfig: { provider: 'onnx', onnx: { modelPath: 'selected/missing.onnx' } } });
  assert.equal(readiness.present, false);
  assert.equal(readiness.modelPath, null);
  assert.match(readiness.reason, /selected.*missing\.onnx/i);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('explicit ONNX model selection test passed');
