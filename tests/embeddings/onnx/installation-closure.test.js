import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InferenceSession } from 'onnxruntime-node';
import { encodeField as field } from '../../../tools/history/eg2-qualify-graph.js';
import { installOnnxArtifactClosure } from '../../../src/shared/onnx-model-install.js';
import { resolveOnnxModelPath } from '../../../src/shared/onnx-embeddings/config.js';
import { onnxSelectionPath } from '../../../src/shared/onnx-installation.js';
import { planOnnxArtifactClosure } from '../../../src/shared/onnx-artifact-closure.js';
const message = (...fields) => Buffer.concat(fields);
const text = (number, value) => field(number, 2, value);
const entry = (key, value) => text(13, message(text(1, key), text(2, value)));
const graphBytes = location => {
  const tensor = message(field(1, 0, 1), field(2, 0, 1), text(8, 'W'),
    entry('location', location), entry('offset', '0'), entry('length', '4'), field(14, 0, 1));
  const shape = text(2, text(1, field(1, 0, 1)));
  const output = message(text(1, 'Y'), text(2, text(1, message(field(1, 0, 1), shape))));
  const graph = message(text(1, message(text(1, 'W'), text(2, 'Y'), text(4, 'Identity'))),
    text(2, 'fixture'), text(5, tensor), text(12, output));
  return message(field(1, 0, 8), text(7, graph), text(8, field(2, 0, 13)));
};
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-onnx-install-'));
try {
  const source = path.join(root, 'source'), target = path.join(root, 'target/renamed.onnx');
  await fs.mkdir(path.join(source, 'arbitrary nested'), { recursive: true });
  const graph = path.join(source, 'model.onnx'), sidecar = path.join(source, 'arbitrary nested/weights.custom');
  await fs.writeFile(graph, graphBytes('arbitrary nested/weights.custom'));
  await fs.writeFile(sidecar, Buffer.from(new Float32Array([1]).buffer));
  await fs.mkdir(path.dirname(target));
  await fs.writeFile(target, 'interrupted partial legacy graph');
  const installed = await installOnnxArtifactClosure({ sourceGraph: graph, targetGraph: target });
  assert.equal(installed.unchanged, false);
  assert.equal(resolveOnnxModelPath({ modelPath: target }), installed.graphPath);
  assert.equal(await fs.readFile(target, 'utf8'), 'interrupted partial legacy graph', 'repair does not overwrite an active legacy path');
  const session = await InferenceSession.create(installed.graphPath);
  try { assert.equal((await session.run({})).Y.data[0], 1); } finally { await session.release(); }
  assert.equal((await installOnnxArtifactClosure({ sourceGraph: graph, targetGraph: target })).unchanged, true);
  const selectedBefore = await fs.readFile(onnxSelectionPath(target), 'utf8');
  await fs.writeFile(sidecar, Buffer.from(new Float32Array([2]).buffer));
  await assert.rejects(installOnnxArtifactClosure({ sourceGraph: graph, targetGraph: target,
    hooks: { afterAsset: () => { throw new Error('controlled interrupted asset staging'); } } }), /controlled/);
  assert.equal(await fs.readFile(onnxSelectionPath(target), 'utf8'), selectedBefore);
  await assert.rejects(installOnnxArtifactClosure({ sourceGraph: graph, targetGraph: target,
    hooks: { beforeSelection: () => { throw new Error('controlled publication interruption'); } } }), /controlled/);
  assert.equal(await fs.readFile(onnxSelectionPath(target), 'utf8'), selectedBefore);
  const repaired = await installOnnxArtifactClosure({ sourceGraph: graph, targetGraph: target });
  assert.notEqual(repaired.graphPath, installed.graphPath);
  const oldReader = await InferenceSession.create(installed.graphPath);
  const newReader = await InferenceSession.create(repaired.graphPath);
  try {
    assert.equal((await oldReader.run({})).Y.data[0], 1);
    assert.equal((await newReader.run({})).Y.data[0], 2);
  } finally { await oldReader.release(); await newReader.release(); }
  await fs.rm(sidecar);
  await assert.rejects(installOnnxArtifactClosure({ sourceGraph: graph, targetGraph: target }));
  await fs.writeFile(graph, graphBytes('../outside.weights'));
  await assert.rejects(planOnnxArtifactClosure(graph), { code: 'ERR_ONNX_ARTIFACT_CLOSURE' });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('ONNX installation closure passed');
